# Lesson 7: Time, Deadlines & Canton's Time Model

> **Based on:** Security Guide 1 §5, Security Guide 2 §3, Security Guide 3 §4
> **Difficulty:** Intermediate → Advanced
> **Time:** ~30 minutes

---

## How Time Works in DAML

DAML provides `getTime` to access **ledger time** inside choices. On Canton:

- Ledger time has a **bounded skew** — the time a participant proposes vs. what the sequencer records can differ by seconds to minutes
- There is **no global clock** — different participants may see slightly different times
- Time is **monotonic within** a transaction chain but NOT globally

```daml
choice CheckTime : Time
  controller someParty
  do
    now <- getTime   -- ledger time at transaction execution
    return now
```

---

## The Skew Problem

**Scenario:** A settlement must happen before 17:00:00.

```
Participant proposes: 16:59:58  (2 seconds before deadline — valid!)
Sequencer records:   17:00:03  (3 seconds after deadline — rejected!)
```

The participant submitted on time, but the sequencer's recorded time fails the check. **The transaction is rejected even though the participant acted in good faith.**

---

## Bug: Exact Time Comparisons

```daml
-- ❌ BAD: Exact boundary comparison fails under skew
template SettlementInstruction
  with
    sender             : Party
    receiver           : Party
    amount             : Decimal
    settlementDeadline : Time
  where
    signatory sender
    observer receiver

    choice Settle : ContractId SettledPayment
      controller receiver
      do
        now <- getTime
        assert (now <= settlementDeadline)  -- BUG: fails due to skew!
        create SettledPayment with
          sender    = sender
          receiver  = receiver
          amount    = amount
          settledAt = now
```

---

## Fix: Grace Periods

```daml
-- ✅ GOOD: Add a grace period to absorb time skew
template SettlementInstruction
  with
    sender             : Party
    receiver           : Party
    amount             : Decimal
    settlementDeadline : Time
    skewTolerance      : RelTime   -- e.g., minutes 5
  where
    signatory sender
    observer receiver
    ensure amount > 0.0

    choice Settle : ContractId SettledPayment
      controller receiver
      do
        now <- getTime
        -- Settle window: (-inf, deadline + tolerance]
        assert (now <= addRelTime settlementDeadline skewTolerance)
        create SettledPayment with
          sender = sender; receiver = receiver
          amount = amount; settledAt = now

    -- Expire window starts AFTER the grace period — windows never overlap!
    choice Expire : ()
      controller sender
      do
        now <- getTime
        assert (now > addRelTime settlementDeadline skewTolerance)
        return ()
```

### `RelTime` helpers:
```daml
-- Create RelTime values
let fiveMinutes = minutes 5
let oneDay      = days 1
let oneHour     = hours 1

-- Arithmetic
let extendedDeadline = addRelTime deadline (hours 2)
let elapsed = subTime laterTime earlierTime  -- returns RelTime
```

---

## Bug: Missing Time Check (Deadline Bypass)

```daml
-- ❌ BAD: No time check — client can renew at old rates forever
template ServiceAgreement
  with
    provider   : Party
    client     : Party
    fee        : Decimal
    expiryDate : Time
  where
    signatory provider, client

    choice RenewAtOldRate : ContractId ServiceAgreement
      with newExpiry : Time
      controller client
      do
        -- Missing: assert (now < expiryDate)
        -- Client can renew the expired contract at the original cheap rate
        -- Provider can never raise fees!
        create this with expiryDate = newExpiry
```

```daml
-- ✅ GOOD: Enforce time constraints on renewal
template ServiceAgreement
  with
    provider     : Party
    client       : Party
    fee          : Decimal
    expiryDate   : Time
    gracePeriod  : RelTime
  where
    signatory provider, client
    ensure fee > 0.0

    choice RenewAtOldRate : ContractId ServiceAgreement
      with newExpiry : Time
      controller client
      do
        now <- getTime
        assert (now <= addRelTime expiryDate gracePeriod)   -- must renew before expiry+grace
        assert (newExpiry > expiryDate)                     -- new expiry must be later
        create this with expiryDate = newExpiry

    -- Only provider can expire it after grace period
    choice Expire : ContractId ExpiredAgreement
      controller provider
      do
        now <- getTime
        assert (now > addRelTime expiryDate gracePeriod)
        create ExpiredAgreement with
          provider = provider; client = client; previousFee = fee
```

---

## TOCTOU — Time-of-Check vs Time-of-Use

In DAML, the **check** and **use** of a price/rate happen atomically within a single transaction. But if they span transactions, the price can change between them.

```daml
-- BAD pattern: client reads price in Transaction 1, submits order in Transaction 2
-- Between T1 and T2, price may have changed

-- ✅ GOOD: Check and use in the SAME transaction with slippage tolerance
choice SubmitOrder : ContractId Order
  with
    asset         : Text
    quantity      : Int
    expectedPrice : Decimal
    maxSlippage   : Decimal    -- e.g., 0.02 for 2%
  controller trader
  do
    (_, oracle) <- fetchByKey @PriceOracle (exchange, asset)
    let priceDiff = abs (oracle.price - expectedPrice) / expectedPrice
    assert (priceDiff <= maxSlippage)    -- reject if price moved too much
    create Order with
      exchange       = exchange
      trader         = trader
      asset          = asset
      quantity       = quantity
      executionPrice = oracle.price      -- use actual current price
```

---

## Participant-Dependent Query Ordering

**The silent production killer.** Canton guarantees causal consistency, NOT total ordering. Query results arrive in different orders on different participants.

```daml
-- ❌ BAD: "head" is non-deterministic across participants
paymentProcessorRule : Party -> TriggerA () ()
paymentProcessorRule party = do
  invoices <- query @Invoice
  case invoices of
    []           -> return ()
    ((cid, _) :: _) -> do
      -- Node A: returns oldest-due invoice first
      -- Node B: returns newest invoice first
      -- Node C: returns random order
      -- Different participants process different invoices!
      dedupExercise cid ProcessPayment
```

```daml
-- ✅ GOOD: Sort by a deterministic field before selecting
paymentProcessorRule : Party -> TriggerA () ()
paymentProcessorRule party = do
  invoices <- query @Invoice
  let sorted = sortBy (\(_, a) (_, b) -> compare a.dueDate b.dueDate) invoices
  case sorted of
    []              -> return ()
    ((cid, _) :: _) ->
      -- Every participant now picks the SAME invoice (oldest due first)
      dedupExercise cid ProcessPayment
```

---

## Cross-Synchronizer Time Issues

When workflows span **multiple synchronizers** on Canton:
- Events arrive in **unpredictable order** across synchronizer boundaries
- There is **no global causality guarantee**
- Contract reassignments create a **limbo state** (unassigned from source, not yet assigned to target)

**Pattern for cross-sync workflows:** Use state-machine contracts where each leg reports completion independently:

```daml
data LegStatus = Pending | Complete | Failed Text

template CrossSyncWorkflow
  with
    coordinator : Party
    partyA      : Party
    partyB      : Party
    legAStatus  : LegStatus
    legBStatus  : LegStatus
  where
    signatory coordinator
    observer partyA, partyB

    nonconsuming choice ReportLegA : ContractId CrossSyncWorkflow
      controller partyA
      do
        archive self
        create this with legAStatus = Complete

    nonconsuming choice ReportLegB : ContractId CrossSyncWorkflow
      controller partyB
      do
        archive self
        create this with legBStatus = Complete

    -- Only settle when BOTH legs confirm independently
    choice Settle : ()
      controller coordinator
      do
        case (legAStatus, legBStatus) of
          (Complete, Complete) -> return ()
          _ -> abort "Not all legs complete"
```

---

## Exercise 7: Fix the Time Bugs

```daml
template TimedAuction
  with
    seller        : Party
    highestBidder : Party
    highestBid    : Decimal
    deadline      : Time
  where
    signatory seller
    observer highestBidder

    choice Bid : ContractId TimedAuction
      with bidder : Party; bidAmount : Decimal
      controller bidder
      do
        now <- getTime
        assert (now < deadline)        -- (a) exact comparison bug?
        assert (bidAmount > highestBid)
        create this with
          highestBidder = bidder
          highestBid    = bidAmount

    choice Close : ContractId AuctionResult
      controller seller
      do
        now <- getTime
        assert (now >= deadline)       -- (b) exact comparison bug?
        create AuctionResult with
          seller     = seller
          winner     = highestBidder
          finalPrice = highestBid
```

**Issues:**
- **(a)** Bidder may submit just before deadline, sequencer records just after → valid bid rejected
- **(b)** Seller may try to close slightly early, sequencer records exactly at deadline → valid close rejected

**Fix:**
```daml
template TimedAuction
  with
    seller        : Party
    highestBidder : Party
    highestBid    : Decimal
    deadline      : Time
    gracePeriod   : RelTime   -- e.g., minutes 2
  where
    signatory seller
    observer highestBidder
    ensure highestBid >= 0.0

    choice Bid : ContractId TimedAuction
      with bidder : Party; bidAmount : Decimal
      controller bidder
      do
        now <- getTime
        -- Bid is valid if submitted within grace period before deadline
        assert (addRelTime now gracePeriod < deadline)
        assert (bidAmount > highestBid)
        assert (bidAmount > 0.0)
        create this with highestBidder = bidder; highestBid = bidAmount

    choice Close : ContractId AuctionResult
      controller seller
      do
        now <- getTime
        -- Only closeable after deadline + grace period
        assert (now >= addRelTime deadline gracePeriod)
        create AuctionResult with
          seller = seller; winner = highestBidder; finalPrice = highestBid
```

---

## Key Takeaways

1. Canton has **time skew** — participant-proposed time ≠ sequencer-recorded time
2. **Exact boundary comparisons** (`now < deadline`) fail due to skew
3. Always add **grace periods** using `addRelTime`
4. **Settle and Expire windows** should be mutually exclusive — use `deadline + tolerance` as the boundary
5. Missing time checks = **deadline bypass** — always validate time in temporal choices
6. **Query ordering is non-deterministic** across participants — always sort before selecting
7. **Cross-sync workflows** need state machines, not assumptions about ordering

---

## Next Lesson
→ **Lesson 8: Contract Keys, References & Contention**
