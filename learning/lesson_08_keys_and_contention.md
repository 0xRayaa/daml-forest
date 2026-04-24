# Lesson 8: Contract Keys, References & Contention

> **Based on:** Security Guide 3 §5-6, Official Docs: Contract Keys
> **Difficulty:** Advanced
> **Time:** ~30 minutes

---

## Contract Keys Recap

Contract keys let you look up a contract by a known value, without knowing its `ContractId`:

```daml
template Wallet
  with
    bank  : Party
    owner : Party
    balance : Decimal
  where
    signatory bank, owner
    key (bank, owner) : (Party, Party)   -- unique key
    maintainer key._1                    -- bank enforces uniqueness
    ensure balance >= 0.0
```

**Three operations:**
```daml
-- 1. lookupByKey — returns Optional ContractId (None if not found)
result <- lookupByKey @Wallet (bank, alice)

-- 2. fetchByKey — returns (ContractId, contract) — fails if not found
(cid, wallet) <- fetchByKey @Wallet (bank, alice)

-- 3. exerciseByKey — exercise directly by key
exerciseByKey @Wallet (bank, alice) Deposit with amount = 100.0
```

---

## TOCTOU with `lookupByKey`

```daml
-- ❌ BAD: lookupByKey then fetch = TOCTOU race
template PaymentProcessor
  with bank : Party
  where
    signatory bank

    nonconsuming choice ProcessPayment : ()
      with payer : Party; amount : Decimal
      controller bank
      do
        walletKeyOpt <- lookupByKey @Wallet (bank, payer)
        case walletKeyOpt of
          None -> abort "No wallet"
          Some walletCid -> do
            wallet <- fetch walletCid
            -- BUG: wallet may have been archived between lookup and fetch!
            assert (wallet.balance >= amount)
            exercise walletCid Archive
            create Wallet with
              bank = bank; owner = payer
              balance = wallet.balance - amount
```

**Why it fails:** Another transaction could archive `walletCid` between `lookupByKey` and `fetch`. The `fetch` then fails with a "contract not found" error.

```daml
-- ✅ GOOD: Use fetchByKey for atomic lookup + fetch
    nonconsuming choice ProcessPayment : ()
      with payer : Party; amount : Decimal
      controller bank
      do
        -- fetchByKey is atomic — lookup and fetch in one step
        (walletCid, wallet) <- fetchByKey @Wallet (bank, payer)
        assert (wallet.balance >= amount)
        archive walletCid
        create Wallet with
          bank    = bank
          owner   = payer
          balance = wallet.balance - amount
```

---

## Concurrent Key-Creation Race

Canton enforces key uniqueness **within a transaction**, not globally. Two concurrent transactions can both see `None` and both succeed:

```daml
-- ❌ BAD: nonconsuming service allows concurrent duplicate registrations
template RegistryService
  with registry : Party
  where
    signatory registry

    nonconsuming choice Register : ContractId DomainName
      with user : Party; name : Text
      controller user
      do
        existing <- lookupByKey @DomainName (registry, name)
        case existing of
          Some _ -> abort "Name taken"
          None   ->
            -- BUG: Two concurrent callers both reach here simultaneously!
            -- Both see None, both create DomainName("alice.com") → duplicate keys!
            create DomainName with registry = registry; owner = user; name = name
```

**Why it fails:** `nonconsuming` means the `RegistryService` contract is not consumed — concurrent calls don't contend. Both see `lookupByKey` return `None` before either commits.

```daml
-- ✅ GOOD: Consuming generator pattern serializes concurrent calls
template RegistryService
  with registry : Party
  where
    signatory registry

    -- Consuming: concurrent calls contend on this single contract
    -- Canton rejects all but one; losers get retriable errors
    choice Register : (ContractId RegistryService, ContractId DomainName)
      with user : Party; name : Text
      controller registry
      do
        existing <- lookupByKey @DomainName (registry, name)
        case existing of
          Some _ -> abort "Name taken"
          None   -> do
            nameCid <- create DomainName with
              registry = registry; owner = user; name = name
            svcCid  <- create this    -- recreate the service
            return (svcCid, nameCid)
```

**How it works:** The consuming `Register` choice archives `RegistryService`. Only one transaction can archive it — Canton's contention layer rejects the others with a retriable error.

---

## Unvalidated Contract ID Arguments

Choices that accept `ContractId` arguments must validate those contracts:

```daml
-- ❌ BAD: Caller can pass any ContractId — no validation
template Settlement
  with
    exchange : Party
    buyer    : Party
    seller   : Party
    tradeId  : Text
  where
    signatory exchange
    observer buyer, seller

    choice Settle : ()
      with
        paymentCid : ContractId Payment
        assetCid   : ContractId Asset
      controller exchange
      do
        payment <- fetch paymentCid
        asset   <- fetch assetCid
        -- BUG: No check that payment.buyer == buyer
        -- BUG: No check that asset.seller == seller
        -- BUG: No check that payment.amount matches agreed price
        archive paymentCid
        archive assetCid
        -- ... create new holdings
```

```daml
-- ✅ GOOD: Validate every field of fetched contracts
    choice Settle : ()
      with
        paymentCid    : ContractId Payment
        assetCid      : ContractId Asset
        agreedPrice   : Decimal
        agreedQty     : Int
      controller exchange
      do
        payment <- fetch paymentCid
        asset   <- fetch assetCid

        -- Validate ownership
        assert (payment.buyer  == buyer)
        assert (payment.seller == seller)
        assert (asset.seller   == seller)
        assert (asset.buyer    == buyer)

        -- Validate amounts match agreed terms
        assert (payment.amount == agreedPrice)
        assert (asset.quantity == agreedQty)

        -- Validate same trade
        assert (payment.tradeId == tradeId)
        assert (asset.tradeId   == tradeId)

        archive paymentCid
        archive assetCid
        -- ... create new holdings
```

---

## Hot Contract Contention

A "hot contract" is one that many parties update frequently. Because DAML choices are consuming, only ONE update can succeed at a time — others fail and must retry.

```daml
-- ❌ BAD: Single global order book — massive contention
template GlobalOrderBook
  with
    exchange : Party
    orders   : [(Party, Text, Decimal)]  -- all orders in one contract
  where
    signatory exchange

    choice AddOrder : ContractId GlobalOrderBook
      with trader : Party; asset : Text; price : Decimal
      controller exchange
      do
        -- Every order update: archive + recreate this contract
        -- Only 1 transaction succeeds at a time across ALL traders!
        create this with orders = (trader, asset, price) :: orders
```

```daml
-- ✅ GOOD: Each order is its own contract — parallel updates possible
template Order
  with
    exchange : Party
    trader   : Party
    asset    : Text
    price    : Decimal
    quantity : Int
    status   : Text
  where
    signatory exchange, trader
    ensure price > 0.0 && quantity > 0

    choice Cancel : ()
      controller trader
      do return ()

    choice Fill : ContractId FilledOrder
      with fillQuantity : Int
      controller exchange
      do
        assert (fillQuantity > 0 && fillQuantity <= quantity)
        create FilledOrder with
          exchange = exchange; trader = trader
          asset = asset; price = price; quantity = fillQuantity
```

### Contention Patterns:
| Pattern | Use When | Contention |
|---------|----------|------------|
| Per-entity contracts | Each entity has its own contract | Low |
| Consuming generator | Serialized key uniqueness | Intentional |
| Batching | Aggregate many small updates | Medium |
| CQRS (off-ledger read) | High read, low write | Low |

---

## Exercise 8: Multiple Bugs

Find all bugs in this token minting system:

```daml
template MintingService
  with
    minter    : Party
    maxSupply : Int
    minted    : Int
  where
    signatory minter

    nonconsuming choice MintTokens : ContractId Token   -- (a)
      with
        recipient : Party
        amount    : Int
      controller minter
      do
        -- (b) no validation on amount
        -- (c) no check that minted + amount <= maxSupply
        tokenKey <- lookupByKey @Token (minter, recipient)   -- (d)
        case tokenKey of
          None -> create Token with
            minter = minter; owner = recipient; balance = amount
          Some cid -> do
            tok <- fetch cid   -- (e) TOCTOU
            archive cid
            create Token with
              minter = minter; owner = recipient
              balance = tok.balance + amount
```

**Bugs:**
- **(a)** `nonconsuming` + creating tokens = unlimited minting with no supply tracking
- **(b)** `amount` could be negative (burning without consent) or zero
- **(c)** No supply cap enforcement — can exceed `maxSupply`
- **(d)+(e)** `lookupByKey` then `fetch` = TOCTOU race
- **Missing:** `minted` field is never updated (it's on the service contract which is never recreated)

**Fix:** Make `MintTokens` consuming (to update `minted`), add validation, use `fetchByKey`:
```daml
    choice MintTokens : (ContractId MintingService, ContractId Token)
      with recipient : Party; amount : Int
      controller minter
      do
        assert (amount > 0)
        assert (minted + amount <= maxSupply)

        tokenResult <- lookupByKey @Token (minter, recipient)
        tokenCid <- case tokenResult of
          None -> create Token with
            minter = minter; owner = recipient; balance = amount
          Some cid -> do
            (existingCid, tok) <- fetchByKey @Token (minter, recipient)
            archive existingCid
            create Token with
              minter = minter; owner = recipient
              balance = tok.balance + amount

        -- Recreate service with updated minted count
        newSvc <- create this with minted = minted + amount
        return (newSvc, tokenCid)
```

---

## Key Takeaways

1. **`fetchByKey`** is atomic — use it instead of `lookupByKey` + `fetch`
2. **Concurrent key creation** can create duplicates — use the consuming generator pattern
3. **Always validate** fetched contract fields — never trust caller-supplied CIDs blindly
4. **Hot contracts** cause contention — model each entity separately
5. **`nonconsuming` choices** that create value are infinite mint vulnerabilities
6. **State updates on the service contract** require making the choice consuming and recreating the contract

---

## Next Lesson
→ **Lesson 9: Governance, Arithmetic & DoS Prevention**
