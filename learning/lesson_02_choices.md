# Lesson 2: Choices — How Contracts Evolve

> **Based on:** Daml 101 Video Series (Episode 3-4)
> **Difficulty:** Beginner
> **Time:** ~25 minutes

---

## What Are Choices?

In DAML, a contract is static — its data never changes. **Choices** are the only way to evolve the ledger state.

A choice is like a **method on a contract** that:
1. Can only be exercised by its **controller**
2. Archives the current contract (by default — "consuming")
3. Can create new contracts as output
4. Can exercise choices on other contracts

```daml
template IOU
  with
    issuer : Party
    owner  : Party
    amount : Decimal
  where
    signatory issuer

    choice Transfer : ContractId IOU   -- returns a new IOU contract ID
      with
        newOwner : Party               -- input parameter
      controller owner                 -- only owner can transfer
      do
        create this with owner = newOwner  -- archive this, create new one
```

---

## Anatomy of a Choice

```daml
    choice ChoiceName : ReturnType
      with
        param1 : Type1     -- choice parameters (inputs)
        param2 : Type2
      controller someParty -- who can exercise this
      do
        -- actions here
        -- last expression is the return value
```

### The `do` Block
The `do` block is a sequence of actions:
- `create` — create a new contract
- `exercise` — exercise a choice on a contract
- `fetch` — read a contract's data
- `archive` — explicitly archive a contract
- `assert` — check a condition, fail if false
- `return` — wrap a pure value as an action

---

## Consuming vs Non-Consuming Choices

### Consuming (Default)
The contract is **archived** when the choice is exercised. It can never be used again.

```daml
    -- Consuming (default) — IOU is gone after Transfer
    choice Transfer : ContractId IOU
      with newOwner : Party
      controller owner
      do
        create this with owner = newOwner
```

### Non-Consuming
The contract **stays active** — the choice is like a read or side-effect.

```daml
    -- Non-consuming — IOU stays alive, just emits a view
    nonconsuming choice GetBalance : Decimal
      controller owner
      do
        return amount
```

> **Security note:** `nonconsuming` choices that modify state (like creating payment records) can be exploited for **infinite replay**. A voucher with a nonconsuming `Redeem` choice can be redeemed unlimited times!

---

## Building a Complete IOU Example

```daml
module Lesson2 where

template IOU
  with
    issuer  : Party
    owner   : Party
    amount  : Decimal
  where
    signatory issuer
    observer owner

    -- Transfer ownership to someone else
    choice Transfer : ContractId IOU
      with
        newOwner : Party
      controller owner
      do
        create this with owner = newOwner

    -- Split this IOU into two
    choice Split : (ContractId IOU, ContractId IOU)
      with
        splitAmount : Decimal
      controller owner
      do
        assert (splitAmount > 0.0)
        assert (splitAmount < amount)
        iou1 <- create this with amount = splitAmount
        iou2 <- create this with amount = amount - splitAmount
        return (iou1, iou2)

    -- Issuer cancels the IOU
    choice Cancel : ()
      controller issuer
      do
        return ()   -- just archives the contract
```

---

## The `<-` (Bind) Operator

Inside `do` blocks, `<-` extracts the result of an action:

```daml
do
  -- create returns a ContractId IOU
  newCid <- create IOU with
    issuer = alice
    owner  = bob
    amount = 100.0

  -- exercise returns whatever the choice returns
  result <- exercise newCid Transfer with newOwner = charlie

  return result
```

---

## The Propose-Accept Pattern

This is the most important workflow pattern in DAML.

**Problem:** How do two parties create a contract that requires both signatures?
- Alice can't create a contract with Bob's signature without his consent
- Bob can't create it unilaterally with Alice's name on it

**Solution:** Two-step proposal + acceptance:

```daml
module Lesson2 where

-- Step 1: Alice proposes a trade
template TradeProposal
  with
    buyer  : Party
    seller : Party
    asset  : Text
    price  : Decimal
  where
    signatory buyer   -- only buyer signs the proposal
    observer seller   -- seller can see it

    -- Seller accepts → creates the real Trade contract
    choice Accept : ContractId Trade
      controller seller
      do
        create Trade with
          buyer  = buyer
          seller = seller
          asset  = asset
          price  = price

    -- Buyer can withdraw their offer
    choice Withdraw : ()
      controller buyer
      do
        return ()

-- Step 2: The actual trade (requires both signatures)
template Trade
  with
    buyer  : Party
    seller : Party
    asset  : Text
    price  : Decimal
  where
    signatory buyer, seller  -- BOTH sign now
    observer buyer, seller
```

### Why this works:
1. Buyer creates `TradeProposal` (only needs buyer's signature)
2. Seller sees it (they're an observer)
3. Seller exercises `Accept` → creates `Trade`
4. DAML automatically checks that the `Trade` creation is authorized by seller (as the exercising controller) AND buyer (as existing signatory of the proposal that exercised Accept)

---

## Observers

**Observers** can see a contract but cannot exercise choices on it.

```daml
template Invoice
  with
    vendor   : Party
    customer : Party
    auditor  : Party     -- third-party who needs visibility
    amount   : Decimal
  where
    signatory vendor
    observer customer, auditor  -- can see but not control
```

### Signatory vs Observer:

| | Signatory | Observer |
|--|-----------|----------|
| Can see contract | ✅ | ✅ |
| Must authorize creation | ✅ | ❌ |
| Must authorize archival | ✅ | ❌ |
| Can exercise choices | Only if also controller | ❌ |

---

## Exercise 2: Complete the Choice

Fill in the missing parts of this Loan repayment choice:

```daml
template Loan
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
  where
    signatory lender, borrower

    choice Repay : ___           -- what should this return?
      with
        repayAmount : Decimal
      controller ___             -- who repays?
      do
        assert (___ > 0.0)       -- validate the repayment amount
        assert (___ <= amount)   -- can't repay more than owed
        let remaining = amount - repayAmount
        if remaining > 0.0
          then do
            cid <- create this with amount = ___
            return (Some cid)    -- still some debt remaining
          else
            return None          -- fully paid off!
```

**Answer:**
```daml
    choice Repay : Optional (ContractId Loan)
      with
        repayAmount : Decimal
      controller borrower
      do
        assert (repayAmount > 0.0)
        assert (repayAmount <= amount)
        let remaining = amount - repayAmount
        if remaining > 0.0
          then do
            cid <- create this with amount = remaining
            return (Some cid)
          else
            return None
```

---

## Key Takeaways

1. **Choices** are the only way to evolve contract state
2. **Consuming choices** (default) archive the contract — prevents double-spend
3. **Non-consuming choices** keep the contract alive — use carefully!
4. The **controller** is who can exercise the choice
5. **Propose-Accept** is the standard pattern for multi-party agreement
6. `<-` binds the result of an action in a `do` block

---

## Next Lesson
→ **Lesson 3: Data Types and the `ensure` Clause**
