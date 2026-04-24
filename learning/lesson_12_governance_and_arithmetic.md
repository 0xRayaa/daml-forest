# Lesson 12: Governance, Arithmetic Safety & DoS Prevention

> **Based on:** Security Guide 2 §2, Security Guide 3 §3.2
> **Difficulty:** Advanced
> **Time:** ~25 minutes

---

## The Governance DoS Class

**Admin-parameter-driven transaction aborts** are one of DAML's unique vulnerability classes identified by OpenZeppelin.

In institutional DAML systems, parameters like fee rates, price caps, and collateral ratios are set by governance (admin parties). When these values appear as **denominators** or in **overflow-prone operations**, a single misconfiguration can:
- Abort **every transaction** that touches the parameter
- Render an entire protocol **completely inoperable**
- Require emergency governance action to fix — which takes time

Unlike Ethereum (where you'd just lose money), in DAML this causes **liveness failure** — no one can trade, borrow, or settle.

---

## Division by Zero — Governance Parameter as Denominator

```daml
-- ❌ VULNERABLE: admin can set collateralRatio = 0.0 → system-wide DoS
template LendingPool
  with
    operator           : Party
    collateralRatio    : Decimal   -- admin-set, no bounds
    liquidationThresh  : Decimal
    feeRate            : Decimal
  where
    signatory operator

    nonconsuming choice CalculateBorrow : Decimal
      with collateralValue : Decimal
      controller operator
      do
        -- ArithmeticError if collateralRatio == 0.0
        -- This aborts the ENTIRE transaction
        -- Every borrower in the system is stuck!
        return (collateralValue / collateralRatio)

    nonconsuming choice CheckLiquidation : Bool
      with debtValue : Decimal; collateralValue : Decimal
      controller operator
      do
        -- ArithmeticError if debtValue == 0.0
        let ratio = collateralValue / debtValue
        return (ratio < liquidationThresh)
```

```daml
-- ✅ FIXED: Bound all governance parameters at template creation
template LendingPool
  with
    operator          : Party
    collateralRatio   : Decimal
    liquidationThresh : Decimal
    feeRate           : Decimal
  where
    signatory operator

    -- Parameters validated at creation — bad config rejected outright
    ensure collateralRatio   > 0.0  && collateralRatio   <= 10.0
        && liquidationThresh > 0.0  && liquidationThresh < collateralRatio
        && feeRate           > 0.0  && feeRate           <= 1.0

    nonconsuming choice CalculateBorrow : Decimal
      with collateralValue : Decimal
      controller operator
      do
        assert (collateralValue >= 0.0)
        return (collateralValue / collateralRatio)  -- SAFE: ratio > 0 by ensure

    nonconsuming choice CheckLiquidation : Bool
      with debtValue : Decimal; collateralValue : Decimal
      controller operator
      do
        assert (collateralValue >= 0.0)
        if debtValue <= 0.0
          then return False          -- explicit zero guard, not division
          else return (collateralValue / debtValue < liquidationThresh)

    -- Admin updates re-validate
    choice UpdateParameters : ContractId LendingPool
      with newRatio : Decimal; newThresh : Decimal; newFee : Decimal
      controller operator
      do
        assert (newRatio  > 0.0 && newRatio  <= 10.0)
        assert (newThresh > 0.0 && newThresh < newRatio)
        assert (newFee    > 0.0 && newFee    <= 1.0)
        create this with
          collateralRatio   = newRatio
          liquidationThresh = newThresh
          feeRate           = newFee
```

---

## Int Overflow via Governance Multiplier

```daml
-- ❌ VULNERABLE: governance can set multiplier high enough to overflow
template RewardDistributor
  with
    operator        : Party
    rewardMultiplier : Int     -- governance sets: could be 1,000,000
    baseReward      : Int
  where
    signatory operator

    nonconsuming choice CalculateReward : Int
      with userStake : Int; epochCount : Int
      controller operator
      do
        -- If rewardMultiplier=1000000, userStake=10000000, epochCount=365:
        -- 1000000 * 10000000 * 365 * baseReward = OVERFLOW → ArithmeticError
        -- No one gets rewards, system is stuck
        return (rewardMultiplier * userStake * epochCount * baseReward)
```

```daml
-- ✅ FIXED: Use Decimal, bound parameters, add intermediate checks
template RewardDistributor
  with
    operator         : Party
    rewardMultiplier : Decimal     -- Decimal is safer for large math
    baseReward       : Decimal
    maxRewardPerEpoch: Decimal     -- governance cap
  where
    signatory operator

    ensure rewardMultiplier  > 0.0  && rewardMultiplier  <= 100.0
        && baseReward        > 0.0
        && maxRewardPerEpoch > 0.0

    nonconsuming choice CalculateReward : Decimal
      with userStake : Decimal; epochCount : Int
      controller operator
      do
        assert (userStake  >= 0.0)
        assert (epochCount >  0 && epochCount <= 365)

        -- Check intermediate result first
        let perEpoch = baseReward * rewardMultiplier
        assert (perEpoch <= maxRewardPerEpoch)  -- cap check

        let total = perEpoch * userStake * intToDecimal epochCount
        assert (total >= 0.0)
        return total
```

---

## Cascading Governance Faults

One bad parameter breaks **multiple independent workflows**:

```daml
-- ❌ VULNERABLE: exchangeRate flows into 3 different workflows
template ExchangeConfig
  with
    admin        : Party
    exchangeRate : Decimal    -- one parameter, three failure modes
    minTrade     : Decimal
    maxTrade     : Decimal
  where
    signatory admin

    nonconsuming choice ConvertAmount : Decimal    -- workflow 1
      with amount : Decimal
      controller admin
      do return (amount * exchangeRate)  -- if rate=0, result=0 (wrong!)

    nonconsuming choice CalculateFee : Decimal     -- workflow 2
      with tradeValue : Decimal
      controller admin
      do
        let normalized = tradeValue / exchangeRate  -- if rate=0, ArithmeticError!
        return (normalized * 0.001)

    nonconsuming choice CalculateExposure : Decimal -- workflow 3
      with positions : [Decimal]
      controller admin
      do
        let total = foldl (+) 0.0 positions
        return (total / exchangeRate)  -- if rate=0, ArithmeticError!
```

```daml
-- ✅ FIXED: Separate configs per concern, validate at oracle level
template ExchangeRateOracle
  with
    admin      : Party
    pair       : Text
    rate       : Decimal
    validFrom  : Time
    validUntil : Time
  where
    signatory admin

    ensure rate > 0.0 && rate <= 1000000.0

    nonconsuming choice GetRate : Decimal
      controller admin
      do
        now <- getTime
        assert (now >= validFrom && now <= validUntil)  -- staleness check
        return rate

-- TradingEngine uses oracle, not raw config
template TradingEngine
  with
    admin           : Party
    oracleOperator  : Party
    pair            : Text
    minTradeSize    : Decimal
    maxTradeSize    : Decimal
  where
    signatory admin
    ensure minTradeSize > 0.0 && maxTradeSize > minTradeSize

    nonconsuming choice ConvertAmount : Decimal
      with amount : Decimal
      controller admin
      do
        assert (amount >= minTradeSize && amount <= maxTradeSize)
        (_, oracle) <- fetchByKey @ExchangeRateOracle (oracleOperator, pair)
        return (amount * oracle.rate)  -- oracle.rate > 0 by oracle's ensure ✅
```

---

## Arithmetic Precision: Decimal Best Practices

```daml
-- ❌ BAD: Multiple divisions accumulate rounding errors
template FeeCalculator
  with operator : Party; totalAmount : Decimal
  where signatory operator

    nonconsuming choice CalcFee : Decimal
      controller operator
      do
        let tier1 = totalAmount / 3.0   -- loses precision
        let tier2 = tier1 / 7.0         -- loses more
        let tier3 = tier2 / 11.0        -- loses even more
        return (tier1 + tier2 + tier3)  -- accumulated error

-- ✅ GOOD: Single division at the end
    nonconsuming choice CalcFeeGood : Decimal
      controller operator
      do
        -- Equivalent math, but one division preserves precision
        -- 1/3 + 1/21 + 1/231 = 77/231 + 11/231 + 1/231 = 89/231
        return (totalAmount * 89.0 / 231.0)
```

---

## The Arithmetic Safety Checklist

For every arithmetic operation in a DAML template, ask:

```
Division: Could the denominator ever be zero?
  → Is it an admin parameter? Bound it with ensure > 0.0
  → Is it user input? Guard with assert (denominator > 0.0)
  → Is it a computed value? Guard with if denominator <= 0.0 then ... else

Multiplication (Int): Could the result exceed 9.2 × 10^18?
  → Switch to Decimal for large multiplications
  → Add intermediate bounds checks
  → Add a governance cap on the multiplier

Subtraction: Could the result go negative?
  → Assert (a >= b) before (a - b)
  → Use ensure on the template to enforce invariants

Addition: Could the result overflow Int?
  → Check (a + b > a) after addition (overflow makes result smaller)
  → Use Decimal for large sums
```

---

## Exercise 12: Identify All Governance Risks

```daml
template StakingProtocol
  with
    admin           : Party
    apr             : Decimal    -- annual % rate, admin-set
    penaltyRate     : Decimal    -- early exit penalty, admin-set
    lockPeriodDays  : Int        -- lock period, admin-set
    minStake        : Decimal    -- minimum stake, admin-set
  where
    signatory admin

    nonconsuming choice CalculateReward : Decimal
      with principal : Decimal; daysStaked : Int
      controller admin
      do
        -- (a) Find the bug
        let dailyRate = apr / 365.0
        return (principal * dailyRate * intToDecimal daysStaked)

    nonconsuming choice CalculatePenalty : Decimal
      with principal : Decimal; daysStaked : Int
      controller admin
      do
        -- (b) Find the bug
        let daysRemaining = lockPeriodDays - daysStaked
        return (principal * penaltyRate * intToDecimal daysRemaining)

    nonconsuming choice IsEligible : Bool
      with stakeAmount : Decimal
      controller admin
      do
        -- (c) Find the bug
        return (stakeAmount / minStake > 1.0)
```

**Bugs:**
- **(a)** `apr` could be 0.0 → result always 0 (silent wrong answer, not abort). `apr` could be negative → negative rewards
- **(b)** `daysStaked > lockPeriodDays` → `daysRemaining` negative → negative penalty (reward for early exit!)
- **(c)** `minStake` could be 0.0 → ArithmeticError → eligibility check always fails

**Fix:**
```daml
    ensure apr         > 0.0  && apr         <= 100.0
        && penaltyRate >= 0.0  && penaltyRate <= 1.0
        && lockPeriodDays > 0
        && minStake    > 0.0

    nonconsuming choice CalculatePenalty : Decimal
      with principal : Decimal; daysStaked : Int
      controller admin
      do
        let daysRemaining = max 0 (lockPeriodDays - daysStaked)  -- floor at 0
        return (principal * penaltyRate * intToDecimal daysRemaining)

    nonconsuming choice IsEligible : Bool
      with stakeAmount : Decimal
      controller admin
      do
        -- minStake > 0 guaranteed by ensure
        return (stakeAmount >= minStake)  -- simpler and safer
```

---

## Key Takeaways

1. **Governance parameters as denominators** → DoS when set to zero
2. **`ensure` clauses** on admin-set parameters are your primary defense
3. **Admin update choices** must re-validate — don't trust that the new value is safe
4. **Int overflow** aborts transactions — use Decimal for governance-multiplied values
5. **One parameter, multiple workflows** = multiplied blast radius
6. **Minimize divisions** — compute combined multiplier first, divide once at end
7. **Explicit zero guards** before every division that isn't protected by `ensure`

---

## 🎓 Course Complete!

You've covered all 12 lessons. Here's the full journey:

| Lessons | Theme |
|---------|-------|
| 1-4 | DAML Fundamentals (templates, choices, types, authority) |
| 5-6 | Privacy & Value Safety (divulgence, conservation) |
| 7-8 | Time & Infrastructure (deadlines, keys, contention) |
| 9-11 | Advanced Development (testing, interfaces, FP) |
| 12 | Security: Governance & Arithmetic |

**Continue with:** The Security Guides for deep vulnerability catalogues, then try auditing a real DAML codebase!
