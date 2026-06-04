# Quantum Key Generation

This document describes the quantum-derived key material used to authenticate every photo wall card. It covers the algorithm choice and rationale, target hardware, the structure of the final deliverable, and the practical value of the construction.

The implementation lives at [`photo-wall/src/lib/quantum-signature.ts`](../../photo-wall/src/lib/quantum-signature.ts). For the complementary device catalog used by the qc-bc-interactive demo (which we draw from for hardware context), see [`qc-bc-interactive/docs/AWS_BRAKET_QUANTUM_DEVICES.md`](../../../qc-bc-interactive/docs/AWS_BRAKET_QUANTUM_DEVICES.md).

---

## 1. Algorithm Selection

### 1.1 What we generate

For every new sender in a Telegram group we produce a small identity bundle:

- a **quantum random number** in `[0, 1000]`, harvested from quantum measurements (see §1.2),
- a **32-byte quantum random nonce `r`**, the fresh entropy that seeds the signature,
- a **Bell-state probability vector** `[P(00), P(01), P(10), P(11)]`, used as a structural witness,
- a **ToyLWE keypair**, where the public key hash is shown on the card,
- a **signature** `𝒮 = SHAKE-256(username ‖ quantumNumber ‖ r)` and a derived `𝒢` (see §3.1),
- an **HSL accent color** derived from the quantum number and Bell-state probabilities.

The bundle is seeded by fresh quantum randomness, so it is **not** reproducible from the
username or message content. The first message from a `(groupId, senderId)` runs the QRNG
and the bundle is stored on the row; subsequent messages **reuse the stored bundle**, so
each user keeps a single stable badge per group while the underlying identity is genuinely
quantum-random.

### 1.2 Algorithm choices and rationale

The pipeline is composed of three building blocks. Each is chosen for a specific reason given the constraints of an event-grade demo.

| Building block | Choice | Rationale |
|---|---|---|
| **Quantum entropy** | Two-source QRNG: a single-qubit Hadamard circuit sampled for its **per-shot bit stream** on **SV1** (ideal source) and on **DM1** (noisy/weak source), condensed by a **Toeplitz two-source extractor** into uniform output bits | Follows the canonical AWS reference (`amazon-braket-examples` → `Randomness/Randomness_Generation.ipynb`). Reading every shot — rather than the modal bitstring — keeps the quantum randomness, and the two-source extractor yields output that is ε-close to uniform even under device noise. Output bytes supply both `quantumNumber ∈ [0, 1000]` and the 32-byte nonce `r`. Both circuits run on simulators, so cost stays < USD 0.01 per generation. |
| **Quantum structural witness** | 2-qubit Bell-state `\|Φ⁺⟩` circuit on SV1 (200 shots), probabilities `[P(00), P(01), P(10), P(11)]` | A perfect simulator should yield ≈ `[0.5, 0, 0, 0.5]`. Storing the empirical vector lets us drive an HSL color from quantum data and gives a visible "this came from a quantum execution" signal. |
| **Post-quantum identity** | Educational ToyLWE: `𝒮 = SHAKE-256(username ‖ quantumNumber ‖ r)` derives keypair material from the quantum nonce; a SHA-256 chain produces the signature; the first 12 hex chars of the public-key digest become the badge | LWE is the same hardness assumption underlying the NIST PQC winners (Kyber/Dilithium). ToyLWE is a deliberately simple educational stand-in that keeps the artifact shape (public key, public key hash, signature) familiar to anyone planning a real PQC migration, while staying small enough to verify at a glance. The full construction is specified in [`docs/paper/quantum-rng-implementation.md`](../../docs/paper/quantum-rng-implementation.md). |

### 1.3 What we do **not** claim

- **Not BB84 / E91 / QKD.** Quantum key distribution requires two cooperating endpoints with quantum hardware and a public classical channel. The wall is a single-endpoint event experience; QKD would not have been the right primitive.
- **Not standardized PQC.** ToyLWE is not Kyber, Dilithium, or any NIST-standardized scheme; it is a teaching artifact. For production migration, swap ToyLWE for `@aws-crypto/kyber` / `pq-crystals/dilithium` or the equivalent in your stack — the surrounding pipeline (Braket entropy + Bell witness + per-user caching + ALB-fronted DynamoDB row) is unchanged.
- **Not fault-tolerant cryptanalysis.** The Hadamard source circuits are a randomness source, not a Shor/Grover instance. The badge demonstrates "quantum-authenticated identity" at event scale, not a quantum attack or quantum-key-establishment session.

---

## 2. Device Specification

### 2.1 Primary execution target

| Property | Value |
|---|---|
| Provider | Amazon Web Services |
| Service | Amazon Braket |
| Devices | **SV1 — On-Demand State-Vector Simulator** (ideal source) and **DM1 — Density-Matrix Simulator** (noisy/weak source) |
| Device ARNs | `arn:aws:braket:::device/quantum-simulator/amazon/sv1`, `arn:aws:braket:::device/quantum-simulator/amazon/dm1` |
| Qubits used | 1 per randomness source (sampled across ~700 shots each), 2 for the Bell state |
| Regions used | `us-west-2` by default; configurable via `AWS_REGION_NAME` |
| Result storage | S3 bucket configured by `BRAKET_BUCKET`, prefix `braket-results/` |
| Typical latency | 2–5 seconds end-to-end per task (run concurrently) |
| Supports OpenQASM 3.0 | Yes; circuits are emitted as `braket.ir.openqasm.program` |

SV1 and DM1 were chosen because they are queue-free, region-flexible, and their latency stays within the 5-second polling cadence of the photo wall's `GET /api/messages/[groupId]` endpoint. Using two **independent** simulator sources — one ideal, one noisy — is what makes the Toeplitz two-source extractor meaningful: it condenses two weak sources into output that is provably close to uniform even under noise. A real QPU run can take 5–60 minutes once queueing is included, which would force the wall into an asynchronous "pending signature" flow without a meaningful change in the demonstration's narrative.

### 2.2 Fallback path

If Braket is unavailable, the code falls back to a local pipeline so the wall never blocks a sender. The fallback uses the OS CSPRNG (`crypto.randomBytes`) — it is **fresh and non-deterministic**, but it is **not** a quantum measurement, and it is **not** derived from message content:

| Stage | Fallback behavior |
|---|---|
| Quantum random number | `crypto.randomBytes(4).readUInt32BE(0) mod 1001` |
| Nonce `r` | `crypto.randomBytes(32)` |
| Bell state | Static `[0.5, 0, 0, 0.5]` (the noiseless ideal) |
| Algorithm tag | `algorithm: \"ToyLWE-local-fallback\"` |
| Device tag | `device: \"local-fallback\"` |

Cards rendered from the fallback path are visually indistinguishable from Braket-backed cards (preserving event UX), but the admin dashboard surfaces `algorithm` and `device` so organizers can distinguish them when auditing.

### 2.3 Forward-compatible QPU targets

The same `BraketClient + CreateQuantumTaskCommand` path can target real QPUs without code changes; only the device ARN and shot count would shift. The catalog drawn from `qc-bc-interactive/docs/AWS_BRAKET_QUANTUM_DEVICES.md` summarizes the candidates:

| Family | Example device | Why it could replace SV1 |
|---|---|---|
| Trapped ion | IonQ Aria-1 / Forte-1 (us-east-1), AQT IBEX-Q1 (eu-north-1) | All-to-all connectivity, world-leading gate fidelities; ideal when "real QPU" framing matters more than per-task latency |
| Superconducting | IQM Garnet (20 qubits) / Emerald (54 qubits, eu-north-1), Rigetti Ankaa-3 (84 qubits, us-west-1) | Nanosecond gate times; well-suited to scaled-up randomness or post-event batch signing |
| Neutral atom | QuEra Aquila (256 qubits, us-east-1) | Programmable layouts, AHS paradigm; not a drop-in replacement for the gate-based RNG circuit but a candidate for thematic reservoir-style outputs |
| Managed simulators | DM1 (density matrix), TN1 (tensor network) | Useful when modeling noise (DM1) or wider circuits (TN1) for educational variants |

For an actual QPU rollout, expect to relax the 30-second polling window in `submitAndFetch` and to surface a `signatureStatus = "queued"` state until the task completes.

---

## 3. Key Components — Final Deliverable

The "key material" persisted alongside every signed message is small and self-contained. The shape is exactly the `QuantumSignature` interface in `photo-wall/src/lib/quantum-signature.ts`:

```ts
export interface QuantumSignature {
  quantumNumber: number;          // 0..1000
  publicKeyHash: string;          // 12 uppercase hex chars
  signature: string;              // 24 base64 chars
  nonce: string;                  // hex of the 32 quantum-random bytes r
  bellState: [number, number, number, number]; // [P(00), P(01), P(10), P(11)]
  algorithm: string;              // "ToyLWE-2Source-Toeplitz" | "ToyLWE-local-fallback"
  visualColor: string;            // "hsl(h, s%, l%)"
  device: string;                 // "SV1+DM1" | "local-fallback"
}
```

### 3.1 Stage-by-stage contents

| Stage | What is produced | Where it lives in the row |
|---|---|---|
| **Raw quantum random bits (two sources)** | Per-shot measurement streams `x` (SV1, ideal) and `y` (DM1, noisy) from ~700 shots each of a single-qubit Hadamard circuit | Not stored verbatim |
| **Two-source randomness extraction** | Toeplitz extractor `Ext(x, y) = x·(T(y)\|I_m)ᵀ mod 2` condenses the two weak sources into `m = 288` bits that are ε-close to uniform (ε = 1e-8) even under device noise | Not stored; consumed below |
| **Quantum random number + nonce** | `quantumNumber = readUInt32(out[0:4]) mod 1001`; `r = out[4:36]` (the 32 fresh quantum-random bytes) | `quantumNumber`, `quantumNonce` |
| **Final key material (public artifact)** | `𝒮 = SHAKE-256(username ‖ quantumNumber ‖ r, 64)`; `publicKeyHash = SHA-256(𝒮[0:32])[0:12]` (uppercase hex); `signature = base64(SHA-256(H_msg : H_ent : pkHash))[0:24]` with `H_msg = SHA-256(message)`, `H_ent = SHA-256(quantumNumber)` | `publicKeyHash`, `quantumSignature` |
| **Structural witness** | Empirical Bell-state probabilities from the 2-qubit `\|Φ⁺⟩` circuit (200 shots) | `bellState` |
| **Audit metadata** | Whether the SV1+DM1 QRNG produced the row or the fallback did | `signatureAlgorithm`, `device`, plus `signatureStatus` in DynamoDB |
| **Presentation derivation** | `hue = (quantumNumber × 137.5) mod 360`; `sat = 70 + bellState[0] × 30`; `light = 45 + bellState[3] × 20` | `visualColor` |

### 3.2 What the card actually shows

The badge rendered on every card is the compact projection of the bundle:

```
Q#{quantumNumber} | {publicKeyHash}        e.g.  Q#452 | 7B284BB3D413
```

The full `signature`, `bellState`, `algorithm`, and `device` fields are visible in the admin dashboard for provenance review (see [`docs/en/architecture.md` — Admin Flow](architecture.md#admin-flow) and [`docs/en/user-experience/Readme.md` — section 3](user-experience/Readme.md#3--admin-dashboard-page-3png)).

---

## 4. Practical Value

### 4.1 In this demo

- **Stable per-user identity at zero install cost.** A Telegram sender becomes a Braket-derived `Q#number | publicKeyHash` that follows them across messages, without an account, wallet, or onboarding flow.
- **Audience-legible quantum execution.** The Bell-state vector and the SV1 vs. local-fallback flag let a host say, on stage, "this card was signed using a circuit that ran on AWS Braket five seconds ago" — and back it up in the admin dashboard.
- **Verifiable moderation provenance.** Soft-deleted rows preserve the full signature bundle, so audit trails survive moderation without leaking the underlying message store.

### 4.2 Beyond the demo

The same pipeline shape generalizes to several real workloads:

- **Quantum-seeded session tokens.** Replacing ToyLWE with Dilithium and the photo wall with an authenticated session API gives you per-user PQC tokens whose entropy demonstrably comes from a quantum measurement, with the same audit metadata (`algorithm`, `device`) preserved.
- **Event QR check-in / proof-of-attendance.** The `Q#number | publicKeyHash` projection is short enough to embed in a QR code, opening the door to PQC-style proof-of-attendance NFTs or Web3 badges signed by the live event run.
- **Post-quantum migration playbook for blockchain identity.** Because the wrapper is LWE-shaped, the same call site can be wired into a Kyber/Dilithium implementation without changing the surrounding flow — meaning teams can prototype the UX of a PQC migration before they commit to a specific PQC stack.
- **Educational baseline for QKD / E91 conversations.** By making clear what the demo is *not* (a QKD session), it gives instructors a concrete reference for explaining why QKD requires a different deployment model and a paired endpoint.

### 4.3 Limits to keep in mind

- ToyLWE is for demonstration; do not use it to protect real assets.
- SV1 is a simulator; the only "quantumness" being demonstrated is the entropy source and the structural witness.
- The fallback path is cryptographically seeded but is **not** a quantum measurement; rely on the `device` and `algorithm` tags when communicating provenance.
- The 30-second polling window in `submitAndFetch` is tuned for SV1; targeting a real QPU requires extending that window and propagating a `queued` state to the UI.
