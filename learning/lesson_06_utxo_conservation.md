# Lesson 6: The UTXO Model & Value Conservation

> **Based on:** Security Guide 2 §1 (OpenZeppelin Canton Findings)
> **Difficulty:** Intermediate
> **Time:** ~30 minutes

---

## Canton's UTXO Model

Unlike Ethereum's **account model** (balances stored in accounts, easily incremented/decremented), Canton uses an **extended UTXO model**.

| Ethereum Account Model | Canton UTXO Model |
|----------------------|-------------------|
| `balance[alice] -= 100` | Archive old contract, create new one |
| State mutation in place | Immutable contracts |
| Overflow: auto-handled | Overflow: ArithmeticError (aborts!) |
| Reentrancy possible | No reentrancy |
| Value loss: hard to do | Value loss: **very easy to do by accident** |

**The core rule:** When a contract is archived, you must explicitly account for all its value in new output contracts. **Any unallocated value is permanently destroyed.**

---

## Value Leakage — The #1 DAML-Specific Bug

```daml
-- ❌ BAD: Fee is deducted but never assigned to any contract
template Token
  with
    issuer : Party
    owner  : Party
    amount : Decimal
  where
    signatory issuer, owner
    ensure amount > 0.0

    choice Transfer : (ContractId Token, ContractId Token)
      with
        recipient      : Party
        transferAmount : Decimal
      controller owner
      do
        assert (transferAmount > 0.0)
        assert (transferAmount <= amount)
        let fee           = transferAmount * 0.001   -- 0.1% fee
        let recipientGets = transferAmount - fee
        let senderRemains = amount - transferAmount

        sender   <- create this with amount = senderRemains
        receiver <- create Token with
          issuer = issuer; owner = recipient; amount = recipientGets

        -- Input:  amount
        -- Output: senderRemains + recipientGets
        --       = (amount - transferAmount) + (transferAmount - fee)
        --       = amount - fee
        -- THE FEE VANISHES! Conservation violated ❌
        return (sender, receiver)
```

The `fee` is calculated and subtracted but never assigned to any contract. Those tokens cease to exist.

---

## Fixing Conservation — Every Satoshi Must Go Somewhere

```daml
-- ✅ GOOD: All value explicitly allocated across outputs
template Token
  with
    issuer : Party
    owner  : Party
    amount : Decimal
  where
    signatory issuer, owner
    ensure amount > 0.0

    choice Transfer : (ContractId Token, ContractId Token, ContractId Token)
      with
        recipient     : Party
        transferAmount : Decimal
        feeCollector  : Party
      controller owner
      do
        assert (transferAmount > 0.0)
        assert (transferAmount <= amount)
        let fee           = transferAmount * 0.001
        let recipientGets = transferAmount - fee
        let senderRemains = amount - transferAmount

        -- ✅ Runtime conservation check
        assert (senderRemains + recipientGets + fee == amount)

        sender   <- create this with amount = senderRemains
        receiver <- create Token with
          issuer = issuer; owner = recipient; amount = recipientGets
        feeToken <- create Token with
          issuer = issuer; owner = feeCollector; amount = fee

        -- Input:  amount
        -- Output: senderRemains + recipientGets + fee = amount ✅
        return (sender, receiver, feeToken)
```

---

## Multi-Path Conservation Violations

The real danger: a system with **multiple ways to move tokens** where ONE path violates conservation while the others are correct.

This passes all single-path unit tests but fails in production!

```daml
template Holding
  with
    custodian  : Party
    owner      : Party
    amount     : Decimal
    instrument : Text
  where
    signatory custodian, owner
    ensure amount > 0.0

    -- PATH 1: Direct transfer ✅ conservation holds
    choice DirectTransfer : (ContractId Holding, ContractId Holding)
      with recipient : Party; qty : Decimal
      controller owner
      do
        assert (qty > 0.0 && qty <= amount)
        remainder   <- create this with amount = amount - qty
        transferred <- create Holding with
          custodian = custodian; owner = recipient
          amount = qty; instrument = instrument
        return (remainder, transferred)

    -- PATH 2: Merge ✅ conservation holds
    choice Merge : ContractId Holding
      with otherCid : ContractId Holding
      controller owner
      do
        other <- fetch otherCid
        assert (other.owner == owner && other.custodian == custodian)
        archive otherCid
        create this with amount = amount + other.amount

    -- PATH 3: Lock for two-step transfer ❌ CONSERVATION VIOLATION
    choice LockForTransfer : ContractId LockedHolding
      with recipient : Party; lockQty : Decimal
      controller owner
      do
        assert (lockQty > 0.0 && lockQty <= amount)
        -- BUG: Archives the ENTIRE holding (amount) but only locks lockQty
        -- If amount=100 and lockQty=30, then 70 tokens vanish!
        create LockedHolding with
          custodian = custodian; sender = owner
          recipient = recipient; amount = lockQty
          instrument = instrument
          -- amount - lockQty (the remainder) is LOST ❌
```

**Fix for Path 3:**
```daml
    -- ✅ GOOD: Creates BOTH locked portion AND remainder
    choice LockForTransfer : (ContractId LockedHolding, ContractId Holding)
      with recipient : Party; lockQty : Decimal
      controller owner
      do
        assert (lockQty > 0.0 && lockQty <= amount)
        let remainder = amount - lockQty

        locked <- create LockedHolding with
          custodian = custodian; sender = owner
          recipient = recipient; amount = lockQty
          instrument = instrument

        remainderHolding <- create this with amount = remainder

        -- Input:  amount
        -- Output: lockQty + remainder = amount ✅
        return (locked, remainderHolding)
```

---

## Double Spend — The nonconsuming Trap

```daml
-- ❌ BAD: nonconsuming Redeem = infinite money printer
template PaymentVoucher
  with
    issuer      : Party
    beneficiary : Party
    amount      : Decimal
  where
    signatory issuer
    observer beneficiary

    nonconsuming choice Redeem : ContractId Payment  -- BUG!
      controller beneficiary
      do
        create Payment with
          from = issuer; to = beneficiary; amount = amount
          -- Voucher is never archived → can be redeemed unlimited times!
```

```daml
-- ✅ GOOD: consuming (default) — archived after single use
template PaymentVoucher
  with
    issuer      : Party
    beneficiary : Party
    amount      : Decimal
  where
    signatory issuer
    observer beneficiary
    ensure amount > 0.0

    choice Redeem : ContractId Payment   -- consuming by default
      controller beneficiary
      do
        create Payment with
          from = issuer; to = beneficiary; amount = amount
```

---

## Partial Settlement — Hardcoded Amounts

```daml
-- ❌ BAD: DVP with hardcoded amounts ignores actual input values
template DvpSettlement
  with
    exchange : Party
    buyer    : Party
    seller   : Party
  where
    signatory exchange

    choice Settle : ()
      with
        cashCid  : ContractId CashHolding
        assetCid : ContractId AssetHolding
      controller exchange
      do
        cash  <- fetch cashCid
        asset <- fetch assetCid

        archive cashCid
        archive assetCid

        -- BUG: Hardcoded amounts ignore cash.amount and asset.amount
        create CashHolding with owner = seller; amount = 1000.0
        create AssetHolding with owner = buyer;  amount = 100.0
        -- If cash.amount was 1050.0 → $50 vanishes
        -- If asset.amount was 150 → 50 bonds vanish
        return ()
```

```daml
-- ✅ GOOD: Validate inputs, return excess as change
template DvpSettlement
  with
    exchange       : Party
    buyer          : Party
    seller         : Party
    agreedPrice    : Decimal
    agreedQuantity : Decimal
  where
    signatory exchange
    observer buyer, seller
    ensure agreedPrice > 0.0 && agreedQuantity > 0.0

    choice Settle : (ContractId CashHolding, ContractId AssetHolding,
                     Optional (ContractId CashHolding),
                     Optional (ContractId AssetHolding))
      with
        cashCid  : ContractId CashHolding
        assetCid : ContractId AssetHolding
      controller exchange
      do
        cash  <- fetch cashCid
        asset <- fetch assetCid

        assert (cash.amount >= agreedPrice)
        assert (asset.amount >= agreedQuantity)
        assert (cash.owner == buyer)
        assert (asset.owner == seller)

        archive cashCid
        archive assetCid

        sellerCash <- create CashHolding with
          owner = seller; amount = agreedPrice
        buyerAsset <- create AssetHolding with
          owner = buyer; amount = agreedQuantity

        -- Return excess change to original owners
        cashChange <- if cash.amount > agreedPrice
          then do
            c <- create CashHolding with
              owner = buyer; amount = cash.amount - agreedPrice
            return (Some c)
          else return None

        assetChange <- if asset.amount > agreedQuantity
          then do
            a <- create AssetHolding with
              owner = seller; amount = asset.amount - agreedQuantity
            return (Some a)
          else return None

        return (sellerCash, buyerAsset, cashChange, assetChange)
```

---

## The Conservation Audit Checklist

When reviewing any DAML template, for every consuming choice, ask:

```
1. What is the total value coming IN?   (inputs archived)
2. What is the total value going OUT?   (outputs created)
3. Is IN == OUT?                        (conservation holds?)
4. Are there multiple paths to the same action?
5. Does conservation hold on EVERY path independently?
6. Is there a runtime assert checking sum(outputs) == sum(inputs)?
```

---

## Exercise 6: Find the Conservation Bug

```daml
template Staking
  with
    protocol : Party
    staker   : Party
    staked   : Decimal
    rewards  : Decimal
  where
    signatory protocol, staker
    ensure staked > 0.0 && rewards >= 0.0

    choice Unstake : ContractId StakerBalance
      controller staker
      do
        let rewardShare = rewards * 0.9    -- 90% to staker
        let protocolFee = rewards * 0.1   -- 10% to protocol
        create StakerBalance with
          owner  = staker
          amount = staked + rewardShare
        -- What's missing?
```

**Bug:** `protocolFee` is computed but never assigned to a contract. 10% of rewards vanish.

**Fix:** Create a fee collection contract:
```daml
    choice Unstake : (ContractId StakerBalance, ContractId ProtocolFees)
      controller staker
      do
        let rewardShare = rewards * 0.9
        let protocolFee = rewards * 0.1

        assert (rewardShare + protocolFee == rewards)  -- conservation check

        stakerPayout <- create StakerBalance with
          owner  = staker
          amount = staked + rewardShare
        feeCollection <- create ProtocolFees with
          protocol = protocol
          amount   = protocolFee
        return (stakerPayout, feeCollection)
```

---

## Key Takeaways

1. **UTXO model:** archive old contract, create new ones — any unallocated value is **destroyed**
2. **Conservation invariant:** `sum(inputs) == sum(outputs)` must hold for every consuming choice
3. **Add runtime asserts** to verify conservation during execution
4. **Multi-path systems** must maintain conservation on EVERY path independently
5. **`nonconsuming` + value creation** = infinite money printer — always consuming for value choices
6. **Partial settlement** must return excess to original owners, never silently absorb it

---

## Next Lesson
→ **Lesson 7: Time, Deadlines & Canton's Time Model**
