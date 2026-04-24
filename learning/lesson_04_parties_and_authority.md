# Lesson 4: Parties, Authority & the Authorization Model

> **Based on:** Daml 101 Video Series (Episode 7-8) + Official Docs: Parties & Authority
> **Difficulty:** Beginner → Intermediate
> **Time:** ~30 minutes

---

## How Authorization Works in DAML

DAML has a **formal authorization model** — every action on the ledger must be authorized by the right parties. This is enforced by the DAML runtime, not by application code.

### The Two Rules of Authorization

**Rule 1 — Creation:** A contract can only be created if all its signatories authorize it.

**Rule 2 — Exercise:** A choice can only be exercised if:
1. The controller authorizes it
2. All **required** signatories on newly created contracts are covered by the combined authority of (signatories of the contract being exercised + the controller)

---

## Authority in the Ledger Model

When a party exercises a choice, their **authority** flows into the `do` block:

```daml
template PaymentOrder
  with
    payer     : Party
    payee     : Party
    amount    : Decimal
  where
    signatory payer   -- payer's authority covers this contract

    choice Approve : ContractId Payment
      controller payee   -- payee's authority added here
      do
        -- Inside here: authority = {payer, payee}
        -- So we CAN create a contract signed by both:
        create Payment with
          from   = payer
          to     = payee
          amount = amount

template Payment
  with
    from   : Party
    to     : Party
    amount : Decimal
  where
    signatory from, to  -- both required — both are in scope above ✅
```

---

## Common Authorization Bug: Wrong Controller

```daml
-- ❌ BAD: Bank controls owner's transfers
template Account
  with
    bank    : Party
    owner   : Party
    balance : Decimal
  where
    signatory bank      -- only bank signs
    observer owner      -- owner just watches!

    choice Transfer : ContractId Account
      with
        recipient      : Party
        transferAmount : Decimal
      controller bank  -- bank alone can move owner's money!
      do
        create this with balance = balance - transferAmount
```

**What's wrong:** The `owner` is just an observer. The `bank` can drain their account at will.

```daml
-- ✅ GOOD: Owner controls their own transfers
template Account
  with
    bank    : Party
    owner   : Party
    balance : Decimal
  where
    signatory bank, owner   -- owner is now a signatory

    ensure balance >= 0.0

    choice Transfer : ContractId Account
      with
        recipient      : Party
        transferAmount : Decimal
      controller owner       -- owner controls transfers
      do
        assert (transferAmount > 0.0)
        assert (transferAmount <= balance)
        create this with balance = balance - transferAmount
```

---

## The Propose-Accept Pattern (Deep Dive)

This is essential for multi-party agreements:

```daml
module Lesson4 where

-- Party A proposes a loan
template LoanProposal
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
    rate     : Decimal
  where
    signatory lender    -- lender proposes (their signature)
    observer borrower   -- borrower can see the offer

    -- Borrower accepts → Loan created with BOTH signatures
    choice AcceptLoan : ContractId Loan
      controller borrower
      do
        -- Authority here: {lender (signatory), borrower (controller)}
        -- So we can create Loan signed by both ✅
        create Loan with
          lender   = lender
          borrower = borrower
          amount   = amount
          rate     = rate

    -- Borrower rejects
    choice RejectLoan : ()
      controller borrower
      do return ()

    -- Lender withdraws offer
    choice WithdrawOffer : ()
      controller lender
      do return ()


-- The actual loan — requires both parties
template Loan
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
    rate     : Decimal
  where
    signatory lender, borrower

    ensure amount > 0.0
        && rate >= 0.0
        && rate <= 100.0
```

### Why the Propose-Accept works:
```
Step 1: lender creates LoanProposal
        Authority needed:  {lender}
        Contract signatories: {lender} ✅

Step 2: borrower exercises AcceptLoan
        Authority available: {lender (from signatory), borrower (controller)}
        Loan needs: {lender, borrower} ✅
```

---

## Role Contracts (Ongoing Authorization)

For repeated interactions, use a **role contract** instead of individual proposals:

```daml
-- One-time setup: Exchange grants trading role to a firm
template TradingRole
  with
    exchange : Party
    firm     : Party
  where
    signatory exchange  -- exchange grants the role
    observer firm

    -- Firm can repeatedly create orders using this role
    nonconsuming choice CreateOrder : ContractId Order
      with
        asset    : Text
        quantity : Int
        price    : Decimal
      controller firm
      do
        -- exchange authority flows in (from signatory)
        create Order with
          exchange = exchange
          firm     = firm
          asset    = asset
          quantity = quantity
          price    = price


template Order
  with
    exchange : Party
    firm     : Party
    asset    : Text
    quantity : Int
    price    : Decimal
  where
    signatory exchange, firm  -- both sign ✅

    ensure quantity > 0
        && price > 0.0
```

### Proposal vs Role:
| | Propose-Accept | Role Contract |
|--|----------------|---------------|
| Use case | One-off agreements | Repeated interactions |
| Setup | Per agreement | Once |
| Flexibility | High | Medium |
| Example | Trade settlement | Trading membership |

---

## Privilege Laundering — Hidden Authority Bug

**One of the most dangerous DAML patterns.** A low-privilege choice secretly uses high-privilege signatory authority.

```daml
-- ❌ DANGEROUS: operator creates high-value contracts using CFO's authority
template Treasury
  with
    cfo      : Party
    operator : Party
  where
    signatory cfo      -- CFO's authority is available in ALL choice bodies

    choice WeeklyReconcile : ()   -- looks innocent...
      controller operator          -- operator can exercise this
      do
        -- ...but secretly creates a contract signed by the CFO!
        create CashAdvance with
          issuer    = cfo       -- using CFO's signatory authority!
          recipient = operator
          amount    = 500000.0  -- half a million!
        return ()
```

**Why this is dangerous:** The `operator` runs a routine-looking reconciliation, but secretly creates a high-value cash advance using the CFO's authority. The CFO never explicitly approved this.

```daml
-- ✅ FIXED: separate high-privilege actions into explicit choices
template Treasury
  with
    cfo      : Party
    operator : Party
    dailyLimit : Decimal
  where
    signatory cfo

    -- Low privilege: just generates a report
    nonconsuming choice WeeklyReconcile : Text
      controller operator
      do
        return "Reconciliation complete"

    -- High privilege: CFO must explicitly exercise this
    choice IssueCashAdvance : ContractId CashAdvance
      with
        recipient : Party
        amount    : Decimal
      controller cfo      -- CFO must actively do this
      do
        assert (amount > 0.0)
        assert (amount <= dailyLimit)
        create CashAdvance with
          issuer    = cfo
          recipient = recipient
          amount    = amount
```

---

## Exercise 4: Identify the Authorization Bug

Find the bug in this NFT marketplace:

```daml
template NFT
  with
    marketplace : Party
    creator     : Party
    owner       : Party
    tokenId     : Text
    price       : Decimal
  where
    signatory marketplace  -- only marketplace signs!
    observer creator, owner

    choice Buy : ContractId NFT
      with
        buyer : Party
      controller marketplace  -- marketplace controls purchases!
      do
        create this with owner = buyer
```

**Questions:**
1. Who can trigger a `Buy`?
2. Can `owner` prevent their NFT from being sold?
3. Can `creator` prevent their work from being transferred?
4. How would you fix this?

**Analysis:**
- The `marketplace` controls `Buy` — they can sell anyone's NFT to anyone without consent
- The `owner` is just an observer — no control over their asset
- The `creator` has no rights either

**Fix:**
```daml
template NFT
  with
    marketplace : Party
    creator     : Party
    owner       : Party
    tokenId     : Text
    price       : Decimal
  where
    signatory marketplace, creator  -- creator's consent needed
    observer owner

    ensure price > 0.0

    choice ListForSale : ContractId NFTListing
      controller owner            -- owner lists (they received it)
      do
        create NFTListing with
          marketplace = marketplace
          nftId       = self      -- reference to this contract
          seller      = owner
          price       = price

template NFTListing
  with
    marketplace : Party
    nftId       : ContractId NFT
    seller      : Party
    price       : Decimal
  where
    signatory marketplace, seller  -- seller consents to listing

    choice Buy : ContractId NFT
      with
        buyer : Party
      controller buyer   -- buyer initiates the purchase
      do
        nft <- fetch nftId
        exercise nftId Archive  -- explicit archival
        create nft with owner = buyer
```

---

## Key Takeaways

1. **Authority flows** from signatories + controllers into `do` blocks
2. **Wrong controller** = the most common DAML security bug
3. **Propose-Accept** is how two parties safely create multi-signatory contracts
4. **Role contracts** are for repeated, ongoing authorization
5. **Privilege laundering** — check every choice body for hidden high-authority actions
6. Before signing any template as signatory, **audit every choice** for what authority your signature enables

---

## Next Lesson
→ **Lesson 5: Privacy, Observers & Divulgence**
