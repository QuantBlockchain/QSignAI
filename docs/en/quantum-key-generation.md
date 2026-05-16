# Quantum Key Generation

This document describes the quantum-derived key material used to authenticate every photo wall card. It covers the algorithm choice and rationale, target hardware, the structure of the final deliverable, and the practical value of the construction.

The implementation lives at [`photo-wall/src/lib/quantum-signature.ts`](../../photo-wall/src/lib/quantum-signature.ts). For the complementary device catalog used by the qc-bc-interactive demo (which we draw from for hardware context), see [`qc-bc-interactive/docs/AWS_BRAKET_QUANTUM_DEVICES.md`](../../../qc-bc-interactive/docs/AWS_BRAKET_QUANTUM_DEVICES.md).

---

## 1. Algorithm Selection

### 1.1 What we generate

For every new sender in a Telegram group we produce a small, stable identity bundle:

- a **quantum random number** in `[0, 1000]`, derived from a quantum measurement,
- a **Bell-state probability vector** `[P(00), P(01), P(10), P(11)]`, used as a structural witness,
- a **ToyLWE keypair**, where the public key hash is shown on the card,
- a **signature** over `username | messageText | quantumNumber`,
- a deterministic **HSL accent color** derived from the quantum number and Bell-state probabilities.

Subsequent messages from the same `(groupId, senderId)` reuse the cached bundle, so each user has a single stable identity per group.

### 1.2 Algorithm choices and rationale

The pipeline is composed of three building blocks. Each is chosen for a specific reason given the constraints of an event-grade demo.

| Building block | Choice | Rationale |
|---|---|---|
| **Quantum entropy** | 4-qubit random-number circuit on Amazon Braket SV1 (100 shots), result mapped to `topBitstring mod 1001` | A small circuit fits SV1's latency budget (typical task < 5 s) and avoids QPU queue waits. Mod 1001 gives a presentation-friendly badge `Q#000`–`Q#1000` while still drawing entropy from quantum measurement. |
| **Quantum structural witness** | 2-qubit Bell-state `\|Φ⁺⟩` circuit on SV1 (200 shots), probabilities `[P(00), P(01), P(10), P(11)]` | A perfect simulator should yield ≈ `[0.5, 0, 0, 0.5]`. Storing the empirical vector lets us drive a deterministic HSL color from quantum data and gives a visible "this came from a quantum execution" signal. |
| **Post-quantum identity** | Educational ToyLWE: SHAKE-256 derives keypair material from `domain ‖ quantumSeed ‖ 32 OS bytes`; SHA-256 chain produces the signature; first 12 hex chars of the public-key digest become the badge | LWE is the same hardness assumption underlying the NIST PQC winners (Kyber/Dilithium). ToyLWE is a deliberately simple educational stand-in that keeps the on-chain artifact shape (public key, public key hash, signature) familiar to anyone planning a real PQC migration, while staying small enough to verify at a glance. |

### 1.3 What we do **not** claim

- **Not BB84 / E91 / QKD.** Quantum key distribution requires two cooperating endpoints with quantum hardware and a public classical channel. The wall is a single-endpoint event experience; QKD would not have been the right primitive.
- **Not standardized PQC.** ToyLWE is not Kyber, Dilithium, or any NIST-standardized scheme; it is a teaching artifact. For production migration, swap ToyLWE for `@aws-crypto/kyber` / `pq-crystals/dilithium` or the equivalent in your stack — the surrounding pipeline (Braket entropy + Bell witness + per-user caching + ALB-fronted DynamoDB row) is unchanged.
- **Not fault-tolerant cryptanalysis.** The 4-qubit circuit is a randomness source, not a Shor/Grover instance. The badge demonstrates "quantum-authenticated identity" at event scale, not a quantum attack or quantum-key-establishment session.

---

## 2. Device Specification

### 2.1 Primary execution target

| Property | Value |
|---|---|
| Provider | Amazon Web Services |
| Service | Amazon Braket |
| Device | **SV1 — On-Demand State-Vector Simulator** |
| Device ARN | `arn:aws:braket:::device/quantum-simulator/amazon/sv1` |
| Maximum qubits | 34 (we use 4 for randomness, 2 for Bell state) |
| Regions used | `us-west-2` by default; configurable via `AWS_REGION_NAME` |
| Result storage | S3 bucket configured by `BRAKET_BUCKET`, prefix `braket-results/` |
| Typical latency | 2–5 seconds end-to-end per task |
| Supports OpenQASM 3.0 | Yes; circuits are emitted as `braket.ir.openqasm.program` |

SV1 was chosen because it is queue-free, region-flexible, and its latency stays within the 5-second polling cadence of the photo wall's `GET /api/messages/[groupId]` endpoint. A real QPU run can take 5–60 minutes once queueing is included, which would force the wall into an asynchronous "pending signature" flow without a meaningful change in the demonstration's narrative.

### 2.2 Fallback path

If Braket is unavailable, the code falls back to a deterministic local pipeline so the wall never blocks a sender:

| Stage | Fallback behavior |
|---|---|
| Quantum random number | `shake256(\"quantum:\" + username + \":\" + Date.now()).readUInt16BE(0) mod 1001` |
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

For an actual QPU rollout, expect to relax the 30-second polling window in `runOnSV1` and to surface a `signatureStatus = "queued"` state until the task completes.

---

## 3. Key Components — Final Deliverable

The "key material" persisted alongside every signed message is small and self-contained. The shape is exactly the `QuantumSignature` interface in `photo-wall/src/lib/quantum-signature.ts`:

```ts
export interface QuantumSignature {
  quantumNumber: number;          // 0..1000
  publicKeyHash: string;          // 12 uppercase hex chars
  signature: string;              // 24 base64 chars
  bellState: [number, number, number, number]; // [P(00), P(01), P(10), P(11)]
  algorithm: string;              // "ToyLWE-Braket-SV1" | "ToyLWE-local-fallback"
  visualColor: string;            // "hsl(h, s%, l%)"
  device: string;                 // "SV1" | "local-fallback"
}
```

### 3.1 Stage-by-stage contents

| Stage | What is produced | Where it lives in the row |
|---|---|---|
| **Raw quantum random bits** | Most-frequent bitstring out of 100 shots on the 4-qubit RNG circuit | Not stored verbatim; collapsed to `quantumNumber = int(topBitstring, 2) mod 1001` |
| **Error-tolerant aggregation** | Picking the modal bitstring is the trivial majority-vote analogue of error correction; combined with `mod 1001`, it absorbs single-shot noise from the simulator | `quantumNumber` |
| **Privacy amplification** | `xof = SHAKE-256(\"ToyLWE-KeyGen-v1\" ‖ quantumSeed ‖ os.urandom(32), 64)` mixes quantum entropy with 32 OS-random bytes, breaking any per-task correlations | Not stored; mixed into `publicKeyHash` and `signature` |
| **Final key material (public artifact)** | `publicKeyHash = SHA-256(xof[0:32])[0:12]` (uppercase hex); `signature = base64(SHA-256(msgHash ‖ entropyHash ‖ pkHash))[0:24]` | `publicKeyHash`, `signature` |
| **Structural witness** | Empirical Bell-state probabilities from the 2-qubit `\|Φ⁺⟩` circuit (200 shots) | `bellState` |
| **Audit metadata** | Whether SV1 produced the row or the fallback did | `algorithm`, `device`, plus `signatureStatus` in DynamoDB |
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
- The 30-second polling window in `runOnSV1` is tuned for SV1; targeting a real QPU requires extending that window and propagating a `queued` state to the UI.
