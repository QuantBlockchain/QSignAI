# Feedback — Source-Code References

Code citations backing each point in `feedback.md`. Ground truth:
`photo-wall/src/lib/quantum-signature.ts`.

**AWS reference (the correct pattern):**
`aws_qc/examples/amazon-braket-examples/examples/advanced_circuits_algorithms/Randomness/Randomness_Generation.ipynb`
- cell-7 — `hadamard_circuit(n)`: the per-qubit Hadamard source circuit.
- cell-9 / cell-17 — reads `result.measurements` (the **per-shot bit stream**, one
  random bit per shot), not the modal bitstring; SV1 used as the simulator source.
- cell-11 / cell-21 — Toeplitz two-source extractor (FFT) condensing two weak sources
  into provably-uniform bits; min-entropy bound under noise in cell-13.

## 1. Not quantum-seeded; `q_num` range is [0, 15], not [0, 1000]
- Circuit A uses 4 qubits — `buildRandomCircuit(..., 4)` and call site
  `quantum-signature.ts:192`; register declared `qubit[4] q` (`:28–31`).
- `quantum-signature.ts:196–198`: takes the **most-frequent** bitstring over 100 shots
  (`sorted[0][0]`), then `quantumNumber = parseInt(topBits, 2) % 1001`. The modal outcome
  is deterministic for a given seed (the `R_y` angles fix the dominant state), so the
  quantum randomness is discarded; `topBits` is a 4-bit string → integer in 0–15, so
  `% 1001` is a no-op. Contrast with the notebook (cell-9/cell-17), which keeps every shot.
- Hue map consumes it at `:227`: `const hue = (quantumNumber * 137.5) % 360;` → 16 hues.

## 2. Deterministic signature, no random `r`
- `toyLweSign(username, message, quantumSeed)` — `quantum-signature.ts:158–180`. No nonce
  parameter or random source anywhere in the function.
- Intent comment, `:159`: "Deterministic: same (username, message, quantumSeed) → same key
  + signature."
- Key material, `:161–165`:
  `mix = "ToyLWE-KeyGen-v1" ∥ ${username}|${message}|${quantumSeed}`; `xof = shake256(mix, 64)`.

## 3. Signature-derivation inputs (Eqs. 3–5)
- SHAKE-256 input includes domain tag + message, omits `r`: `quantum-signature.ts:161–165`.
- `pkHash` = SHA-256 of first 32 XOF bytes, truncated to 12 uppercase hex: `:167–172`.
- `:174`: `msgHash = SHA-256(${username}|${message}|${quantumSeed})` — not message content alone.
- `:175`: `entropyHash = SHA-256(String(quantumSeed))`.
- `:176`: `sigHash = SHA-256(${msgHash}:${entropyHash}:${pkHash})` — pre-image order is
  msg : ent : pk.
- `:177`: `signature = base64(sigHash).substring(0, 24)` — 24-char base64.

## 4. R_y rotation seed
- Seed is the concatenation: `buildRandomCircuit(username + messageText, 4)` —
  `quantum-signature.ts:192`.
- Angle over first 4 chars of that seed: `:47–48`
  `angle = ((seedText.charCodeAt(i) % 128) / 128.0) * Math.PI;` for
  `i < min(seedText.length, numQubits)`.
