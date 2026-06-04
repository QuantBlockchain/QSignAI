# Feedback — Source-Code References

Code citations backing each point in `feedback.md`. Ground truth:
`photo-wall/src/lib/quantum-signature.ts` (current, two-source QRNG implementation).

**AWS reference (the pattern the implementation follows):**
`aws_qc/examples/amazon-braket-examples/examples/advanced_circuits_algorithms/Randomness/Randomness_Generation.ipynb`
- cell-7 — `hadamard_circuit(n)`: the per-qubit Hadamard source circuit.
- cell-9 / cell-17 — reads `result.measurements` (the **per-shot bit stream**, one
  random bit per shot), not the modal bitstring; SV1 used as the simulator source.
- cell-11 / cell-21 — Toeplitz two-source extractor condensing two weak sources into
  provably-uniform bits; min-entropy bound under noise in cell-13.

## 1. Two-source QRNG replaces the old seeded-rotation Circuit A
- Two independent sources: `SV1_ARN` (ideal) and `DM1_ARN` (noisy) — lines 17–18;
  source circuits `buildHadamardCircuit` (:44) and `buildNoisyHadamardCircuit` (:57).
- Per-shot bit streams harvested via `runForBits` (:144), called for both sources at
  :283–284; shot count `n = requiredInputLength(...)` (:280, ≈773 for the production
  params).
- `quantumNumber = Q.readUInt32BE(0) % 1001` (:290) — genuine [0, 1000]; the hue map at
  :319 now spans the full range.
- (For contrast, the old design was a 4-qubit `buildRandomCircuit` whose most-frequent
  bitstring was taken `% 1001`, giving a deterministic value in [0, 15]. That function no
  longer exists.)

## 2. Toeplitz extractor + nonce
- `requiredInputLength(m, eps, k)` (:184) and `toeplitzExtract(x, y, m)` (:188) — the
  direct O(n²) mod-2 two-source extractor; output consumed at :288.
- `r = Buffer.from(Q.subarray(4, 36))` (:291) — the 32 fresh quantum-random bytes that
  back the Eq. (3) replay-resistance claim.

## 3. Signature derivation — matches Eqs. (3)–(5)
- `sigMaterial = SHAKE-256(username ‖ quantumNumber ‖ r, 64)` (:234–243) → `𝒮`.
- `pkHash = SHA-256(sigMaterial[0:32])[0:12]` uppercase (:245–250) → `ℋ_pk`.
- `msgHash = SHA-256(message)` (:252) → `ℋ_msg` (message content only; no longer
  `username|message|q_num`).
- `entropyHash = SHA-256(String(quantumNumber))` (:253) → `ℋ_ent`.
- `sigHash = SHA-256(msgHash : entropyHash : pkHash)` (:254–257); `signature =
  base64(sigHash)[0:24]` (:258) → `𝒢`.

## Webhook persistence / caching
- `photo-wall/src/app/api/webhook/[groupId]/route.ts`: caches per **sender** (not
  sender+text) so each user keeps a stable badge despite the now-random bundle; the nonce
  is persisted as `quantumNonce`.
