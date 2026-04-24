# Lesson 10: DAML Interfaces

> **Based on:** Official Docs: Daml Interfaces (Chapter 13)
> **Difficulty:** Intermediate → Advanced
> **Time:** ~25 minutes

---

## What Are Interfaces?

**Interfaces** in DAML are like interfaces in Java or traits in Rust — they define a **contract for behavior** that multiple templates can implement.

**Why use them?**
- Write code that works with **any token**, not just a specific token type
- Build composable systems where components don't need to know each other's concrete types
- Enable **upgradability** — add new implementations without changing consumers

```daml
-- Without interfaces: must write separate code for each token
transferDamlToken : ContractId DamlToken -> Party -> Update ()
transferFiatToken : ContractId FiatToken -> Party -> Update ()
transferStablecoin: ContractId Stablecoin -> Party -> Update ()

-- With interfaces: one function works for any Transferable token
transferAny : ContractId Transferable -> Party -> Update ()
```

---

## Defining an Interface

```daml
module Lesson10 where

-- Define the interface
interface Transferable where
  -- View type: what data is exposed through the interface
  viewtype TransferableView

  -- Interface choices: what actions all implementations must support
  transfer : Party -> Update (ContractId Transferable)
  getOwner : Update Party

-- The view type defines what callers can see without knowing the concrete type
data TransferableView = TransferableView with
  owner  : Party
  issuer : Party
  amount : Decimal
```

---

## Implementing an Interface

```daml
-- Template 1: Simple Token implements Transferable
template SimpleToken
  with
    issuer : Party
    owner  : Party
    amount : Decimal
  where
    signatory issuer, owner
    ensure amount > 0.0

    -- Declare that this template implements Transferable
    implements Transferable where
      -- Provide the view
      view = TransferableView with
        owner  = owner
        issuer = issuer
        amount = amount

      -- Implement all interface choices
      transfer newOwner = do
        cid <- create this with owner = newOwner
        return (toInterfaceContractId cid)

      getOwner = return owner


-- Template 2: Regulated Token also implements Transferable
template RegulatedToken
  with
    issuer     : Party
    owner      : Party
    amount     : Decimal
    regulator  : Party
    compliance : Bool
  where
    signatory issuer, owner
    observer regulator
    ensure amount > 0.0 && compliance

    implements Transferable where
      view = TransferableView with
        owner  = owner
        issuer = issuer
        amount = amount

      -- Regulated transfer checks compliance first
      transfer newOwner = do
        assert compliance
        cid <- create this with owner = newOwner
        return (toInterfaceContractId cid)

      getOwner = return owner
```

---

## Using Interfaces

```daml
-- A DEX that works with ANY Transferable token
template DEXOrder
  with
    exchange : Party
    trader   : Party
    tokenCid : ContractId Transferable   -- interface type, not concrete!
    price    : Decimal
  where
    signatory exchange, trader

    choice FillOrder : ContractId Transferable
      with buyer : Party
      controller exchange
      do
        -- Works regardless of whether it's SimpleToken or RegulatedToken
        newCid <- exercise tokenCid (transfer buyer)

        -- Get view data without knowing concrete type
        let tokenView = view (toInterface @Transferable tokenCid)
        assert (tokenView.amount > 0.0)

        return newCid
```

---

## Converting Between Interface and Concrete Types

```daml
-- Concrete → Interface
let simpleToken : ContractId SimpleToken = ...
let asInterface : ContractId Transferable = toInterfaceContractId simpleToken

-- Interface → Concrete (may fail if wrong type!)
let backToSimple : Optional (ContractId SimpleToken) =
  fromInterfaceContractId @SimpleToken asInterface

-- Safe pattern using fromInterfaceContractId
case fromInterfaceContractId @SimpleToken asInterface of
  Some simpleCid -> -- it IS a SimpleToken
  None           -> -- it's some other Transferable implementation

-- Get the view (works on any interface ContractId)
tokenView <- view <$> fetch asInterface
-- tokenView :: TransferableView
```

---

## Interface Choices vs Template Choices

| | Interface Choice | Template Choice |
|--|-----------------|----------------|
| Defined in | `interface` block | `template` body |
| Works on | Any implementation | Only that template |
| Callable via | `ContractId InterfaceName` | `ContractId TemplateName` |
| Override possible | Yes (in `implements`) | N/A |

```daml
-- Calling a template choice (specific type required)
exercise simpleCid Transfer with newOwner = alice  -- only SimpleToken

-- Calling an interface choice (works on any implementation)
exercise asInterfaceCid (transfer alice)  -- any Transferable
```

---

## Real-World Example: Token Standard

This mirrors the ERC-20 pattern from Ethereum, but in DAML:

```daml
-- The "ERC-20 equivalent" interface for DAML
interface FungibleToken where
  viewtype FungibleTokenView

  -- Core token operations
  getBalance    : Update Decimal
  transferTo    : Party -> Decimal -> Update (ContractId FungibleToken)
  approve       : Party -> Decimal -> Update (ContractId Allowance)

data FungibleTokenView = FungibleTokenView with
  owner  : Party
  issuer : Party
  symbol : Text
  balance: Decimal

-- Anyone building on your platform uses ContractId FungibleToken
-- They don't care if it's USD, EUR, or a custom stablecoin underneath
template DeFiVault
  with
    protocol : Party
    user     : Party
    deposit  : ContractId FungibleToken   -- works with any token!
  where
    signatory protocol, user

    choice Withdraw : ContractId FungibleToken
      controller user
      do
        let tokenView = view (toInterface @FungibleToken deposit)
        assert (tokenView.owner == user)
        exercise deposit (transferTo user tokenView.balance)
```

---

## Exercise 10: Implement an Interface

Given this interface:
```daml
interface Ownable where
  viewtype OwnableView

  getOwner : Update Party
  transferOwnership : Party -> Update (ContractId Ownable)

data OwnableView = OwnableView with
  owner : Party
  name  : Text
```

Implement it for this `RealEstate` template:
```daml
template RealEstate
  with
    owner    : Party
    registry : Party
    address  : Text
    value    : Decimal
  where
    signatory registry, owner
    ensure value > 0.0

    -- TODO: implements Ownable where ...
```

**Answer:**
```daml
template RealEstate
  with
    owner    : Party
    registry : Party
    address  : Text
    value    : Decimal
  where
    signatory registry, owner
    ensure value > 0.0

    implements Ownable where
      view = OwnableView with
        owner = owner
        name  = address

      getOwner = return owner

      transferOwnership newOwner = do
        cid <- create this with owner = newOwner
        return (toInterfaceContractId cid)
```

---

## Key Takeaways

1. **Interfaces** define behavior contracts that multiple templates implement
2. The **viewtype** exposes read-only data to interface callers
3. Use `toInterfaceContractId` / `fromInterfaceContractId` to convert
4. Interface choices work on **any** implementing template
5. Enables building **generic protocols** (DEXs, vaults) that work with any token
6. Mirrors ERC-20/ERC-721 patterns but with DAML's privacy and authorization guarantees

---

## Next Lesson
→ **Lesson 11: Functional Programming in DAML**
