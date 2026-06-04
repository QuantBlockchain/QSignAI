# Paper Feedback — QSignAI

The paper is accurate on circuit shapes, shot counts, the SV1 device, the HSL color
formulas, the fallback path, scaling parameters, and the API table. The points below are
where it diverges from the implementation. Point 1 is the substantive one; points 2–4 are
equation/figure accuracy.

1. **The signature is not actually seeded by a quantum random number, and the stated range
   is wrong.** Circuit A runs 100 shots but the code keeps only the *most-frequent* 4-bit
   bitstring (`parseInt(topBits, 2) % 1001`). This (a) discards the per-shot quantum
   randomness — the modal outcome is a deterministic function of `(username, message)`, so
   the same input always yields the same number; (b) lives in **[0, 15]**, not [0, 1000]
   (the `mod 1001` is a no-op on a 4-bit value), so Eq. (6) maps to only 16 distinct hues;
   and (c) means the "32 fresh random bytes `r` preventing replay" of Eq. (3) does not
   exist — there is no nonce, so a captured signature can be replayed.

   *The fix follows the canonical AWS reference*, `amazon-braket-examples`
   `.../Randomness/Randomness_Generation.ipynb`: read the **per-shot measurement bit
   stream** (one quantum-random bit per Hadamard shot) from **two independent sources** and
   condense them through a **Toeplitz two-source extractor** into provably-uniform output.
   The extractor output then supplies both a genuine `q_num ∈ [0, 1000]` and the 32-byte
   `r`. A concrete construction for this project is in
   [`quantum-rng-implementation.md`](quantum-rng-implementation.md).

2. **Eqs. (3)–(5) don't match the actual inputs.** The hash chain currently includes the
   message text and a domain-separation tag and omits `r`; the "message hash" is computed
   over `username + message + quantum number` rather than message content alone. Once `r`
   is reintroduced (point 1), the equations should be updated to reflect the real
   pre-images and ordering.

3. **(Minor) Eq. (1) / Fig. 2 — the `R_y` rotation seed is `username + message`, not the
   username alone**, and for short usernames the angles draw from message bytes. Note that
   the recommended QRNG redesign (point 1) replaces this seeded-rotation circuit with a
   plain Hadamard bit-stream design, so Fig. 2 / Eq. (1) would change accordingly.

*Source-code and notebook line references for each point are in `feedback-code-refs.md`.*
