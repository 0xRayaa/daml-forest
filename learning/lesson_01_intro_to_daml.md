# Lesson 1: Introduction to DAML

> **Based on:** Daml 101 Video Series (Episode 1-2)
> **Difficulty:** Beginner
> **Time:** ~20 minutes

---

## What is DAML?

**DAML** (Digital Asset Modeling Language) is a smart contract language built for **multi-party business applications** on distributed ledgers.

Unlike Ethereum/Solidity, DAML is designed for **enterprise use cases** — think banks, financial institutions, and regulated workflows where:
- Multiple organizations need to agree on shared data
- Privacy between counterparties matters
- Authorization must be provably enforced

> **Key insight:** DAML is not just a language — it's a complete programming model for multi-party agreements.

---

## The Problem DAML Solves

Imagine a **trade settlement** between two banks:
- Bank A and Bank B need to agree on the same facts
- They can't trust each other's internal databases
- A neutral third party (like SWIFT) is expensive and slow

DAML lets both banks run the **same smart contract** with cryptographic guarantees — no middleman needed.

### Real-world use cases:
| Use Case | Parties | DAML Role |
|----------|---------|-----------|
| Trade settlement | Buyer, Seller, Custodian | Atomic DVP |
| Loan origination | Bank, Borrower, Regulator | Multi-party workflow |
| NFT marketplace | Seller, Buyer, Platform | Ownership transfer |
| Insurance claim | Insurer, Insured, Adjuster | Claim lifecycle |

---

## The DAML Mental Model

Think of DAML contracts like **legal agreements** on a ledger:

```
A DAML Contract is:
  - A piece of data (the agreement terms)
  - Owned by specific parties (signatories)
  - Visible to specific parties (observers)
  - With specific actions available (choices)
```

### The Ledger
The **ledger** is an append-only log of contract events:
- `CREATE` — a new contract is born
- `EXERCISE` — an action is taken on a contract (may archive it)
- `ARCHIVE` — a contract is destroyed

Contracts are **immutable** — you never edit them. To change state, you archive the old contract and create a new one.

---

## Your First DAML Template

A **template** is the blueprint for a contract — like a class in OOP.

```daml
module Lesson1 where

-- A simple IOU (I Owe You) contract
template IOU
  with
    issuer  : Party   -- who owes the money
    owner   : Party   -- who is owed the money
    amount  : Decimal -- how much
  where
    signatory issuer  -- issuer must authorize creation
```

### Breaking it down:

| Part | Meaning |
|------|---------|
| `template IOU` | Define a new contract type called IOU |
| `with` | The data fields this contract holds |
| `issuer : Party` | A field named "issuer" of type Party |
| `amount : Decimal` | A field named "amount" of type Decimal |
| `where` | Start of the contract's rules |
| `signatory issuer` | The issuer must sign to create this contract |

---

## Key Types in DAML

| Type | Description | Example |
|------|-------------|---------|
| `Party` | An entity on the ledger | Alice, Bob, BankA |
| `Text` | A string | `"hello"` |
| `Int` | 64-bit integer | `42` |
| `Decimal` | Fixed-point decimal (10 places) | `100.50` |
| `Bool` | True or false | `True` |
| `Time` | Ledger timestamp | `2024-01-01T00:00:00Z` |
| `[a]` | List of type a | `[1, 2, 3]` |
| `Optional a` | Maybe a value | `Some 42` or `None` |

---

## Signatories — The Most Important Concept

**Signatories** are the parties who authorize a contract's existence. Their consent is required for:
1. **Creating** the contract
2. **Archiving** the contract

```daml
template Loan
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
  where
    signatory lender, borrower  -- BOTH must authorize creation!
```

> **Rule:** Every template MUST have at least one signatory.

### What signatories guarantee:
- A signatory can ALWAYS see their own contracts
- No one can create a contract using your signature without your consent
- No one can archive a contract without all signatories' consent

---

## Exercise 1: Write Your First Template

Complete the template below for a simple bank account:

```daml
-- TODO: Fill in the blanks
template BankAccount
  with
    bank    : Party
    owner   : Party
    balance : Decimal
    iban    : Text
  where
    signatory ___  -- who should authorize account creation?
    observer  ___  -- who should be able to see but not control?
```

**Answer:**
```daml
template BankAccount
  with
    bank    : Party
    owner   : Party
    balance : Decimal
    iban    : Text
  where
    signatory bank, owner  -- both bank and owner authorize
    observer  bank         -- bank can always see (they're signatory here anyway)
```

> **Discussion:** Should `owner` be a signatory or just an observer? What's the difference in trust?

---

## Key Takeaways

1. DAML is for **multi-party applications** where parties need shared truth
2. A **template** is the blueprint for a contract type
3. **Signatories** must authorize contract creation — this is DAML's core security
4. Contracts are **immutable** — you archive and recreate to change state
5. The ledger is an **append-only log** of create/archive events

---

## Next Lesson
→ **Lesson 2: Choices — How Contracts Evolve**
