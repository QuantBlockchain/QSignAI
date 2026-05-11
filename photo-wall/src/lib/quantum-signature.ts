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

const SV1_ARN = "arn:aws:braket:::device/quantum-simulator/amazon/sv1";
const OUTPUT_BUCKET = process.env.BRAKET_BUCKET || "";
const OUTPUT_PREFIX = "braket-results";

export interface QuantumSignature {
  quantumNumber: number;
  publicKeyHash: string;
  signature: string;
  bellState: [number, number, number, number];
  algorithm: string;
  visualColor: string;
  device: string;
}

// Build OpenQASM 3.0 circuit for quantum random number generation
function buildRandomCircuit(seedText: string, numQubits: number = 4): string {
  const lines: string[] = [
    "OPENQASM 3.0;",
    `qubit[${numQubits}] q;`,
    `bit[${numQubits}] c;`,
    "",
    "// Superposition",
  ];

  for (let i = 0; i < numQubits; i++) {
    lines.push(`h q[${i}];`);
  }

  lines.push("", "// Entanglement");
  for (let i = 0; i < numQubits - 1; i++) {
    lines.push(`cnot q[${i}], q[${i + 1}];`);
  }

  lines.push("", "// Seed-based rotations");
  for (let i = 0; i < Math.min(seedText.length, numQubits); i++) {
    const angle = ((seedText.charCodeAt(i) % 128) / 128.0) * Math.PI;
    lines.push(`ry(${angle.toFixed(6)}) q[${i}];`);
  }

  lines.push("", "// Measurement");
  for (let i = 0; i < numQubits; i++) {
    lines.push(`c[${i}] = measure q[${i}];`);
  }

  return lines.join("\n");
}

// Build OpenQASM 3.0 Bell state circuit
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

// Submit circuit to SV1 and wait for results
async function runOnSV1(
  openQasm: string,
  shots: number
): Promise<Record<string, number>> {
  const action = JSON.stringify({
    braketSchemaHeader: {
      name: "braket.ir.openqasm.program",
      version: "1",
    },
    source: openQasm,
  });

  const taskRes = await braket.send(
    new CreateQuantumTaskCommand({
      deviceArn: SV1_ARN,
      action,
      shots,
      outputS3Bucket: OUTPUT_BUCKET,
      outputS3KeyPrefix: OUTPUT_PREFIX,
    })
  );

  const taskArn = taskRes.quantumTaskArn!;
  console.log(`[braket] Task created: ${taskArn}`);

  // Poll for completion — SV1 typically finishes in 2-5 seconds
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

  // Read results from S3
  // outputDir is just the key prefix (e.g. "braket-results/task-id"), not s3:// URL
  // outputBucket comes from GetQuantumTask response
  const check = await braket.send(
    new GetQuantumTaskCommand({ quantumTaskArn: taskArn })
  );
  const bucket = check.outputS3Bucket || OUTPUT_BUCKET;
  const key = `${outputDir}/results.json`;

  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await obj.Body!.transformToString();
  const results = JSON.parse(body);

  // Extract measurement counts
  const counts: Record<string, number> = {};
  if (results.measurementProbabilities) {
    // SV1 returns probabilities, convert to counts
    for (const [state, prob] of Object.entries(results.measurementProbabilities)) {
      counts[state] = Math.round((prob as number) * shots);
    }
  } else if (results.measurements) {
    // Some devices return raw measurements
    for (const m of results.measurements) {
      const key = m.join("");
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  console.log(`[braket] Results: ${JSON.stringify(counts)}`);
  return counts;
}

// ToyLWE crypto helpers
function shake256(data: Buffer, length: number): Buffer {
  return crypto.createHash("shake256", { outputLength: length }).update(data).digest();
}

function toyLweSign(username: string, message: string, quantumSeed: number): { publicKeyHash: string; signature: string } {
  const mix = Buffer.concat([
    Buffer.from("ToyLWE-KeyGen-v1"),
    Buffer.from(String(quantumSeed)),
    crypto.randomBytes(32),
  ]);
  const xof = shake256(mix, 64);

  // Derive public key hash
  const pkHash = crypto
    .createHash("sha256")
    .update(xof.subarray(0, 32))
    .digest("hex")
    .substring(0, 12)
    .toUpperCase();

  // Sign
  const msgHash = crypto.createHash("sha256").update(`${username}|${message}|${quantumSeed}`).digest("hex");
  const entropyHash = crypto.createHash("sha256").update(String(quantumSeed)).digest("hex");
  const sigHash = crypto.createHash("sha256").update(`${msgHash}:${entropyHash}:${pkHash}`).digest("hex");
  const signature = Buffer.from(sigHash).toString("base64").substring(0, 24);

  return { publicKeyHash: pkHash, signature };
}

export async function generateQuantumSignature(
  username: string,
  messageText: string
): Promise<QuantumSignature> {
  let quantumNumber: number;
  let bellState: [number, number, number, number];
  let device = "SV1";

  try {
    // Task 1: Quantum random number from SV1
    const rndCircuit = buildRandomCircuit(username + messageText, 4);
    const rndCounts = await runOnSV1(rndCircuit, 100);

    // Aggregate: most common bitstring → integer, then mod 1001
    const sorted = Object.entries(rndCounts).sort((a, b) => b[1] - a[1]);
    const topBits = sorted[0][0];
    quantumNumber = parseInt(topBits, 2) % 1001;

    // Task 2: Bell state from SV1
    const bellCircuit = buildBellCircuit();
    const bellCounts = await runOnSV1(bellCircuit, 200);

    const totalShots = Object.values(bellCounts).reduce((a, b) => a + b, 0);
    bellState = [
      (bellCounts["00"] || 0) / totalShots,
      (bellCounts["01"] || 0) / totalShots,
      (bellCounts["10"] || 0) / totalShots,
      (bellCounts["11"] || 0) / totalShots,
    ];

    console.log(`[braket] Quantum number: ${quantumNumber}, Bell state: ${JSON.stringify(bellState)}`);
  } catch (err) {
    console.error("[braket] SV1 failed, falling back to local crypto:", err);
    device = "local-fallback";

    // Fallback: crypto-based
    const seed = shake256(Buffer.from(`quantum:${username}:${Date.now()}`), 4);
    quantumNumber = seed.readUInt16BE(0) % 1001;
    bellState = [0.5, 0.0, 0.0, 0.5];
  }

  // ToyLWE signature using quantum seed
  const { publicKeyHash, signature } = toyLweSign(username, messageText, quantumNumber);

  // Visual color from quantum number
  const hue = (quantumNumber * 137.5) % 360;
  const sat = 70 + bellState[0] * 30;
  const light = 45 + bellState[3] * 20;
  const visualColor = `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;

  return {
    quantumNumber,
    publicKeyHash,
    signature,
    bellState,
    algorithm: "ToyLWE-Braket-SV1",
    visualColor,
    device,
  };
}
