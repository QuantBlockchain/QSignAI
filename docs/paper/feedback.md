# Paper Feedback — QSignAI

The paper is accurate on shot counts, the Bell-state witness, the HSL color formulas,
the fallback path, scaling parameters, and the API table. The points below are where the
paper and the implementation now diverge.

> Note: the original review found that the signature was **not** genuinely quantum-seeded
> (Circuit A collapsed 100 shots to the most-frequent 4-bit value, giving a deterministic
> number in [0, 15] and no nonce). The implementation has since been corrected to a genuine
> two-source QRNG (see `quantum-rng-implementation.md`). The feedback below reflects that
> corrected code — the remaining work is to bring the **paper** in line with it.

1. **Update Circuit A (Fig. 2 / Eqs. 1–2) to the two-source QRNG.** The paper still
   describes Circuit A as a 4-qubit `H → CNOT chain → seeded R_y rotations → measure`
   circuit whose most-frequent bitstring becomes `q_num = int(topBits, 2) mod 1001`. That
   design did not actually produce quantum randomness (the modal outcome is deterministic)
   and could only reach [0, 15], not [0, 1000]. The implementation now follows the
   canonical AWS reference (`amazon-braket-examples → Randomness/Randomness_Generation.ipynb`):
   it reads the **per-shot measurement bit stream** of a single-qubit Hadamard circuit from
   **two independent sources** — SV1 (ideal) and DM1 (noisy) — and condenses them with a
   **Toeplitz two-source extractor** into uniform output bits. Eq. (1)'s `R_y` seeding and
   Eq. (2)'s `mod 1001` should be replaced with this construction, which genuinely yields
   `q_num ∈ [0, 1000]`.

2. **Add the two-source / extractor story to §IV (Quantum Randomness Pipeline).** The paper
   should state that there are two simulator sources (SV1 + DM1) and a Toeplitz extractor,
   and that the extractor output supplies both `q_num` and the 32-byte nonce `r`. This is
   what makes the Eq. (3) replay-resistance claim true and what justifies the [0, 1000]
   range — without it, neither holds.

3. **Eqs. (3)–(5) are now accurate — verify the wording matches.** The implemented
   derivation is `𝒮 = SHAKE-256(username ‖ q_num ‖ r)`, `ℋ_pk = SHA-256(𝒮[0:32])[0:12]`
   (uppercase), and `𝒢 = base64(SHA-256(ℋ_msg : ℋ_ent : ℋ_pk))[0:24]` with
   `ℋ_msg = SHA-256(message)` and `ℋ_ent = SHA-256(q_num)`. This matches Eqs. (3)–(5); just
   confirm `ℋ_msg` is described as hashing the message content (the earlier code hashed
   `username|message|q_num`, which no longer applies).

*Source-code and notebook line references for each point are in `feedback-code-refs.md`.*
