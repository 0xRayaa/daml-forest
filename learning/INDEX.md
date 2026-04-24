# DAML Learning Curriculum — Index

> **Total lessons:** 8 core + 1 cheat sheet
> **Progression:** Beginner → Advanced

---

## Lesson Map

| # | File | Topic | Level | Key Concepts |
|---|------|--------|-------|-------------|
| 1 | `lesson_01_intro_to_daml.md` | Introduction to DAML | Beginner | Templates, signatories, ledger model |
| 2 | `lesson_02_choices.md` | Choices | Beginner | Consuming/nonconsuming, propose-accept, `<-` bind |
| 3 | `lesson_03_data_types_and_ensure.md` | Data Types & `ensure` | Beginner | Int/Decimal, records, variants, `ensure`, `assert` |
| 4 | `lesson_04_parties_and_authority.md` | Parties & Authority | Beginner→Intermediate | Authorization model, wrong controller, privilege laundering |
| 5 | `lesson_05_privacy_and_divulgence.md` | Privacy & Divulgence | Intermediate | Observers, divulgence via fetch, nested chains, data splitting |
| 6 | `lesson_06_utxo_conservation.md` | UTXO & Conservation | Intermediate | Value leakage, multi-path bugs, double spend |
| 7 | `lesson_07_time_and_deadlines.md` | Time & Deadlines | Intermediate→Advanced | Skew, grace periods, TOCTOU, query ordering |
| 8 | `lesson_08_keys_and_contention.md` | Keys & Contention | Advanced | `fetchByKey`, concurrent races, hot contracts |

---

## Learning Path by Role

### 🟢 DAML Developer (New)
Start here:
1. Lesson 1 → 2 → 3 → 4
2. Practice: Build a simple IOU system with propose-accept
3. Lesson 5 → 6
4. Practice: Build a token with conservation checks

### 🟡 DAML Developer (Security Focus)
All 8 lessons, then:
- Work through all exercises
- Review Security Guides directly for edge cases
- Focus on Lessons 4, 5, 6 most deeply

### 🔴 DAML Security Auditor
All 8 lessons, then read:
- `/DAML_Security_Guide.md` — comprehensive vulnerability catalogue
- `/DAML_Security_Guide_2_OpenZeppelin.md` — Canton-specific findings
- `/DAML_Security_Guide_Final.md` — consolidated audit reference

---

## Top 10 DAML Security Checklist

Use this for every template you review:

```
□ 1. AUTHORIZATION
      - Is the controller the right party for each choice?
      - Is owner a signatory (not just observer) where they need control?
      - Does any low-privilege choice body use high-privilege authority?

□ 2. ENSURE CLAUSES
      - Are all numeric fields bounded (> 0, < max)?
      - Are all party relationships validated (lender != borrower)?
      - Is every template field validated at creation?

□ 3. CONSERVATION (for value-bearing contracts)
      - Does sum(outputs) == sum(inputs) for every consuming choice?
      - Are there multiple transfer paths? Does conservation hold on ALL?
      - Is there an assert checking the invariant at runtime?

□ 4. CHOICE CONSUMPTION
      - Is any value-creating choice nonconsuming? (→ infinite mint risk)
      - Can the same voucher/coupon be redeemed multiple times?

□ 5. PRIVACY
      - Are there unnecessary observers (competitors, unrelated parties)?
      - Does any choice fetch a contract whose owner is not the submitter?
      - Are there nested exercise chains that leak private data?

□ 6. TIME
      - Are deadline comparisons using grace periods (not exact)?
      - Are Settle and Expire windows mutually exclusive?
      - Are all temporal choices enforcing time constraints?

□ 7. KEYS & REFERENCES
      - Is lookupByKey used without a subsequent fetchByKey? (TOCTOU)
      - Can concurrent callers both register the same key?
      - Are caller-supplied ContractIds validated after fetching?

□ 8. ARITHMETIC
      - Can any governance parameter be zero (→ division abort)?
      - Are multiplications bounded to prevent Int overflow?
      - Are decimal divisions minimized to reduce precision loss?

□ 9. GOVERNANCE / ADMIN
      - Can a single bad admin parameter disable multiple workflows?
      - Do admin update choices re-validate new parameters?
      - Is there a maximum bound on every admin-settable parameter?

□ 10. LIFECYCLE
       - Can a contract be permanently locked (no way to archive)?
       - Is there an escape hatch if a signatory becomes unresponsive?
       - Are all choice return types handled by callers?
```

---

## DAML vs Ethereum — Cheat Sheet

| Topic | Ethereum/Solidity | DAML |
|-------|-------------------|------|
| State model | Account (balances incremented) | UTXO (contracts archived/created) |
| Reentrancy | Critical vulnerability | Impossible |
| MEV/Front-running | Common | Prevented (encrypted payloads) |
| Flash loans | Wide attack surface | No facility |
| Overflow | Reverts (Solidity 0.8+) | `ArithmeticError` aborts tx |
| Privacy | All state public | Need-to-know by default |
| Authorization | Manual (`require(msg.sender == owner)`) | Formal, runtime-enforced |
| Value conservation | Hard to violate | Easy to violate by accident |
| Key vulnerability | Reentrancy, access control | Conservation, divulgence, wrong controller |
