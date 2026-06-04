# Quantum-Seeded Signatures — Implementation Design

This document specifies how QSignAI derives each participant's identity bundle from a
**genuine quantum random number**, following the canonical AWS reference
`amazon-braket-examples/.../Randomness/Randomness_Generation.ipynb`. It replaces the
previous modal-bitstring scheme in `photo-wall/src/lib/quantum-signature.ts`, which
collapsed 100 shots to a single deterministic value in [0, 15] (see `feedback.md`,
point 1).

## 1. Why the previous design was not quantum-random

The old Circuit A applied `H` + a CNOT chain + username-seeded `R_y` rotations, took 100
shots, and kept only the **most-frequent** 4-bit bitstring. The `R_y` angles bias the
distribution toward one dominant outcome, so the modal bitstring is a deterministic
function of `(username, message)` — the quantum measurement noise is averaged away rather
than harvested. The result also never exceeds 15, so the advertised `[0, 1000]` range and
the `mod 1001` were both inert, and there was no nonce `r` for replay resistance.

## 2. Target construction (two-source QRNG + Toeplitz extractor)

We follow the notebook's structure exactly, using **simulators only** to keep cost
negligible (each run is a few hundred single-qubit shots; well under USD 0.01).

### 2.1 Two independent weak sources
- **Source 1 — SV1** (`arn:aws:braket:::device/quantum-simulator/amazon/sv1`): a
  single-qubit Hadamard circuit, `n` shots. The **per-shot measurement stream**
  (`result.measurements`) is the raw bit string `x ∈ {0,1}ⁿ` — one quantum-random bit per
  shot, exactly as in notebook cell-9/cell-17.
- **Source 2 — DM1** (`arn:aws:braket:::device/quantum-simulator/amazon/dm1`, density
  matrix): the same Hadamard circuit with injected depolarizing noise (λ ≈ 0.02) and a
  small readout bias (μ ≈ 0.98), producing a *weak* source `y ∈ {0,1}ⁿ⁻¹`. This mirrors
  the notebook's noisy-QPU min-entropy story (cell-12/cell-13) while staying on a
  simulator. If DM1 rejects inline OpenQASM noise pragmas, the documented fallback is to
  build the noise via the Braket noise-model JSON, or to post-bias an SV1 stream (a
  deviation noted in code).

### 2.2 Toeplitz two-source extractor
Port notebook cell-11. For a quantum-proof two-source extractor with security parameter
`ε` and conservative min-entropy rates `k₁, k₂`:

```
n = floor( (m - 1 - 2·log2(ε)) / (k₁ + k₂ - 1) )
Ext(x, y) = x · (T(y) | 1_m)ᵀ  (mod 2)
```

where `T(y)` is the Toeplitz matrix built from `y`. With `ε = 1e-8`, `k₁ = k₂ ≈ 0.72`
(conservative under the noise above), and `m = 288` output bits we need `n ≈ 700` shots
per source — trivially cheap on simulators. We implement the **direct O(n²) vector–matrix
multiply mod 2** rather than the notebook's FFT optimization; the notebook itself notes
O(n²) is fine for `n < 10⁴`, and this avoids adding an FFT dependency to the TypeScript
service. (The FFT path remains a drop-in optimization if `n` ever grows.)

The extractor output is `m` bits that are ε-close to uniform **even conditioned on the
device noise** — this is the property that makes the randomness physically secure, not
merely statistically balanced.

## 3. Bundle derivation from extractor output `Q`

Let `Q` be the extractor's output bytes.

| Field | Derivation | Notes |
|---|---|---|
| `quantumNumber` | `readUInt32(Q[0:4]) % 1001` | genuine `q_num ∈ [0, 1000]` |
| `r` (nonce) | `Q[4:36]` | the **32 fresh quantum-random bytes** of Eq. (3) |
| `𝒮` (sig material) | `SHAKE-256(username ‖ quantumNumber ‖ r, 64)` | matches Eq. (3) once `r` exists |
| `pkHash` | `SHA-256(𝒮[0:32])[0:12]` uppercase | badge public-key hash |
| `𝒢` (signature) | `base64( SHA-256(H_msg : H_ent : pkHash) )[0:24]` | `H_msg = SHA-256(message)`, `H_ent = SHA-256(quantumNumber)` |

The Bell-state circuit (`|Φ⁺⟩`, 200 shots) and the HSL color formulas
(`h = q_num·137.5 mod 360`, `s = 70 + β₀·30`, `l = 45 + β₃·20`) are **unchanged** — they
were already correct.

Because `r` is fresh per generation, the full bundle (number, color, signature) is now
quantum-random per user. Badge **stability** is preserved by per-user caching: the first
message from a `(groupId, senderId)` runs the QRNG and the bundle is stored on the
DynamoDB row; later messages reuse the stored bundle. The nonce `r` is persisted so a
signature remains reproducible for audit.

## 4. Fallback (Braket unavailable)

The fallback stays non-blocking but becomes honest: `quantumNumber` and `r` are drawn from
`crypto.randomBytes` (OS CSPRNG), **not** from message content. Rows are tagged
`algorithm: "ToyLWE-local-fallback"`, `device: "local-fallback"` so the admin dashboard
can distinguish them. The code comments that fallback `r` is OS-random, not quantum.

## 5. Parameters summary

| Parameter | Value |
|---|---|
| Sources | SV1 (ideal) + DM1 (noisy) |
| Circuit | single-qubit Hadamard, per-shot bit stream |
| `ε` | 1e-8 |
| `k₁, k₂` | ≈ 0.72 (conservative under λ=0.02, μ=0.98) |
| `m` (output bits) | 288 (32-byte `r` + q_num material) |
| `n` (shots/source) | ≈ 700 |
| Extractor | Toeplitz two-source, direct O(n²) mod-2 |
| Cost | < USD 0.01 per generation (simulators) |
