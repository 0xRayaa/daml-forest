# DAML Smart Contract Security: The Complete Guide

### Common Vulnerabilities, Exploits, Attack Patterns & Best Practices

> **Audience:** Developers, auditors, and security researchers working with DAML & Canton
> **Scope:** Unified reference of the most common DAML / Canton vulnerabilities and attack patterns
> **By:** CredShields

---

## Preface

Consolidated reference covering the **most common and moderately complex** DAML/Canton vulnerabilities -- the ones that actually show up in audits. Trivially basic issues (missing `ensure`, unnecessary observers, etc.) and rare edge cases are intentionally omitted in favor of the examples that audit reviewers encounter most often.

### Why DAML Security Is Different

DAML eliminates several Ethereum vulnerability classes by design (reentrancy, MEV, flash loans, silent integer overflow, global state visibility) but introduces its own distinctive classes: value leakage in UTXO outputs, admin-parameter DoS via arithmetic, time-skew edge failures, participant-dependent ordering, divulgence via fetch, and authority laundering — all covered in the sections below.

---

## Table of Contents

1. [Authorization & Signatory Model](#1-authorization--signatory-model)
2. [Privacy, Confidentiality & Side-Channels](#2-privacy-confidentiality--side-channels)
3. [Arithmetic, Conservation & Governance](#3-arithmetic-conservation--governance)
4. [Time, Ordering & Multi-Sync](#4-time-ordering--multi-sync)
5. [Keys, References & Workflow](#5-keys-references--workflow)
6. [Choice Design, Lifecycle & Contention](#6-choice-design-lifecycle--contention)
7. [Canton Infrastructure, API & Upgrades](#7-canton-infrastructure-api--upgrades)
8. [Triggers & Off-Ledger Integration](#8-triggers--off-ledger-integration)

---

## 1. Authorization & Signatory Model

### 1.1 Wrong Controller on Choices

**Vulnerable:**

```daml
template Account
  with
    bank : Party
    owner : Party
    balance : Decimal
  where
    signatory bank                -- owner is NOT a signatory
    observer owner

    choice Transfer : (ContractId Account, ContractId Account)
      with
        recipient : Party
        transferAmount : Decimal
      controller bank             -- bank transfers owner's money without consent
      do
        senderAccount <- create this with balance = balance - transferAmount
        recipientAccount <- create Account with
          bank = bank
          owner = recipient
          balance = transferAmount
        return (senderAccount, recipientAccount)
```

*Bug:* the bank alone authorizes transfers from the owner's account; the owner has no say over their own funds.

**Fixed:**

```daml
template Account
  with
    bank : Party
    owner : Party
    balance : Decimal
  where
    signatory bank, owner         -- owner now signs creation
    observer bank

    ensure balance >= 0.0

    choice Transfer : (ContractId Account, ContractId Account)
      with
        recipient : Party
        transferAmount : Decimal
      controller owner            -- owner controls their own transfers
      do
        assert (transferAmount > 0.0)
        assert (transferAmount <= balance)
        senderAccount <- create this with balance = balance - transferAmount
        recipientAccount <- create Account with
          bank = bank
          owner = recipient
          balance = transferAmount
        return (senderAccount, recipientAccount)
```

*Fix:* owner becomes a signatory (consent required at creation) and the Transfer controller (consent required per transfer); amount is also bounds-checked.

**Variant — caller-specified controller:** if the controller references a choice argument (`controller payee` where `payee` is in the `with` block), any visible party can submit themselves as `payee` and drain the contract. Controllers must resolve to template fields, never to caller-supplied values.

### 1.2 Privilege Laundering in Choice Bodies

Every choice body runs with the **combined authority of signatories + controllers**. A malicious/negligent template can bury high-authority operations inside a low-privilege controller's choice.

**Vulnerable:**

```daml
template Treasury
  with
    cfo : Party
    operator : Party
    dailyLimit : Decimal
  where
    signatory cfo                 -- cfo's authority is in scope for every choice body
    observer operator

    choice WeeklyReconcile : ContractId ReconcileReport
      controller operator         -- low-privilege caller
      do
        now <- getTime
        -- body silently creates a high-authority contract using CFO's signatory authority
        cashAdvanceCid <- create CashAdvance with
          issuer = cfo
          recipient = operator
          amount = 500000.0
        create ReconcileReport with
          treasury = self
          runBy = operator
          runAt = now
          notes = "weekly reconciliation"

template CashAdvance
  with
    issuer : Party
    recipient : Party
    amount : Decimal
  where
    signatory issuer
    observer recipient

template ReconcileReport
  with
    treasury : ContractId Treasury
    runBy : Party
    runAt : Time
    notes : Text
  where
    signatory runBy
```

*Bug:* a low-privilege `operator` exercises a routine-looking choice whose body creates CFO-signed liabilities, laundering the CFO's signatory authority into the operator's workflow.

**Fixed:**

```daml
template Treasury
  with
    cfo : Party
    operator : Party
    dailyLimit : Decimal
  where
    signatory cfo
    observer operator

    -- low-privilege choice has no high-authority side effects
    nonconsuming choice WeeklyReconcile : ReconcileReport
      controller operator
      do
        now <- getTime
        return ReconcileReport with
          treasury = self
          runBy = operator
          runAt = now
          notes = "weekly reconciliation"

    -- high-privilege action must be authorized explicitly by the CFO
    choice IssueCashAdvance : ContractId CashAdvance
      with
        recipient : Party
        amount : Decimal
      controller cfo
      do
        assert (amount > 0.0)
        assert (amount <= dailyLimit)
        create CashAdvance with
          issuer = cfo
          recipient = recipient
          amount = amount
```

*Fix:* the low-privilege choice body does nothing that requires CFO authority; high-privilege actions live in a separate choice explicitly controlled by the CFO, with a bounds-check on the amount.

**Related anti-pattern — consent-trap templates:** making someone a signatory on a benign-sounding template (e.g., "Partnership") and then including choices where the other signatory can act unilaterally with their authority. Audit every choice before agreeing to be a signatory.

---

## 2. Privacy, Confidentiality & Side-Channels

### 2.1 Divulgence via Fetch

The submitter of a transaction learns every contract fetched in its tree -- even if not a stakeholder.

**Vulnerable:**

```daml
template SecretPricing
  with
    dealer : Party
    secretSpread : Decimal
  where
    signatory dealer              -- client is NOT a stakeholder

template PublicQuote
  with
    dealer : Party
    client : Party
    pricingRef : ContractId SecretPricing
  where
    signatory dealer
    observer client               -- client can see this (and the pricingRef handle)

    choice GetQuote : Decimal
      with
        basePrice : Decimal
      controller client           -- client submits the transaction
      do
        pricing <- fetch pricingRef
        -- fetch runs inside a transaction submitted by client ->
        -- the full SecretPricing contract is divulged to client
        return (basePrice + pricing.secretSpread)
```

*Bug:* the client is the submitter; fetching `SecretPricing` inside the choice body divulges its full contents to them even though they aren't a stakeholder.

**Fixed:**

```daml
template SecretPricing
  with
    dealer : Party
    secretSpread : Decimal
  where
    signatory dealer

    -- dealer computes the quote under their own authority; client never touches SecretPricing
    nonconsuming choice CalculateQuote : Decimal
      with
        basePrice : Decimal
      controller dealer
      do
        return (basePrice + secretSpread)

template QuoteRequest
  with
    dealer : Party
    client : Party
    basePrice : Decimal
  where
    signatory client
    observer dealer

    -- dealer submits the processing transaction -> fetches run under dealer's authority
    choice FulfillQuote : ContractId Quote
      with
        pricingRef : ContractId SecretPricing
      controller dealer
      do
        pricing <- fetch pricingRef
        create Quote with
          dealer = dealer
          client = client
          price = basePrice + pricing.secretSpread

template Quote
  with
    dealer : Party
    client : Party
    price : Decimal
  where
    signatory dealer
    observer client
```

*Fix:* invert the workflow — the client writes a request; the dealer submits the processing transaction, so the fetch runs under dealer's authority and nothing leaks to the client.

### 2.2 Nested Exercise Divulgence Chains

The divulgence problem compounds when choice A exercises choice B which fetches C -- the original submitter sees C.

**Vulnerable:**

```daml
template MasterAgreement
  with
    broker : Party
    client : Party
    subAccountRef : ContractId SubAccount
  where
    signatory broker
    observer client

    choice ExecuteTrade : ContractId TradeConfirmation
      with
        asset : Text
        qty : Int
      controller client           -- client submits the whole transaction tree
      do
        -- nested exercise: ExecuteTrade -> AllocateFunds -> fetch CreditLimit
        -- every fetched contract (CreditLimit, RiskProfile, etc.) divulged to client
        exercise subAccountRef (AllocateFunds with asset = asset; qty = qty)

template SubAccount
  with
    broker : Party
    creditRef : ContractId CreditLimit
  where
    signatory broker

    choice AllocateFunds : ContractId TradeConfirmation
      with
        asset : Text
        qty : Int
      controller broker
      do
        credit <- fetch creditRef   -- leaked all the way up to the client
        assert (credit.limit >= qty)
        create TradeConfirmation with
          broker = broker
          asset = asset
          qty = qty

template CreditLimit
  with
    broker : Party
    client : Party
    limit : Int
  where
    signatory broker
```

*Bug:* the client submits the whole transaction tree; every contract fetched in any nested choice (CreditLimit, RiskProfile, etc.) is divulged to them.

**Fixed:**

```daml
-- break the chain: client only creates a request; broker processes it under their own authority
template MasterAgreement
  with
    broker : Party
    client : Party
  where
    signatory broker
    observer client

    choice RequestTrade : ContractId TradeRequest
      with
        asset : Text
        qty : Int
      controller client
      do
        create TradeRequest with
          broker = broker
          client = client
          asset = asset
          qty = qty

template TradeRequest
  with
    broker : Party
    client : Party
    asset : Text
    qty : Int
  where
    signatory client
    observer broker

    -- broker submits THIS transaction -> fetches run under broker's authority
    choice ProcessRequest : ContractId TradeConfirmation
      with
        subAccountRef : ContractId SubAccount
      controller broker
      do
        exercise subAccountRef (AllocateFunds with asset = asset; qty = qty)
```

*Fix:* break the chain at the client boundary — client writes only a request; broker runs all downstream fetches under their own authority.

**Timing side-channel note:** Canton provides sub-transaction privacy for payloads but **not for notification timing**. A custodian observing a `SettlementInstruction` at `14:32:05` correlated with public market data can infer who traded. Mitigate with batching, randomized delay, or aggregation for OTC/bilateral settlement flows.

---

## 3. Arithmetic, Conservation & Governance

### 3.1 Value Leakage via Output Imbalance (UTXO-Specific)

**The #1 DAML-specific vulnerability class.** In Canton's UTXO model, every choice must explicitly recreate outputs whose sum equals the input — any unallocated value vanishes from existence.

**Vulnerable:**

```daml
template Token
  with
    issuer : Party
    owner : Party
    amount : Decimal
  where
    signatory issuer, owner

    ensure amount > 0.0

    choice Transfer : (ContractId Token, ContractId Token)
      with
        recipient : Party
        transferAmount : Decimal
      controller owner
      do
        assert (transferAmount > 0.0)
        assert (transferAmount <= amount)
        let fee = transferAmount * 0.001
        let recipientGets = transferAmount - fee
        let senderRemaining = amount - transferAmount

        sender <- create this with amount = senderRemaining
        receiver <- create Token with
          issuer = issuer
          owner = recipient
          amount = recipientGets
        -- Input:  amount
        -- Output: senderRemaining + recipientGets
        --       = (amount - transferAmount) + (transferAmount - fee)
        --       = amount - fee
        -- OUTPUT IMBALANCE: fee tokens are destroyed (input != sum of outputs)
        return (sender, receiver)
```

*Bug:* the fee is deducted from the outputs but never assigned to any output contract — those tokens vanish from existence.

**Fixed:**

```daml
template Token
  with
    issuer : Party
    owner : Party
    amount : Decimal
  where
    signatory issuer, owner

    ensure amount > 0.0

    choice Transfer : (ContractId Token, ContractId Token, ContractId Token)
      with
        recipient : Party
        transferAmount : Decimal
        feeCollector : Party
      controller owner
      do
        assert (transferAmount > 0.0)
        assert (transferAmount <= amount)
        let fee = transferAmount * 0.001
        let recipientGets = transferAmount - fee
        let senderRemaining = amount - transferAmount

        -- runtime check: output-sum invariant
        assert (senderRemaining + recipientGets + fee == amount)

        sender <- create this with amount = senderRemaining
        receiver <- create Token with
          issuer = issuer
          owner = recipient
          amount = recipientGets
        feeToken <- create Token with
          issuer = issuer
          owner = feeCollector
          amount = fee
        return (sender, receiver, feeToken)
```

*Fix:* fee is created as a third Token output; a runtime sum-assertion verifies inputs equal outputs.

**Why this is a class, not a bug:** Ethereum's account model makes this hard to write (`balance -= x` can't lose tokens). Canton's UTXO model makes it easy. Multi-path systems (direct transfer + merge + lock) compound the risk — the output-sum invariant can hold per-path but silently break across path combinations.

### 3.2 Admin-Parameter Driven Transaction Aborts (DoS)

Admin- or governance-controlled parameters flowing into arithmetic abort entire transactions on div-by-zero or overflow — a liveness/DoS risk that propagates across every workflow touching the parameter.

**Vulnerable:**

```daml
template LendingPool
  with
    operator : Party
    collateralRatio : Decimal         -- admin-set; no bounds
    liquidationThreshold : Decimal
    feeRate : Decimal
  where
    signatory operator

    nonconsuming choice CalculateBorrowLimit : Decimal
      with
        collateralValue : Decimal
      controller operator
      do
        -- if admin sets collateralRatio = 0.0 this aborts
        -- every workflow that ever calls this choice is dead
        return (collateralValue / collateralRatio)

    nonconsuming choice CheckLiquidation : Bool
      with
        debtValue : Decimal
        collateralValue : Decimal
      controller operator
      do
        -- if debtValue = 0.0 this aborts -- no liquidation checks across the pool
        let ratio = collateralValue / debtValue
        return (ratio < liquidationThreshold)
```

*Bug:* one misconfigured governance parameter (a zero divisor) aborts every choice that touches it — a system-wide DoS from a single admin update.

**Fixed:**

```daml
template LendingPool
  with
    operator : Party
    collateralRatio : Decimal
    liquidationThreshold : Decimal
    feeRate : Decimal
  where
    signatory operator

    -- bound every admin-controlled parameter at the template level
    ensure collateralRatio > 0.0
      && collateralRatio <= 10.0
      && liquidationThreshold > 0.0
      && liquidationThreshold < collateralRatio
      && feeRate > 0.0
      && feeRate <= 1.0

    nonconsuming choice CalculateBorrowLimit : Decimal
      with
        collateralValue : Decimal
      controller operator
      do
        assert (collateralValue >= 0.0)
        return (collateralValue / collateralRatio)   -- SAFE: ratio > 0 by ensure

    nonconsuming choice CheckLiquidation : Bool
      with
        debtValue : Decimal
        collateralValue : Decimal
      controller operator
      do
        assert (collateralValue >= 0.0)
        if debtValue <= 0.0
          then return False                           -- explicit zero guard
          else return (collateralValue / debtValue < liquidationThreshold)

    -- admin updates must re-validate, not just trust the next contract
    choice UpdateParameters : ContractId LendingPool
      with
        newCollateralRatio : Decimal
        newLiquidationThreshold : Decimal
        newFeeRate : Decimal
      controller operator
      do
        assert (newCollateralRatio > 0.0 && newCollateralRatio <= 10.0)
        assert (newLiquidationThreshold > 0.0 && newLiquidationThreshold < newCollateralRatio)
        assert (newFeeRate > 0.0 && newFeeRate <= 1.0)
        create this with
          collateralRatio = newCollateralRatio
          liquidationThreshold = newLiquidationThreshold
          feeRate = newFeeRate
```

*Fix:* template-level `ensure` bounds all admin parameters; explicit zero-guards before each division; update-parameter choice re-validates before creating the new state.

---

## 4. Time, Ordering & Multi-Sync

Canton's time model: **ledger time has bounded skew** between participant-proposed and sequencer-recorded; **cross-synchronizer events have no global causality**.

### 4.1 Exact Time Comparisons Fail Under Skew

**Vulnerable:**

```daml
template SettlementInstruction
  with
    sender : Party
    receiver : Party
    amount : Decimal
    settlementDeadline : Time
  where
    signatory sender
    observer receiver

    choice Settle : ContractId SettledPayment
      controller receiver
      do
        now <- getTime
        -- exact boundary: skew between participant-proposed and
        -- sequencer-recorded time can reject a valid on-time submission
        assert (now <= settlementDeadline)
        create SettledPayment with
          sender = sender
          receiver = receiver
          amount = amount
          settledAt = now

template SettledPayment
  with
    sender : Party
    receiver : Party
    amount : Decimal
    settledAt : Time
  where
    signatory sender, receiver
```

*Bug:* participant proposes 16:59:58, sequencer records 17:00:03, deadline 17:00:00 → transaction rejected despite being submitted on time.

**Fixed:**

```daml
template SettlementInstruction
  with
    sender : Party
    receiver : Party
    amount : Decimal
    settlementDeadline : Time
    skewTolerance : RelTime            -- e.g., minutes 5
  where
    signatory sender
    observer receiver

    ensure amount > 0.0

    choice Settle : ContractId SettledPayment
      controller receiver
      do
        now <- getTime
        -- Settle window: [ -inf, deadline + tolerance ]
        assert (now <= addRelTime settlementDeadline skewTolerance)
        create SettledPayment with
          sender = sender
          receiver = receiver
          amount = amount
          settledAt = now

    -- inverse buffer: Settle and Expire windows never overlap
    choice Expire : ()
      controller sender
      do
        now <- getTime
        -- Expire window: ( deadline + tolerance, +inf ]
        assert (now > addRelTime settlementDeadline skewTolerance)
        return ()
```

*Fix:* deadline + tolerance on Settle; deadline + tolerance also the **lower** bound on Expire — mutually exclusive windows that absorb skew.

### 4.2 Participant-Dependent Query Ordering

**The silent production killer.** Canton guarantees causal consistency, not total ordering. Query results arrive in different orders on different participants.

**Vulnerable:**

```daml
paymentProcessorRule : Party -> TriggerA () ()
paymentProcessorRule party = do
  invoices <- query @Invoice
  case invoices of
    [] -> return ()
    ((cid, _) :: _) -> do
      -- "head invoices" returns the query's first result.
      -- The Ledger API does NOT guarantee deterministic ordering, and different
      -- participants can see different orderings:
      --   Node A might return oldest-due first
      --   Node B might return newest first
      --   Node C might return random
      dedupExercise cid ProcessPayment
```

*Bug:* query result order differs across participants; "first" picks different invoices on different nodes. Passes single-node tests; fails intermittently in multi-node production with duplicate payments, skipped invoices, or wrong-invoice processing.

**Fixed:**

```daml
paymentProcessorRule : Party -> TriggerA () ()
paymentProcessorRule party = do
  invoices <- query @Invoice
  -- sort by a stable, deterministic field BEFORE picking
  let sorted = sortBy (\(_, a) (_, b) -> compare a.dueDate b.dueDate) invoices
  case sorted of
    [] -> return ()
    ((cid, _) :: _) -> do
      -- every participant now picks the same invoice (oldest due first)
      dedupExercise cid ProcessPayment
```

*Fix:* sort by a deterministic field (dueDate) before selecting — every node picks the same invoice.

**Cross-synchronizer note:** workflows spanning multiple synchronizers must not assume ordering. Use state-machine contracts where each leg reports completion independently; converge only when all legs confirm. Reassignment also creates an in-flight "limbo" state — use key-based lookup (`lookupByKey`) that can tolerate `None`.

---

## 5. Keys, References & Workflow

### 5.1 Concurrent Key-Creation Races

Canton enforces key uniqueness **within a transaction**, not globally. Two concurrent creators can both see `None` and both succeed.

**Vulnerable:**

```daml
template DomainName
  with
    registry : Party
    owner : Party
    name : Text
  where
    signatory registry, owner
    key (registry, name) : (Party, Text)
    maintainer key._1

template RegistryService
  with
    registry : Party
  where
    signatory registry

    -- nonconsuming -> concurrent Register calls don't contend on this contract
    nonconsuming choice Register : ContractId DomainName
      with
        user : Party
        name : Text
      controller user
      do
        existing <- lookupByKey @DomainName (registry, name)
        case existing of
          Some _ -> abort "Name already taken"
          None -> create DomainName with      -- concurrent caller also reaches here
            registry = registry
            owner = user
            name = name
```

*Bug:* two users submit Register with the same name concurrently; both see `lookupByKey` return `None` before either commits, both succeed, duplicate-keyed contracts end up on the ledger.

**Fixed (consuming-generator pattern):**

```daml
template RegistryService
  with
    registry : Party
  where
    signatory registry

    -- consuming -> concurrent Register calls contend on the single RegistryService
    -- Canton's contention layer rejects all but one; losers get retriable errors
    choice Register : (ContractId RegistryService, ContractId DomainName)
      with
        user : Party
        name : Text
      controller registry
      do
        existing <- lookupByKey @DomainName (registry, name)
        case existing of
          Some _ -> abort "Name already taken"
          None -> do
            nameCid <- create DomainName with
              registry = registry
              owner = user
              name = name
            svcCid <- create this               -- recreate so the service keeps running
            return (svcCid, nameCid)
```

*Fix:* the consuming generator serializes all Register calls through a single contention point — Canton rejects duplicates at the ledger level; one transaction wins, the rest fail with retriable contention.

### 5.2 Unvalidated Contract ID Arguments

**Vulnerable:**

```daml
template Settlement
  with
    exchange : Party
    buyer : Party
    seller : Party
    tradeId : Text
  where
    signatory exchange
    observer buyer, seller

    choice Settle : ()
      with
        paymentCid : ContractId Payment
        deliveryCid : ContractId Delivery
      controller exchange
      do
        payment <- fetch paymentCid
        delivery <- fetch deliveryCid
        -- NO validation that these contracts belong to THIS trade.
        -- Exchange (or compromised exchange key) could pass in the payment from
        -- trade A and the delivery from trade B -- both fetch successfully and
        -- the settlement goes through with mismatched counterparties.
        archive paymentCid
        archive deliveryCid
        return ()
```

*Bug:* fetched ContractIds are blindly trusted; the exchange could settle using a payment from trade A and a delivery from trade B, mismatching counterparties.

**Fixed:**

```daml
    choice Settle : ()
      with
        paymentCid : ContractId Payment
        deliveryCid : ContractId Delivery
      controller exchange
      do
        payment <- fetch paymentCid
        delivery <- fetch deliveryCid
        -- tie each fetched contract back to THIS specific trade
        assert (payment.tradeRef == tradeId)
        assert (payment.payer == buyer)
        assert (delivery.tradeRef == tradeId)
        assert (delivery.deliverer == seller)
        archive paymentCid
        archive deliveryCid
        return ()
```

*Fix:* after fetching, assert each contract's identity fields match this specific trade.

**Related — frozen ContractId refs:** storing `ContractId` values in long-lived contracts (e.g., a Subscription holding a `ContractId PaymentMethod`) breaks when the referenced contract is archived/rotated. Reference by key instead of ContractId — keys are identity-level, ContractIds are instance-level.

---

## 6. Choice Design, Lifecycle & Contention

### 6.1 Contention on Hot Contracts

**Vulnerable:**

```daml
template GlobalOrderBook
  with
    exchange : Party
    orders : [(Party, Text, Decimal)]    -- every order lives inside one contract
  where
    signatory exchange

    choice AddOrder : ContractId GlobalOrderBook
      with
        trader : Party
        asset : Text
        price : Decimal
      controller exchange
      do
        -- consuming choice: every AddOrder archives the current book and
        -- creates a new one. Only ONE submission can win at a time; every
        -- other concurrent AddOrder fails with a contention error.
        create this with orders = (trader, asset, price) :: orders
```

*Bug:* every AddOrder archives and recreates the single shared contract — only one concurrent submission wins; the rest fail with contention errors.

**Fixed:**

```daml
-- one contract per order -- no shared mutable state, no contention
template Order
  with
    exchange : Party
    trader : Party
    asset : Text
    price : Decimal
    quantity : Int
  where
    signatory exchange, trader

    ensure price > 0.0 && quantity > 0

    choice Cancel : ()
      controller trader
      do return ()

    choice Fill : ContractId FilledOrder
      with
        fillQuantity : Int
      controller exchange
      do
        assert (fillQuantity > 0 && fillQuantity <= quantity)
        create FilledOrder with
          exchange = exchange
          trader = trader
          asset = asset
          price = price
          quantity = fillQuantity

template FilledOrder
  with
    exchange : Party
    trader : Party
    asset : Text
    price : Decimal
    quantity : Int
  where
    signatory exchange, trader
```

*Fix:* each order is an independent contract; no shared mutable state means no contention — thousands of `AddOrder` submissions can commit in parallel.

### 6.2 Non-Consuming When It Should Consume (Replay/Reuse)

A single-use artifact marked `nonconsuming` enables unlimited replay. A related footgun runs in the opposite direction: a query choice that forgets `nonconsuming` archives the contract on every read.

**Vulnerable:**

```daml
template Approval
  with
    manager : Party
    employee : Party
    requestType : Text
  where
    signatory manager
    observer employee

    -- nonconsuming: the Approval is never archived; employee can call
    -- UseApproval in a loop and produce unlimited ActionTaken records
    nonconsuming choice UseApproval : ContractId ActionTaken
      controller employee
      do
        create ActionTaken with
          approvedBy = manager
          actor = employee
          action = requestType

template ActionTaken
  with
    approvedBy : Party
    actor : Party
    action : Text
  where
    signatory approvedBy
    observer actor
```

*Bug:* the approval is never archived — the employee replays it unlimited times, producing an unlimited stream of ActionTaken records.

**Fixed:**

```daml
template Approval
  with
    manager : Party
    employee : Party
    requestType : Text
  where
    signatory manager
    observer employee

    -- consuming (default): exercising the choice archives the Approval;
    -- single-use semantics enforced by the ledger
    choice UseApproval : ContractId ActionTaken
      controller employee
      do
        create ActionTaken with
          approvedBy = manager
          actor = employee
          action = requestType
```

*Fix:* drop `nonconsuming` — exercising the choice archives the approval, enforcing single-use semantics.

**Rule:** single-use artifacts must be **consuming**; reads/queries must be explicitly **nonconsuming**. Getting the direction wrong destroys either the asset (consuming a query) or the single-use guarantee (nonconsuming a token).

---

## 7. Canton Infrastructure, API & Upgrades

### 7.1 Weak Authorization on Upgrade Choices

**Vulnerable:**

```daml
template UpgradeableContract
  with
    issuer : Party
    holder : Party
    value : Decimal
    version : Int
  where
    signatory issuer
    observer holder                  -- holder has no authorization power

    choice UpgradeToV2 : ContractId UpgradeableContract
      with
        newValue : Decimal
      controller issuer              -- issuer alone "upgrades"
      do
        -- nothing stops issuer from silently rewriting holder's value during migration
        create this with
          value = newValue
          version = 2
```

*Bug:* issuer unilaterally controls the "upgrade" and can silently change the holder's value during migration.

**Fixed (propose-accept with value preserved):**

```daml
template UpgradeableContract
  with
    issuer : Party
    holder : Party
    value : Decimal
    version : Int
  where
    signatory issuer, holder         -- both must sign the new version

    choice ProposeUpgrade : ContractId UpgradeProposal
      controller issuer
      do
        create UpgradeProposal with
          issuer = issuer
          holder = holder
          currentValue = value       -- snapshot existing value so it can't be rewritten
          proposedVersion = version + 1

template UpgradeProposal
  with
    issuer : Party
    holder : Party
    currentValue : Decimal
    proposedVersion : Int
  where
    signatory issuer
    observer holder

    choice AcceptUpgrade : ContractId UpgradeableContract
      controller holder              -- holder reviews and approves
      do
        create UpgradeableContract with
          issuer = issuer
          holder = holder
          value = currentValue       -- preserved, never silently rewritten
          version = proposedVersion

    choice RejectUpgrade : ()
      controller holder
      do return ()
```

*Fix:* propose-accept pattern — the holder must explicitly approve; the pre-existing value is preserved, not rewritten.

### 7.2 Overly Permissive JWT Claims

```
BAD:
{
  "ledgerId":      "my-ledger",
  "applicationId": "my-app",
  "actAs":         ["Alice", "Bob", "Admin"],   // one token covers all parties
  "readAs":        ["Alice", "Bob", "Admin"],
  "admin":         true                          // admin functions enabled
}

GOOD:
{
  "ledgerId":      "my-ledger",
  "applicationId": "alice-frontend",
  "actAs":         ["Alice"],                    // single party
  "readAs":        ["Alice"],
  "admin":         false,
  "exp":           1735689600                    // short-lived (15-60 min)
}
```

*Bug:* a single token grants all parties and admin privileges; compromise yields unlimited blast radius — the attacker can act as any party and invoke admin endpoints.

*Fix:* per-party, per-application tokens with minimal claims, 15–60 min expiry + refresh rotation, never `admin: true` in application tokens, issued via OAuth2/OIDC (Auth0, Keycloak, etc.).

### Operational Hardening (policy notes)

- **Domain trust** — only connect to trusted domain operators; whitelist via Canton config; monitor sequencer for reorder/delay anomalies.
- **Party allocation** — governed registration workflow (request → admin review → allocate) prevents impersonation and namespace pollution.
- **Sequencer DoS** — enable Canton traffic control (2.x+); participants purchase traffic credits priced by transaction size.
- **Ledger API** — TLS/mTLS on all endpoints; admin API on a separate port bound to localhost; never expose Ledger API to the public internet.
- **Package IDs** — content-hash based; never hardcode; test upgrade paths in sandbox before production.
- **Template upgrades** — prefer additive `Optional` fields + migration helper over breaking changes.

---

## 8. Triggers & Off-Ledger Integration

### 8.1 Triggers Reacting to Adversary-Controlled Contracts

**Vulnerable:**

```daml
autoAcceptRule : Party -> TriggerA () ()
autoAcceptRule party = do
  proposals <- query @TradeProposal
  forA_ proposals $ \(cid, proposal) ->
    when (proposal.counterparty == party) $ do
      -- no validation whatsoever -- trigger auto-accepts ANY incoming proposal,
      -- including ones crafted with extreme price/quantity by an attacker
      dedupExercise cid Accept
```

*Bug:* trigger auto-accepts every incoming proposal — attacker creates a proposal with extreme terms (e.g., price = 0.01) and the trigger instantly signs.

**Fixed:**

```daml
autoAcceptRule
  :  Decimal       -- minAcceptablePrice
  -> Int           -- maxAutoAcceptQty
  -> [Party]       -- trustedCounterparties (allowlist)
  -> Party -> TriggerA () ()
autoAcceptRule minPrice maxQty trusted party = do
  proposals <- query @TradeProposal
  forA_ proposals $ \(cid, p) ->
    when (p.counterparty == party) $ do
      let termsOk = p.price    >= minPrice
                 && p.quantity <= maxQty
                 && p.proposer `elem` trusted
      if termsOk
        then dedupExercise cid Accept
        else debug ("Manual review needed for proposal from " <> show p.proposer)
```

*Fix:* validate price, quantity, and proposer against allowlists before accepting; anything else falls to manual review.

**Related — unbounded retry / missing idempotency:** bound retry counts per contract; check on-ledger state (existing Payment contracts) before re-creating, so a trigger restart doesn't double-pay.

### 8.2 Oracle / External Data Feed Manipulation

**Vulnerable:**

```daml
template PriceOracle
  with
    operator : Party
    asset : Text
    price : Decimal
    lastUpdated : Time
  where
    signatory operator
    key (operator, asset) : (Party, Text)
    maintainer key._1

    choice UpdatePrice : ContractId PriceOracle
      with
        newPrice : Decimal
      controller operator
      do
        -- no bounds, no deviation check
        -- BUG: timestamp never refreshed -- consumers cannot detect staleness
        create this with
          price = newPrice
          lastUpdated = lastUpdated

template OracleConsumer
  with
    user : Party
    oracleOperator : Party
  where
    signatory user

    choice MakeDecision : ContractId Decision
      with
        asset : Text
      controller user
      do
        (_, oracle) <- fetchByKey @PriceOracle (oracleOperator, asset)
        -- no staleness check: if oracle hasn't updated in hours, stale price used
        create Decision with
          user = user
          asset = asset
          priceUsed = oracle.price

template Decision
  with
    user : Party
    asset : Text
    priceUsed : Decimal
  where
    signatory user
```

*Bug:* no sanity bounds on the new price; timestamp isn't refreshed — an operator or compromised key can set any value and consumers have no way to detect staleness.

**Fixed:**

```daml
template PriceOracle
  with
    operator : Party
    asset : Text
    price : Decimal
    lastUpdated : Time
    maxDeviation : Decimal            -- e.g., 0.10 = 10% max per-update jump
  where
    signatory operator
    key (operator, asset) : (Party, Text)
    maintainer key._1

    ensure price > 0.0 && maxDeviation > 0.0

    choice UpdatePrice : ContractId PriceOracle
      with
        newPrice : Decimal
      controller operator
      do
        now <- getTime
        assert (newPrice > 0.0)
        let deviation = abs (newPrice - price) / price
        assert (deviation <= maxDeviation)        -- circuit breaker on jump size
        create this with
          price = newPrice
          lastUpdated = now                       -- ALWAYS refresh timestamp

template OracleConsumer
  with
    user : Party
    oracleOperator : Party
    maxStaleness : RelTime            -- e.g., minutes 5
  where
    signatory user

    choice MakeDecision : ContractId Decision
      with
        asset : Text
      controller user
      do
        now <- getTime
        (_, oracle) <- fetchByKey @PriceOracle (oracleOperator, asset)
        -- reject if oracle data is older than maxStaleness
        assert (addRelTime oracle.lastUpdated maxStaleness >= now)
        create Decision with
          user = user
          asset = asset
          priceUsed = oracle.price
```

*Fix:* circuit breaker on max deviation per update; consumer asserts the oracle isn't stale before using the price; timestamp is always refreshed on write.

**Off-ledger race note:** when on-ledger state depends on external systems (bank APIs, payment processors), use the saga pattern with idempotency tokens — place a HOLD first, create the on-ledger record with the hold ID, then CAPTURE. Never trust that external state matches ledger state without a bound token.

---
