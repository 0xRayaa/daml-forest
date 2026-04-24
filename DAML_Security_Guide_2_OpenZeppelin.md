# DAML Security Guide 2: OpenZeppelin Canton Findings

### Vulnerabilities Unique to Canton's Extended UTXO Model

> **Source:** [OpenZeppelin -- Smart Contract Security for Institutional Finance on Canton](https://www.openzeppelin.com/news/smart-contract-security-for-institutional-finance-on-canton-an-entirely-different-problem)  
> **Audience:** Developers, auditors, and security researchers working with DAML & Canton  23
> **Purpose:** Canton marketing presentation & DAML workshop reference  
> **By:** CredShields

---

## Why This Matters

OpenZeppelin -- the most recognized name in smart contract security -- conducted dedicated research on Canton and concluded that **DAML requires entirely different security tooling** from Ethereum. None of Ethereum's detectors (reentrancy, MEV, flash loans) apply. Instead, Canton introduces its own distinct vulnerability classes.

They built **3 open-source tools** and identified **4 core vulnerability classes** specific to DAML's architecture.

### What Canton Eliminates (vs Ethereum)

| Vulnerability | Ethereum | Canton |
|--------------|----------|--------|
| **Reentrancy** | Common and critical | Impossible -- no arbitrary external calls mid-transaction |
| **MEV / Front-running** | Exploitable via public mempool | Prevented -- encrypted payloads, sequencer can't read content |
| **Flash Loan Attacks** | Widespread DeFi vector | No flash loan facility exists in Canton ecosystem |
| **Oracle Manipulation** | Wide attack surface | Narrower -- privacy model limits attacker visibility |
| **State Visibility** | All state is globally visible | Encrypted per-recipient transaction views |

### What Canton Introduces

| Vulnerability Class | Risk Level | Detection |
|---------------------|-----------|-----------|
| Conservation Violations | Critical | daml-lint, daml-verify |
| Governance Arithmetic Faults | High | daml-lint, daml-verify |
| Temporal Assumption Failures | High | daml-verify |
| Non-Deterministic Ordering | Medium | daml-lint |

---

## Table of Contents

1. [Conservation Violations](#1-conservation-violations)
2. [Governance Arithmetic Faults](#2-governance-arithmetic-faults)
3. [Temporal Assumption Failures](#3-temporal-assumption-failures)
4. [Non-Deterministic Ordering at Application Boundary](#4-non-deterministic-ordering-at-application-boundary)
5. [OpenZeppelin's Security Toolchain](#5-openzeppelins-security-toolchain)
6. [Layered Verification Strategy](#6-layered-verification-strategy)
7. [Workshop Exercises](#7-workshop-exercises)

---

## 1. Conservation Violations

**The #1 DAML-specific vulnerability class.**

In Canton's extended UTXO model, contracts are **immutable** -- you archive old contracts and create new ones. When a system has **multiple transfer paths** (direct transfer, self-transfer for merging, two-step transfer via locked holdings), the invariant that **total inputs == total outputs** must hold across **every single path**. Complexity grows exponentially with each intermediary step.

This vulnerability class doesn't exist in Ethereum's account model where balances are simply incremented/decremented.

### 1.1 Basic Conservation Violation -- Single Transfer Path

**Vulnerable Code:**

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
        -- BAD: Rounding error silently destroys value
        let senderRemaining = amount - transferAmount
        let fee = transferAmount * 0.001  -- 0.1% fee
        let recipientGets = transferAmount - fee

        sender <- create this with amount = senderRemaining
        receiver <- create Token with
          issuer = issuer
          owner = recipient
          amount = recipientGets
        -- WHERE DID THE FEE GO?
        -- Input:  amount
        -- Output: senderRemaining + recipientGets
        --       = (amount - transferAmount) + (transferAmount - fee)
        --       = amount - fee
        -- Conservation VIOLATED: fee tokens vanish from existence
        return (sender, receiver)
```

**What's wrong:**
- `fee` amount is deducted but never assigned to any contract
- Total input = `amount`, total output = `amount - fee`
- Tokens are silently destroyed -- the fee just disappears

**Fixed Code:**

```daml
template Token
  with
    issuer : Party
    owner : Party
    amount : Decimal
  where
    signatory issuer, owner

    ensure amount > 0.0

    -- GOOD: All value is accounted for across output contracts
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

        assert (senderRemaining + recipientGets + fee == amount)  -- GOOD: conservation check

        sender <- create this with amount = senderRemaining
        receiver <- create Token with
          issuer = issuer
          owner = recipient
          amount = recipientGets
        feeToken <- create Token with
          issuer = issuer
          owner = feeCollector
          amount = fee
        -- Input:  amount
        -- Output: senderRemaining + recipientGets + fee = amount
        -- Conservation HOLDS
        return (sender, receiver, feeToken)
```

### 1.2 Multi-Path Conservation Violation

The real danger: a system with **multiple ways to move tokens** where one path leaks value.

**Vulnerable Code:**

```daml
-- Path 1: Direct transfer (via preapproval)
-- Path 2: Self-transfer (for merging balances)
-- Path 3: Two-step transfer (via locked holding)

template Holding
  with
    custodian : Party
    owner : Party
    amount : Decimal
    instrument : Text
  where
    signatory custodian, owner
    ensure amount > 0.0

    -- PATH 1: Direct transfer -- conservation holds here
    choice DirectTransfer : (ContractId Holding, ContractId Holding)
      with
        recipient : Party
        qty : Decimal
      controller owner
      do
        assert (qty > 0.0 && qty <= amount)
        remainder <- create this with amount = amount - qty
        transferred <- create Holding with
          custodian = custodian
          owner = recipient
          amount = qty
          instrument = instrument
        return (remainder, transferred)

    -- PATH 2: Self-merge -- conservation holds here
    choice Merge : ContractId Holding
      with
        otherCid : ContractId Holding
      controller owner
      do
        other <- fetch otherCid
        assert (other.owner == owner)
        assert (other.custodian == custodian)
        assert (other.instrument == instrument)
        archive otherCid
        create this with amount = amount + other.amount

    -- PATH 3: Lock for two-step transfer -- CONSERVATION VIOLATION!
    choice LockForTransfer : ContractId LockedHolding
      with
        recipient : Party
        lockQty : Decimal
      controller owner
      do
        assert (lockQty > 0.0 && lockQty <= amount)
        -- BAD: archives the ENTIRE holding but only locks lockQty
        -- the remainder (amount - lockQty) is LOST!
        create LockedHolding with
          custodian = custodian
          sender = owner
          recipient = recipient
          amount = lockQty
          instrument = instrument

template LockedHolding
  with
    custodian : Party
    sender : Party
    recipient : Party
    amount : Decimal
    instrument : Text
  where
    signatory custodian, sender

    choice Claim : ContractId Holding
      controller recipient
      do
        create Holding with
          custodian = custodian
          owner = recipient
          amount = amount
          instrument = instrument

    choice Unlock : ContractId Holding
      controller sender
      do
        create Holding with
          custodian = custodian
          owner = sender
          amount = amount
          instrument = instrument
```

**What's wrong:**
- `LockForTransfer` consumes the entire `Holding` (which has `amount`) but only creates a `LockedHolding` for `lockQty`
- If `amount = 100` and `lockQty = 30`, then **70 tokens vanish**
- Paths 1 and 2 are correct, but Path 3 silently destroys value
- This passes single-path unit tests but fails conservation across all paths

**Fixed Code:**

```daml
template Holding
  with
    custodian : Party
    owner : Party
    amount : Decimal
    instrument : Text
  where
    signatory custodian, owner
    ensure amount > 0.0

    choice DirectTransfer : (ContractId Holding, ContractId Holding)
      with
        recipient : Party
        qty : Decimal
      controller owner
      do
        assert (qty > 0.0 && qty <= amount)
        remainder <- create this with amount = amount - qty
        transferred <- create Holding with
          custodian = custodian
          owner = recipient
          amount = qty
          instrument = instrument
        return (remainder, transferred)

    choice Merge : ContractId Holding
      with
        otherCid : ContractId Holding
      controller owner
      do
        other <- fetch otherCid
        assert (other.owner == owner)
        assert (other.custodian == custodian)
        assert (other.instrument == instrument)
        archive otherCid
        create this with amount = amount + other.amount

    -- GOOD: Lock creates BOTH a locked portion AND a remainder
    choice LockForTransfer : (ContractId LockedHolding, ContractId Holding)
      with
        recipient : Party
        lockQty : Decimal
      controller owner
      do
        assert (lockQty > 0.0 && lockQty <= amount)
        let remainder = amount - lockQty

        locked <- create LockedHolding with
          custodian = custodian
          sender = owner
          recipient = recipient
          amount = lockQty
          instrument = instrument

        -- GOOD: Remainder is preserved in a new Holding
        remainderHolding <- create this with amount = remainder

        -- Input:  amount
        -- Output: lockQty + remainder = amount
        -- Conservation HOLDS across all 3 paths
        return (locked, remainderHolding)
```

### 1.3 Conservation Violation via Partial Settlement

**Vulnerable Code:**

```daml
-- DVP (Delivery vs Payment) settlement
template DvpSettlement
  with
    exchange : Party
    buyer : Party
    seller : Party
  where
    signatory exchange

    choice Settle : ()
      with
        cashCid : ContractId CashHolding      -- buyer pays cash
        assetCid : ContractId AssetHolding     -- seller delivers asset
      controller exchange
      do
        cash <- fetch cashCid
        asset <- fetch assetCid

        -- BAD: If cash.amount doesn't exactly equal the agreed price,
        -- the excess or deficit is silently absorbed
        archive cashCid
        archive assetCid

        -- Create new holdings with agreed amounts
        create CashHolding with
          owner = seller
          amount = 1000.0    -- hardcoded! ignores actual cash.amount
          currency = "USD"

        create AssetHolding with
          owner = buyer
          amount = 100.0     -- hardcoded! ignores actual asset.amount
          instrument = "BOND-A"

        -- If cash.amount was 1050.0, $50 just vanished
        -- If asset.amount was 150, 50 bonds just vanished
        return ()
```

**Fixed Code:**

```daml
template DvpSettlement
  with
    exchange : Party
    buyer : Party
    seller : Party
    agreedPrice : Decimal
    agreedQuantity : Decimal
  where
    signatory exchange
    observer buyer, seller

    ensure agreedPrice > 0.0 && agreedQuantity > 0.0

    choice Settle : (ContractId CashHolding, ContractId AssetHolding, Optional (ContractId CashHolding), Optional (ContractId AssetHolding))
      with
        cashCid : ContractId CashHolding
        assetCid : ContractId AssetHolding
      controller exchange
      do
        cash <- fetch cashCid
        asset <- fetch assetCid

        -- GOOD: Validate inputs match or exceed agreed terms
        assert (cash.amount >= agreedPrice)
        assert (asset.amount >= agreedQuantity)
        assert (cash.owner == buyer)
        assert (asset.owner == seller)

        archive cashCid
        archive assetCid

        -- Settle agreed amounts
        sellerCash <- create CashHolding with
          owner = seller
          amount = agreedPrice
          currency = cash.currency

        buyerAsset <- create AssetHolding with
          owner = buyer
          amount = agreedQuantity
          instrument = asset.instrument

        -- GOOD: Return excess to original owners (conservation!)
        cashChange <- if cash.amount > agreedPrice
          then do
            c <- create CashHolding with
              owner = buyer
              amount = cash.amount - agreedPrice
              currency = cash.currency
            return (Some c)
          else return None

        assetChange <- if asset.amount > agreedQuantity
          then do
            a <- create AssetHolding with
              owner = seller
              amount = asset.amount - agreedQuantity
              instrument = asset.instrument
            return (Some a)
          else return None

        -- Input:  cash.amount + asset.amount
        -- Output: agreedPrice + agreedQuantity + cashChange + assetChange
        --       = cash.amount + asset.amount
        -- Conservation HOLDS
        return (sellerCash, buyerAsset, cashChange, assetChange)
```

---

## 2. Governance Arithmetic Faults

**When governance-controlled parameters flow into arithmetic operations.**

In institutional DAML systems, parameters like fee rates, price caps, collateral ratios, and exchange rates are typically set by governance (admin parties). When these values appear as **denominators** or in **overflow-prone operations**, a single misconfiguration can abort entire transaction workflows.

DAML raises `ArithmeticError` on overflow and division-by-zero, which **aborts the entire transaction** -- this is a liveness/DoS risk, not just a correctness bug.

### 2.1 Unguarded Division by Governance Parameter

**Vulnerable Code:**

```daml
template LendingPool
  with
    operator : Party
    collateralRatio : Decimal      -- set by governance, e.g., 1.5 = 150%
    liquidationThreshold : Decimal -- set by governance, e.g., 1.2 = 120%
    feeRate : Decimal              -- set by governance, e.g., 0.003 = 0.3%
  where
    signatory operator

    nonconsuming choice CalculateBorrowLimit : Decimal
      with
        user : Party
        collateralValue : Decimal
      controller operator
      do
        -- BAD: if governance sets collateralRatio to 0.0, this aborts
        -- the ENTIRE lending pool becomes inoperable
        let maxBorrow = collateralValue / collateralRatio
        return maxBorrow

    nonconsuming choice CalculateFee : Decimal
      with
        principal : Decimal
        durationDays : Int
      controller operator
      do
        -- BAD: if feeRate is 0.0, this division aborts
        let periods = principal / feeRate
        -- BAD: if durationDays somehow gets to a huge number, overflow
        let fee = feeRate * principal * (intToDecimal durationDays / 365.0)
        return fee

    nonconsuming choice CheckLiquidation : Bool
      with
        debtValue : Decimal
        collateralValue : Decimal
      controller operator
      do
        -- BAD: if debtValue is 0.0, division by zero
        let ratio = collateralValue / debtValue
        return (ratio < liquidationThreshold)
```

**What's wrong:**
- `collateralRatio`, `feeRate`, and `debtValue` can all be zero -- each division aborts the transaction
- The bug isn't in the code logic -- it's in the **code-configuration relationship**
- A governance misconfiguration (one wrong parameter update) renders the entire pool inoperable
- This is a **liveness/DoS vulnerability**: no funds are lost, but no one can borrow, repay, or liquidate

**Fixed Code:**

```daml
template LendingPool
  with
    operator : Party
    collateralRatio : Decimal
    liquidationThreshold : Decimal
    feeRate : Decimal
  where
    signatory operator

    -- GOOD: Governance parameters are validated at the template level
    ensure collateralRatio > 0.0
      && collateralRatio <= 10.0       -- sanity cap: max 1000% collateral
      && liquidationThreshold > 0.0
      && liquidationThreshold < collateralRatio  -- threshold must be below ratio
      && feeRate > 0.0
      && feeRate <= 1.0                -- max 100% fee rate

    nonconsuming choice CalculateBorrowLimit : Decimal
      with
        user : Party
        collateralValue : Decimal
      controller operator
      do
        assert (collateralValue >= 0.0)
        -- SAFE: collateralRatio guaranteed > 0 by ensure
        let maxBorrow = collateralValue / collateralRatio
        return maxBorrow

    nonconsuming choice CalculateFee : Decimal
      with
        principal : Decimal
        durationDays : Int
      controller operator
      do
        assert (principal > 0.0)
        assert (durationDays > 0 && durationDays <= 3650)  -- max 10 years
        -- SAFE: feeRate guaranteed > 0 by ensure, durationDays bounded
        let fee = feeRate * principal * (intToDecimal durationDays / 365.0)
        return fee

    nonconsuming choice CheckLiquidation : Bool
      with
        debtValue : Decimal
        collateralValue : Decimal
      controller operator
      do
        assert (collateralValue >= 0.0)
        -- GOOD: Guard against zero debt explicitly
        if debtValue <= 0.0
          then return False  -- no debt = no liquidation
          else do
            let ratio = collateralValue / debtValue
            return (ratio < liquidationThreshold)

    -- GOOD: Governance update also validates new parameters
    choice UpdateParameters : ContractId LendingPool
      with
        newCollateralRatio : Decimal
        newLiquidationThreshold : Decimal
        newFeeRate : Decimal
      controller operator
      do
        -- Double validation: ensure clause will catch bad values,
        -- but explicit asserts give better error messages
        assert (newCollateralRatio > 0.0)
        assert (newLiquidationThreshold > 0.0)
        assert (newLiquidationThreshold < newCollateralRatio)
        assert (newFeeRate > 0.0)
        create this with
          collateralRatio = newCollateralRatio
          liquidationThreshold = newLiquidationThreshold
          feeRate = newFeeRate
```

### 2.2 Overflow via Governance-Controlled Multiplier

**Vulnerable Code:**

```daml
template RewardDistributor
  with
    operator : Party
    rewardMultiplier : Int    -- governance sets this (e.g., 2x, 5x, 10x rewards)
    baseReward : Int
  where
    signatory operator

    nonconsuming choice CalculateReward : Int
      with
        userStake : Int
        epochCount : Int
      controller operator
      do
        -- BAD: rewardMultiplier * userStake * epochCount can overflow Int (64-bit)
        -- If governance sets rewardMultiplier to 1000000 and
        -- userStake is 10000000000 and epochCount is 365...
        -- 1000000 * 10000000000 * 365 = overflow!
        let reward = rewardMultiplier * userStake * epochCount * baseReward
        return reward
```

**What's wrong:**
- `Int` in DAML is 64-bit signed (max ~9.2 * 10^18)
- Governance setting a high `rewardMultiplier` combined with large stakes causes overflow
- `ArithmeticError` aborts the transaction -- no rewards can be distributed to anyone
- Single governance parameter change = system-wide DoS

**Fixed Code:**

```daml
template RewardDistributor
  with
    operator : Party
    rewardMultiplier : Decimal   -- GOOD: use Decimal for safer arithmetic
    baseReward : Decimal
    maxRewardPerEpoch : Decimal  -- GOOD: governance cap
  where
    signatory operator

    ensure rewardMultiplier > 0.0
      && rewardMultiplier <= 100.0       -- max 100x multiplier
      && baseReward > 0.0
      && maxRewardPerEpoch > 0.0

    nonconsuming choice CalculateReward : Decimal
      with
        userStake : Decimal
        epochCount : Int
      controller operator
      do
        assert (userStake >= 0.0)
        assert (epochCount > 0 && epochCount <= 365)

        -- GOOD: Step-by-step with intermediate bounds checks
        let perEpochReward = baseReward * rewardMultiplier
        assert (perEpochReward <= maxRewardPerEpoch)  -- cap check

        let totalReward = perEpochReward * userStake * (intToDecimal epochCount)
        -- GOOD: Final sanity check
        assert (totalReward >= 0.0)
        return totalReward
```

### 2.3 Cascading Governance Fault -- One Parameter Breaks Multiple Workflows

**Vulnerable Code:**

```daml
template ExchangeConfig
  with
    admin : Party
    exchangeRate : Decimal   -- e.g., USD/EUR rate set by governance
    minTradeSize : Decimal
    maxTradeSize : Decimal
  where
    signatory admin

    -- Used by trading workflow
    nonconsuming choice ConvertAmount : Decimal
      with
        inputAmount : Decimal
      controller admin
      do
        return (inputAmount * exchangeRate)  -- BAD if exchangeRate is extreme

    -- Used by fee workflow
    nonconsuming choice CalculateTradeFee : Decimal
      with
        tradeValue : Decimal
      controller admin
      do
        -- BAD: exchangeRate used in fee calculation too
        -- if rate goes to 0, fee division fails
        let normalizedValue = tradeValue / exchangeRate
        return (normalizedValue * 0.001)

    -- Used by risk workflow
    nonconsuming choice CalculateExposure : Decimal
      with
        positions : [Decimal]
      controller admin
      do
        let totalLocal = foldl (+) 0.0 positions
        -- BAD: same exchangeRate affects risk calculations
        return (totalLocal / exchangeRate)
```

**What's wrong:**
- `exchangeRate` flows into trading, fee calculation, AND risk management
- One bad governance update (rate = 0) breaks **three independent workflows**
- The blast radius of a single parameter is the entire system

**Fixed Code:**

```daml
-- GOOD: Separate configs for separate concerns
template ExchangeRateOracle
  with
    admin : Party
    pair : Text              -- e.g., "USD/EUR"
    rate : Decimal
    validFrom : Time
    validUntil : Time
  where
    signatory admin

    ensure rate > 0.0
      && rate <= 1000000.0   -- sanity bound for any currency pair

    -- Consumers MUST check validity
    nonconsuming choice GetRate : Decimal
      controller admin
      do
        now <- getTime
        assert (now >= validFrom && now <= validUntil)  -- GOOD: staleness check
        return rate

template TradingEngine
  with
    admin : Party
    oracleOperator : Party
    pair : Text
    minTradeSize : Decimal
    maxTradeSize : Decimal
  where
    signatory admin

    ensure minTradeSize > 0.0
      && maxTradeSize > minTradeSize

    nonconsuming choice ConvertAmount : Decimal
      with
        inputAmount : Decimal
      controller admin
      do
        assert (inputAmount >= minTradeSize && inputAmount <= maxTradeSize)
        (_, oracle) <- fetchByKey @ExchangeRateOracle (oracleOperator, pair)
        -- SAFE: oracle.rate guaranteed > 0 by oracle's ensure clause
        -- SAFE: inputAmount bounded by min/max trade size
        return (inputAmount * oracle.rate)

    nonconsuming choice CalculateTradeFee : Decimal
      with
        tradeValue : Decimal
      controller admin
      do
        assert (tradeValue > 0.0)
        (_, oracle) <- fetchByKey @ExchangeRateOracle (oracleOperator, pair)
        -- SAFE: oracle.rate > 0 guaranteed
        let normalizedValue = tradeValue / oracle.rate
        return (normalizedValue * 0.001)
```

---

## 3. Temporal Assumption Failures

**When settlement deadlines meet Canton's "fuzzy" time model.**

Canton's time model is fundamentally different from Ethereum's block-based timestamps:

- **Ledger time** has bounded skew between a participant's proposed time and the sequencer's recorded time
- **Cross-synchronizer transactions** have **no global causality guarantee** -- events from different synchronizers arrive in unpredictable order
- **Contract reassignments** across synchronizers are non-atomic two-phase operations (unassign, then assign, with a pending "limbo" state)
- `getTime` is monotonic within a transaction's dependency chain but provides **no global ordering across synchronizer boundaries**

### 3.1 Settlement Deadline Rejected by Time Skew

**Vulnerable Code:**

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
        -- BAD: Exact boundary comparison
        -- Canton's time skew means the sequencer's recorded time may differ
        -- from the participant's proposed time by up to the configured tolerance
        -- (typically seconds to minutes)
        --
        -- Scenario: deadline = 17:00:00
        --   Participant proposes: 16:59:58 (2 seconds before deadline)
        --   Sequencer records:   17:00:03 (3 seconds after deadline)
        --   Result: Transaction REJECTED -- not for lateness, but for skew!
        assert (now <= settlementDeadline)
        create SettledPayment with
          sender = sender
          receiver = receiver
          amount = amount
          settledAt = now
```

**Fixed Code:**

```daml
template SettlementInstruction
  with
    sender : Party
    receiver : Party
    amount : Decimal
    settlementDeadline : Time
    skewTolerance : RelTime      -- e.g., minutes 5
  where
    signatory sender
    observer receiver

    ensure amount > 0.0

    choice Settle : ContractId SettledPayment
      controller receiver
      do
        now <- getTime
        -- GOOD: Deadline includes skew buffer
        -- Even if sequencer records time slightly after deadline,
        -- the tolerance absorbs the difference
        let effectiveDeadline = addRelTime settlementDeadline skewTolerance
        assert (now <= effectiveDeadline)
        create SettledPayment with
          sender = sender
          receiver = receiver
          amount = amount
          settledAt = now

    -- GOOD: Separate expiry choice with inverse buffer
    choice Expire : ()
      controller sender
      do
        now <- getTime
        -- Only expire well AFTER the deadline + tolerance
        -- This prevents the window where settle and expire could both succeed
        assert (now > addRelTime settlementDeadline skewTolerance)
        return ()
```

### 3.2 Cross-Synchronizer Ordering Failure

In Canton multi-synchronizer deployments, events from different synchronizers arrive in **unpredictable order**. This breaks workflows that assume a global ordering.

**Vulnerable Code:**

```daml
-- Workflow: Transfer asset on Synchronizer A, then settle cash on Synchronizer B
-- Assumption: asset transfer always completes before cash settlement

template DvpCoordinator
  with
    exchange : Party
    buyer : Party
    seller : Party
  where
    signatory exchange

    choice InitiateDvp : ContractId DvpInProgress
      with
        assetTransferCid : ContractId AssetTransfer  -- on Sync A
        cashSettlementCid : ContractId CashSettlement -- on Sync B
      controller exchange
      do
        -- BAD: Assumes assetTransfer is already complete
        -- But cross-synchronizer events have no ordering guarantee!
        asset <- fetch assetTransferCid
        assert (asset.status == "completed")  -- may not be true yet!

        -- BAD: Proceeds to settle cash assuming asset is delivered
        exercise cashSettlementCid ExecuteSettlement
        create DvpInProgress with ..
```

**What's wrong:**
- Assumes `assetTransfer` on Synchronizer A completes before `cashSettlement` on Synchronizer B is triggered
- Canton provides **no global causality across synchronizers**
- The asset transfer may still be in-flight or in "limbo" (mid-reassignment) when the cash settlement executes

**Fixed Code:**

```daml
-- GOOD: Use atomic settlement within a single synchronizer
-- or a coordination protocol with explicit state tracking

data DvpLeg = AssetPending | AssetDelivered | CashPending | CashSettled | Complete
  deriving (Eq, Show)

template DvpCoordinator
  with
    exchange : Party
    buyer : Party
    seller : Party
    assetLeg : DvpLeg
    cashLeg : DvpLeg
  where
    signatory exchange
    observer buyer, seller

    -- Each leg reports completion independently -- no ordering assumed
    choice ConfirmAssetDelivery : ContractId DvpCoordinator
      with
        assetProof : ContractId DeliveryReceipt
      controller exchange
      do
        receipt <- fetch assetProof
        assert (receipt.seller == seller)
        assert (receipt.buyer == buyer)
        let newState = this with assetLeg = AssetDelivered
        if cashLeg == CashSettled
          then do
            -- Both legs complete -- finalize
            create newState with assetLeg = Complete, cashLeg = Complete
          else
            create newState

    choice ConfirmCashSettlement : ContractId DvpCoordinator
      with
        cashProof : ContractId PaymentReceipt
      controller exchange
      do
        receipt <- fetch cashProof
        assert (receipt.buyer == buyer)
        assert (receipt.seller == seller)
        let newState = this with cashLeg = CashSettled
        if assetLeg == AssetDelivered
          then do
            create newState with assetLeg = Complete, cashLeg = Complete
          else
            create newState

    -- Timeout if one leg fails to complete
    choice TimeoutDvp : ContractId DvpFailed
      with
        deadline : Time
      controller exchange
      do
        now <- getTime
        assert (now > deadline)
        assert (assetLeg /= Complete || cashLeg /= Complete)
        -- Initiate rollback/compensation
        create DvpFailed with
          exchange = exchange
          buyer = buyer
          seller = seller
          assetDelivered = (assetLeg == AssetDelivered)
          cashSettled = (cashLeg == CashSettled)
```

### 3.3 Contract Reassignment Limbo

When a contract is reassigned between synchronizers, it goes through a **two-phase** process: unassign (removed from source synchronizer) and assign (added to target synchronizer). Between these phases, the contract is in **limbo** -- it exists on neither synchronizer.

**Vulnerable Code:**

```daml
template CrossDomainTransfer
  with
    operator : Party
    owner : Party
    holdingCid : ContractId Holding
  where
    signatory operator

    -- BAD: Tries to exercise on a contract that may be mid-reassignment
    choice ExecuteAfterReassignment : ()
      controller operator
      do
        -- If the Holding is between unassign and assign,
        -- this fetch will FAIL -- the contract is in limbo
        holding <- fetch holdingCid
        exercise holdingCid SomeChoice
        return ()
```

**Fixed Code:**

```daml
-- GOOD: Use key-based lookup which waits for assignment to complete
template CrossDomainTransfer
  with
    operator : Party
    owner : Party
    holdingKey : (Party, Party, Text)  -- (custodian, owner, instrument)
  where
    signatory operator

    choice ExecuteAfterReassignment : ()
      controller operator
      do
        -- GOOD: lookupByKey resolves against current synchronizer state
        -- If the contract hasn't arrived yet, this returns None
        -- and we can handle it gracefully
        result <- lookupByKey @Holding holdingKey
        case result of
          None -> do
            -- Contract not yet assigned to this synchronizer
            -- Create a retry/pending record instead of failing
            create PendingTransfer with
              operator = operator
              holdingKey = holdingKey
              retryCount = 0
            return ()
          Some cid -> do
            exercise cid SomeChoice
            return ()
```

---

## 4. Non-Deterministic Ordering at Application Boundary

**The silent production killer.**

Canton guarantees **causal consistency** but NOT **total ordering**. Multiple participants can return the same set of contracts in **different sequences**. Application code that picks the "first" result of an unordered query compiles, passes single-node tests, and **fails intermittently in multi-node production**.

### 4.1 Selecting "First" from Unordered Results

**Vulnerable Code (Application / Trigger):**

```daml
-- BAD: Depends on implicit ordering of query results
paymentProcessorRule : Party -> TriggerA () ()
paymentProcessorRule party = do
  invoices <- query @Invoice
  -- BAD: "head invoices" gives the "first" invoice
  -- but order is non-deterministic across participants!
  -- On Node A: oldest invoice first
  -- On Node B: newest invoice first
  -- On Node C: random order
  case invoices of
    [] -> return ()
    ((cid, _) :: _) -> do
      -- Always processes "first" invoice -- which invoice that is
      -- depends on which participant you're connected to!
      dedupExercise cid ProcessPayment
```

**What's wrong:**
- `query @Invoice` returns contracts in undefined order
- Different participants return different orderings
- "First" invoice on node A is a different contract than "first" on node B
- Single-node tests always pass because ordering is consistent on one node
- Production with multiple participants: intermittent wrong-invoice processing, duplicate payments, skipped invoices

**Fixed Code:**

```daml
-- GOOD: Explicit deterministic ordering
paymentProcessorRule : Party -> TriggerA () ()
paymentProcessorRule party = do
  invoices <- query @Invoice
  -- GOOD: Sort by a deterministic field before selecting
  let sortedInvoices = sortBy (\(_, a) (_, b) -> compare a.dueDate b.dueDate) invoices
  -- GOOD: Process oldest-due invoice first (deterministic across all nodes)
  case sortedInvoices of
    [] -> return ()
    ((cid, invoice) :: _) -> do
      dedupExercise cid ProcessPayment
```

### 4.2 Non-Deterministic FIFO Queue

**Vulnerable Code:**

```daml
-- BAD: "Queue" based on query ordering -- not actually FIFO
template OrderQueue
  with
    exchange : Party
  where
    signatory exchange

    nonconsuming choice ProcessNextOrder : Optional (ContractId FilledOrder)
      controller exchange
      do
        orders <- query @PendingOrder
        case orders of
          [] -> return None
          -- BAD: "first" pending order is non-deterministic!
          ((cid, order) :: _) -> do
            result <- exercise cid Fill
            return (Some result)
```

**Fixed Code:**

```daml
-- GOOD: Explicit sequence numbers for deterministic ordering
template PendingOrder
  with
    exchange : Party
    trader : Party
    asset : Text
    price : Decimal
    sequenceNumber : Int  -- GOOD: monotonic counter assigned at submission
    submittedAt : Time
  where
    signatory exchange, trader
    key (exchange, sequenceNumber) : (Party, Int)
    maintainer key._1

    ensure sequenceNumber >= 0

template OrderQueue
  with
    exchange : Party
    nextSequenceToProcess : Int  -- tracks where we are in the queue
  where
    signatory exchange

    -- GOOD: Process by explicit sequence number, not query order
    choice ProcessNextOrder : (ContractId OrderQueue, Optional (ContractId FilledOrder))
      controller exchange
      do
        result <- lookupByKey @PendingOrder (exchange, nextSequenceToProcess)
        case result of
          None ->
            -- No order at this sequence number -- skip
            return (self, None)
          Some cid -> do
            filled <- exercise cid Fill
            newQueue <- create this with
              nextSequenceToProcess = nextSequenceToProcess + 1
            return (newQueue, Some filled)
```

### 4.3 Aggregation Over Non-Deterministic Results

**Vulnerable Code:**

```daml
-- BAD: Running total depends on processing order
calculatePortfolioValue : Party -> TriggerA () ()
calculatePortfolioValue party = do
  holdings <- query @Holding
  -- BAD: foldl over non-deterministic order
  -- Decimal rounding depends on operation order!
  -- (a + b) + c /= a + (b + c) in fixed-precision arithmetic
  let total = foldl (\acc (_, h) -> acc + h.value / h.exchangeRate) 0.0 holdings
  -- Different nodes may compute slightly different totals
  -- due to different ordering and rounding accumulation
  debug ("Portfolio value: " <> show total)
```

**Fixed Code:**

```daml
-- GOOD: Sort before aggregating for deterministic rounding
calculatePortfolioValue : Party -> TriggerA () ()
calculatePortfolioValue party = do
  holdings <- query @Holding
  -- GOOD: Sort by a stable, unique key before aggregating
  let sorted = sortBy (\(_, a) (_, b) -> compare a.holdingId b.holdingId) holdings
  let total = foldl (\acc (_, h) -> acc + h.value / h.exchangeRate) 0.0 sorted
  debug ("Portfolio value: " <> show total)
```

---

## 5. OpenZeppelin's Security Toolchain

OpenZeppelin built three purpose-built tools for DAML. Each covers blind spots of the others.

### 5.1 daml-lint (Static Analysis)

| Property | Detail |
|----------|--------|
| **Language** | Rust |
| **Approach** | AST-walking detectors, pattern matching against known vulnerability classes |
| **Parser** | haskell-tree-sitter with DAML keyword shim |
| **IR Design** | Dual representation (raw text + parsed statements) for structural and syntactic reasoning |

**Six Detectors:**

| # | Detector | What It Catches |
|---|----------|----------------|
| 1 | Missing `ensure` on Decimal fields | Templates without preconditions on numeric fields |
| 2 | Unguarded division | Division where denominator could be zero (governance params) |
| 3 | Non-deterministic Ledger API ordering | Queries used without explicit sorting |
| 4 | Unbounded fields in persistent contracts | Lists/maps without size limits in templates |
| 5 | Missing positive-amount assertions | Choice parameters accepting zero or negative amounts |
| 6 | Conservation pattern mismatch | Input/output amount mismatches across choice paths |

**Limitation:** Catches syntactic patterns only. Cannot reason about semantic relationships across time.

### 5.2 daml-props (Property-Based Testing)

| Property | Detail |
|----------|--------|
| **Language** | Pure DAML |
| **Approach** | Generates random action sequences, executes them, checks invariants, shrinks failures to minimal reproductions |
| **PRNG** | Park-Miller linear congruential generator (only option in DAML) |

**How it works:**

```
1. Define ACTION type:    Mint | Transfer | Burn | Lock | Unlock
2. Define INVARIANT:      totalSupply == sum(all holdings)
3. Generate random sequences: [Mint 100, Transfer 30, Lock 50, Transfer 20, Unlock 50, ...]
4. Execute and check invariant after each step
5. On failure: SHRINK to minimal reproduction
   [Mint 100, Transfer 30, Lock 50, Transfer 20, Unlock 50]
   -> [Mint 100, Lock 50, Unlock 50]  -- minimal failing sequence
```

**Advantage:** Minimal reproduction shrinking makes failures actionable. Discovers space between developer intent and what code actually permits.

**Limitation:** "Hundreds of random inputs" is not "all inputs". Cannot provide universal proofs.

### 5.3 daml-verify (Formal Verification)

| Property | Detail |
|----------|--------|
| **Prover** | Z3 (SMT solver) |
| **Language** | Symbolic models in Python using Z3 variables |
| **Approach** | Precondition-goal pairs. Checks satisfiability of (preconditions AND NOT goal) |

**14 properties verified across 4 categories:**

| Category | Properties Verified |
|----------|-------------------|
| **Conservation** | Receiver amount + sender change == total input, across all transfer paths |
| **Division Safety** | Every division has non-zero denominator (identified as **most valuable** verification) |
| **Temporal** | Settlement deadlines well-ordered across synchronizers |
| **Vault/Collateral** | Collateral ratio guards hold, liquidation conserves value, debt accrual is monotonic |

**Limitation:** Operates on a manually constructed **model**, not the code itself. Only as faithful as the model. Model must be validated line-by-line against DAML source.

---

## 6. Layered Verification Strategy

No single tool catches everything. OpenZeppelin's key insight: **layer the three tools** so each covers the others' blind spots.

```
+-----------------------------------------------------------------+
|                    VULNERABILITY SPACE                           |
|                                                                 |
|  +------------------+                                           |
|  |   daml-lint      |  Fast, broad, shallow                     |
|  |   (static)       |  Catches: known syntactic patterns        |
|  |                  |  Misses:  semantic bugs, cross-contract    |
|  +------------------+                                           |
|                                                                 |
|  +---------------------------+                                  |
|  |   daml-props              |  Medium speed, medium depth      |
|  |   (property-based test)   |  Catches: semantic bugs via       |
|  |                           |           random exploration      |
|  |                           |  Misses:  edge cases not hit      |
|  |                           |           by random generation    |
|  +---------------------------+                                  |
|                                                                 |
|  +---------------------------------------+                      |
|  |   daml-verify                         |  Slow, narrow, deep  |
|  |   (formal verification)              |  Catches: ALL inputs  |
|  |                                       |           for modeled |
|  |                                       |           properties  |
|  |                                       |  Misses:  properties  |
|  |                                       |           not modeled |
|  +---------------------------------------+                      |
+-----------------------------------------------------------------+

Real-world finding chain:
  daml-lint  -> found unguarded divisions
  daml-props -> found zero-input mint (conservation violation)
  daml-verify -> PROVED conservation holds for ALL inputs
                 (something testing could only approximate)
```

### When to Use Each Tool

| Stage | Tool | Purpose |
|-------|------|---------|
| **During development** | daml-lint | Fast feedback on known patterns. Run on every commit |
| **Before code review** | daml-props | Discover semantic bugs. Run hundreds of random sequences |
| **Before audit / deployment** | daml-verify | Prove critical properties. Model conservation, division safety, temporal ordering |
| **During audit** | All three | Layered coverage for comprehensive security assessment |

---

## 7. Workshop Exercises

### Exercise 1: Spot the Conservation Violation

```daml
template CashBalance
  with
    bank : Party
    owner : Party
    amount : Decimal
    currency : Text
  where
    signatory bank, owner
    ensure amount >= 0.0

    choice Split : (ContractId CashBalance, ContractId CashBalance)
      with
        splitAmount : Decimal
      controller owner
      do
        assert (splitAmount > 0.0)
        assert (splitAmount < amount)
        part1 <- create this with amount = splitAmount
        part2 <- create this with amount = amount - splitAmount - 0.01
        return (part1, part2)
```

<details>
<summary>Answer</summary>

**Conservation Violation:** The `Split` choice silently deducts `0.01` from the total.

- Input: `amount`
- Output: `splitAmount + (amount - splitAmount - 0.01)` = `amount - 0.01`
- 0.01 tokens vanish on every split

This could be a "fee" but there's no fee contract created -- the value is simply destroyed.

**Fix:** Either remove the `- 0.01`, or create a separate fee contract that receives the 0.01.

</details>

### Exercise 2: Spot the Governance Arithmetic Fault

```daml
template YieldCalculator
  with
    treasury : Party
    annualRate : Decimal       -- governance parameter
    compoundingPeriods : Int   -- governance parameter
  where
    signatory treasury

    nonconsuming choice CalculateYield : Decimal
      with
        principal : Decimal
        years : Int
      controller treasury
      do
        let periodsPerYear = intToDecimal compoundingPeriods
        let ratePerPeriod = annualRate / periodsPerYear
        let totalPeriods = compoundingPeriods * years
        let yieldAmount = principal * ratePerPeriod * intToDecimal totalPeriods
        return yieldAmount
```

<details>
<summary>Answer</summary>

**Governance Arithmetic Faults:**

1. **Division by zero:** If `compoundingPeriods = 0`, `annualRate / periodsPerYear` aborts with `ArithmeticError`
2. **Overflow:** `compoundingPeriods * years` can overflow `Int` if governance sets `compoundingPeriods` to a large value (e.g., 1000000 periods per year * 30 years)
3. **No ensure clause:** Both governance parameters are completely unvalidated
4. **Cascading failure:** The `CalculateYield` choice becomes inoperable for ALL users, not just one

**Fix:**
- Add `ensure compoundingPeriods > 0 && compoundingPeriods <= 365 && annualRate >= 0.0 && annualRate <= 1.0`
- Bound `years` in the choice assertion
- Use `Decimal` instead of `Int` for intermediate calculations

</details>

### Exercise 3: Spot the Non-Deterministic Ordering Bug

```daml
matchOrdersRule : Party -> TriggerA () ()
matchOrdersRule party = do
  buyOrders <- query @BuyOrder
  sellOrders <- query @SellOrder
  case (buyOrders, sellOrders) of
    ((buyCid, buy) :: _, (sellCid, sell) :: _) ->
      when (buy.price >= sell.price) $
        dedupExercise buyCid (MatchWith sellCid)
    _ -> return ()
```

<details>
<summary>Answer</summary>

**Non-Deterministic Ordering:**

1. Both `query @BuyOrder` and `query @SellOrder` return in undefined order
2. The "first" buy order and "first" sell order are different on different nodes
3. On Node A: might match Buy@$100 with Sell@$95 (good match)
4. On Node B: might match Buy@$98 with Sell@$99 (no match -- price check fails)
5. Same state, different behavior depending on which participant runs the trigger

**Fix:** Sort buy orders by price descending (highest bidder first) and sell orders by price ascending (lowest ask first) before matching. This ensures the best-priced orders always match first, regardless of which node runs the trigger.

</details>

### Exercise 4: Fix This Multi-Path Token System

```daml
template MultiPathToken
  with
    issuer : Party
    owner : Party
    amount : Decimal
  where
    signatory issuer, owner
    ensure amount > 0.0

    choice Send : ContractId MultiPathToken
      with
        recipient : Party
        qty : Decimal
      controller owner
      do
        assert (qty > 0.0 && qty <= amount)
        create MultiPathToken with
          issuer = issuer
          owner = recipient
          amount = qty

    choice Burn : ()
      with
        qty : Decimal
      controller owner
      do
        assert (qty > 0.0 && qty <= amount)
        if qty < amount
          then do
            create this with amount = amount - qty
            return ()
          else return ()
```

<details>
<summary>Answer</summary>

**Conservation violations in BOTH paths:**

**Path 1 (Send):** The sender's remaining balance (`amount - qty`) is never created as a new contract. If `amount = 100` and `qty = 30`, 70 tokens vanish.

**Path 2 (Burn):** This is fine when `qty == amount` (full burn), but when `qty < amount`, the remainder is kept. However, the conservation violation is that there's no "burn receipt" or "total supply" tracking -- you can't verify that the burn actually reduced total supply vs. just destroyed the contract.

**Fixes:**
1. `Send`: Create a remainder contract: `create this with amount = amount - qty`
2. `Burn`: Consider a burn receipt for audit trail, or at minimum ensure `Send` and `Burn` together preserve the invariant that `total minted - total burned = sum(all holdings)`

</details>

---

## Quick Reference: Canton vs Ethereum Vulnerability Map

| Ethereum Vulnerability | Canton Equivalent | Status |
|----------------------|-------------------|--------|
| Reentrancy | N/A | **Eliminated** -- no external calls mid-transaction |
| MEV / Front-running | N/A | **Eliminated** -- encrypted mempool |
| Flash Loan Attacks | N/A | **Eliminated** -- no flash loan facility |
| Integer Overflow | ArithmeticError abort (DoS) | **Different** -- aborts txn instead of wrapping |
| Oracle Manipulation | Oracle manipulation (narrower surface) | **Reduced** -- privacy limits visibility |
| Access Control | Authorization model bugs | **Different** -- signatory/controller model |
| tx.origin phishing | N/A | **Eliminated** -- no tx.origin equivalent |
| Unchecked return value | N/A | **Eliminated** -- DAML is typed functional language |
| N/A | **Conservation Violations** | **New** -- UTXO-specific |
| N/A | **Governance Arithmetic Faults** | **New** -- institutional governance model |
| N/A | **Temporal Assumption Failures** | **New** -- multi-synchronizer fuzzy time |
| N/A | **Non-Deterministic Ordering** | **New** -- causal (not total) ordering |

---

## Sources

- [OpenZeppelin: Smart Contract Security for Institutional Finance on Canton](https://www.openzeppelin.com/news/smart-contract-security-for-institutional-finance-on-canton-an-entirely-different-problem)
- [Canton Security Architecture -- Daml SDK Documentation](https://docs.daml.com/canton/architecture/security.html)
- [Canton Protocol Whitepaper](https://www.canton.network/protocol)

---

*Document Version: 1.0 | Last Updated: April 2026 | CredShields*
