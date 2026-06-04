import crypto from "crypto";
import {
  BraketClient,
  CreateQuantumTaskCommand,
  GetQuantumTaskCommand,
} from "@aws-sdk/client-braket";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION_NAME || process.env.AWS_REGION || "us-west-2";
const braket = new BraketClient({ region });
const s3 = new S3Client({ region });

// Two independent simulator sources for the two-source QRNG (see
// docs/paper/quantum-rng-implementation.md). SV1 is the ideal state-vector
// simulator; DM1 is the density-matrix simulator carrying injected noise, used
// as the "weak" second source the Toeplitz extractor is designed to condense.
const SV1_ARN = "arn:aws:braket:::device/quantum-simulator/amazon/sv1";
const DM1_ARN = "arn:aws:braket:::device/quantum-simulator/amazon/dm1";
const OUTPUT_BUCKET = process.env.BRAKET_BUCKET || "";
const OUTPUT_PREFIX = "braket-results";

// Two-source extractor parameters (notebook: Randomness_Generation.ipynb).
const EPS = 1e-8;            // security parameter
const K_RATE = 0.72;        // conservative per-source min-entropy rate
const OUTPUT_BYTES = 36;     // 4 bytes -> quantumNumber, 32 bytes -> nonce r
const OUTPUT_BITS = OUTPUT_BYTES * 8; // m = 288

export interface QuantumSignature {
  quantumNumber: number;
  publicKeyHash: string;
  signature: string;
  nonce: string; // hex of the 32 fresh random bytes r
  bellState: [number, number, number, number];
  algorithm: string;
  visualColor: string;
  device: string;
}

// ---------------------------------------------------------------------------
// Circuits
// ---------------------------------------------------------------------------

// Single-qubit Hadamard source: one quantum-random bit per shot (notebook cell-7).
function buildHadamardCircuit(): string {
  return [
    "OPENQASM 3.0;",
    "qubit[1] q;",
    "bit[1] c;",
    "h q[0];",
    "c[0] = measure q[0];",
  ].join("\n");
}

// Same Hadamard source, but on DM1 with injected noise so it acts as a genuine
// *weak* randomness source (depolarizing channel + amplitude damping toward
// |0>, modelling readout-ground bias). The extractor is built to tolerate this.
function buildNoisyHadamardCircuit(): string {
  return [
    "OPENQASM 3.0;",
    "qubit[1] q;",
    "bit[1] c;",
    "h q[0];",
    "#pragma braket noise depolarizing(0.02) q[0]",
    "#pragma braket noise amplitude_damping(0.04) q[0]",
    "c[0] = measure q[0];",
  ].join("\n");
}

// 2-qubit Bell state |Φ+> = (|00> + |11>)/sqrt(2) — structural witness, unchanged.
function buildBellCircuit(): string {
  return [
    "OPENQASM 3.0;",
    "qubit[2] q;",
    "bit[2] c;",
    "h q[0];",
    "cnot q[0], q[1];",
    "c[0] = measure q[0];",
    "c[1] = measure q[1];",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Braket execution
// ---------------------------------------------------------------------------

// Submit an OpenQASM circuit to a device, wait for completion, and return the
// parsed results JSON from S3.
async function submitAndFetch(
  deviceArn: string,
  openQasm: string,
  shots: number
): Promise<any> {
  const action = JSON.stringify({
    braketSchemaHeader: { name: "braket.ir.openqasm.program", version: "1" },
    source: openQasm,
  });

  const taskRes = await braket.send(
    new CreateQuantumTaskCommand({
      deviceArn,
      action,
      shots,
      outputS3Bucket: OUTPUT_BUCKET,
      outputS3KeyPrefix: OUTPUT_PREFIX,
    })
  );

  const taskArn = taskRes.quantumTaskArn!;
  console.log(`[braket] Task created on ${deviceArn.split("/").pop()}: ${taskArn}`);

  let status = "";
  let outputDir = "";
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const check = await braket.send(
      new GetQuantumTaskCommand({ quantumTaskArn: taskArn })
    );
    status = check.status || "";
    if (status === "COMPLETED") {
      outputDir = check.outputS3Directory || "";
      break;
    }
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`Braket task ${status}: ${check.failureReason || "unknown"}`);
    }
  }

  if (status !== "COMPLETED") {
    throw new Error(`Braket task timed out after 30s, status: ${status}`);
  }

  const check = await braket.send(
    new GetQuantumTaskCommand({ quantumTaskArn: taskArn })
  );
  const bucket = check.outputS3Bucket || OUTPUT_BUCKET;
  const key = `${outputDir}/results.json`;

  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await obj.Body!.transformToString();
  return JSON.parse(body);
}

// Run a single-qubit source circuit and return the raw per-shot bit stream.
async function runForBits(
  deviceArn: string,
  openQasm: string,
  shots: number
): Promise<number[]> {
  const results = await submitAndFetch(deviceArn, openQasm, shots);
  // Raw per-shot measurements: array of per-shot bit arrays (one bit each here).
  if (Array.isArray(results.measurements) && results.measurements.length > 0) {
    return results.measurements.map((m: number[]) => Number(m[0]) & 1);
  }
  throw new Error("No raw per-shot measurements returned (cannot harvest quantum bits)");
}

// Run the Bell circuit and return measurement counts.
async function runForCounts(
  deviceArn: string,
  openQasm: string,
  shots: number
): Promise<Record<string, number>> {
  const results = await submitAndFetch(deviceArn, openQasm, shots);
  const counts: Record<string, number> = {};
  if (results.measurementProbabilities) {
    for (const [state, prob] of Object.entries(results.measurementProbabilities)) {
      counts[state] = Math.round((prob as number) * shots);
    }
  } else if (Array.isArray(results.measurements)) {
    for (const m of results.measurements) {
      const k = m.join("");
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Toeplitz two-source extractor (notebook cell-11), direct O(m·(n-m)) mod-2.
// Ext(x, y) = x · (T(y) | I_m)^T  (mod 2), with x ∈ {0,1}^n, y ∈ {0,1}^{n-1}.
// ---------------------------------------------------------------------------

// Required raw input length per source for `m` output bits at security `eps`.
export function requiredInputLength(m: number, eps: number, k: number): number {
  return Math.floor((m - 1 - 2 * Math.log2(eps)) / (k + k - 1));
}

export function toeplitzExtract(x: number[], y: number[], m: number): number[] {
  const n = x.length;
  if (y.length < n - 1) throw new Error(`y too short: need ${n - 1}, got ${y.length}`);
  if (n < 2 * m) throw new Error(`n (${n}) must be >= 2m (${2 * m}) for this construction`);

  // y is indexed d ∈ [-(m-1), n-m-1]; store as Y[k] with k = d + (m-1).
  const out: number[] = new Array(m).fill(0);
  const cols = n - m; // number of Toeplitz columns
  for (let i = 0; i < m; i++) {
    let acc = 0;
    for (let j = 0; j < cols; j++) {
      const k = j - i + (m - 1); // index into y
      acc ^= (x[j] & y[k]);
    }
    // Identity block: i-th column selects x[(n-m)+i].
    acc ^= x[cols + i];
    out[i] = acc & 1;
  }
  return out;
}

// Pack a bit array (MSB-first) into a Buffer of ceil(bits/8) bytes.
function bitsToBuffer(bits: number[]): Buffer {
  const buf = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] & 1) buf[i >> 3] |= 0x80 >> (i & 7);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// ToyLWE signature (educational PQC stand-in) seeded by the quantum nonce r.
// ---------------------------------------------------------------------------

function shake256(data: Buffer, length: number): Buffer {
  return crypto.createHash("shake256", { outputLength: length }).update(data).digest();
}

// 𝒮 = SHAKE-256(username ‖ quantumNumber ‖ r); pkHash = SHA-256(𝒮[0:32])[0:12];
// 𝒢 = base64(SHA-256(H_msg : H_ent : pkHash))[0:24].
function toyLweSign(
  username: string,
  message: string,
  quantumNumber: number,
  r: Buffer
): { publicKeyHash: string; signature: string } {
  const sigMaterial = shake256(
    Buffer.concat([
      Buffer.from(username, "utf8"),
      Buffer.from("|", "utf8"),
      Buffer.from(String(quantumNumber), "utf8"),
      Buffer.from("|", "utf8"),
      r,
    ]),
    64
  );

  const pkHash = crypto
    .createHash("sha256")
    .update(sigMaterial.subarray(0, 32))
    .digest("hex")
    .substring(0, 12)
    .toUpperCase();

  const msgHash = crypto.createHash("sha256").update(message).digest("hex");
  const entropyHash = crypto.createHash("sha256").update(String(quantumNumber)).digest("hex");
  const sigHash = crypto
    .createHash("sha256")
    .update(`${msgHash}:${entropyHash}:${pkHash}`)
    .digest("hex");
  const signature = Buffer.from(sigHash).toString("base64").substring(0, 24);

  return { publicKeyHash: pkHash, signature };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateQuantumSignature(
  username: string,
  messageText: string
): Promise<QuantumSignature> {
  let quantumNumber: number;
  let r: Buffer;
  let bellState: [number, number, number, number];
  let device = "SV1+DM1";
  let algorithm = "ToyLWE-2Source-Toeplitz";

  try {
    // Two-source QRNG: harvest per-shot bit streams from two independent
    // simulators, then condense with the Toeplitz two-source extractor.
    const n = requiredInputLength(OUTPUT_BITS, EPS, K_RATE);

    const [sourceA, sourceB, bellCounts] = await Promise.all([
      runForBits(SV1_ARN, buildHadamardCircuit(), n),       // ideal source x
      runForBits(DM1_ARN, buildNoisyHadamardCircuit(), n),  // weak/noisy source y
      runForCounts(SV1_ARN, buildBellCircuit(), 200),       // structural witness
    ]);

    const outBits = toeplitzExtract(sourceA, sourceB, OUTPUT_BITS);
    const Q = bitsToBuffer(outBits); // 36 bytes
    quantumNumber = Q.readUInt32BE(0) % 1001;
    r = Buffer.from(Q.subarray(4, 36)); // 32 fresh quantum-random bytes

    const totalShots = Object.values(bellCounts).reduce((a, b) => a + b, 0) || 1;
    bellState = [
      (bellCounts["00"] || 0) / totalShots,
      (bellCounts["01"] || 0) / totalShots,
      (bellCounts["10"] || 0) / totalShots,
      (bellCounts["11"] || 0) / totalShots,
    ];

    console.log(
      `[braket] Two-source QRNG: n=${n}/source, quantumNumber=${quantumNumber}, bell=${JSON.stringify(bellState)}`
    );
  } catch (err) {
    console.error("[braket] QRNG failed, falling back to local CSPRNG:", err);
    device = "local-fallback";
    algorithm = "ToyLWE-local-fallback";

    // Honest fallback: fresh OS-random entropy (NOT quantum, and NOT derived
    // from message content). Tagged so the admin dashboard can distinguish it.
    quantumNumber = crypto.randomBytes(4).readUInt32BE(0) % 1001;
    r = crypto.randomBytes(32);
    bellState = [0.5, 0.0, 0.0, 0.5];
  }

  const { publicKeyHash, signature } = toyLweSign(username, messageText, quantumNumber, r);

  // Visual color from quantum number + Bell-state probabilities.
  const hue = (quantumNumber * 137.5) % 360;
  const sat = 70 + bellState[0] * 30;
  const light = 45 + bellState[3] * 20;
  const visualColor = `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;

  return {
    quantumNumber,
    publicKeyHash,
    signature,
    nonce: r.toString("hex"),
    bellState,
    algorithm,
    visualColor,
    device,
  };
}
