# Lesson 3: Data Types & the `ensure` Clause

> **Based on:** Daml 101 Video Series (Episode 5-6) + Official Docs: Data Types
> **Difficulty:** Beginner
> **Time:** ~25 minutes

---

## Native Data Types

DAML has a rich set of built-in types:

```daml
-- Numbers
myInt     : Int     = 42           -- 64-bit signed integer
myDecimal : Decimal = 3.14159      -- fixed-point, 10 decimal places

-- Text
myText : Text = "Hello, DAML!"

-- Boolean
myBool : Bool = True

-- Time
myTime : Time = datetime 2024 1 1 0 0 0  -- Jan 1 2024 00:00:00

-- Party
alice : Party  -- assigned by the ledger at runtime

-- Contract IDs
myCid : ContractId IOU  -- reference to an IOU contract on the ledger
```

### ⚠️ Int and Decimal Gotchas

```daml
-- Int is 64-bit: max = 9,223,372,036,854,775,807
-- Overflow causes ArithmeticError (aborts transaction!)
let big : Int = 9223372036854775807
-- let overflow = big + 1  -- CRASHES!

-- Decimal has exactly 10 decimal places
-- 1.0 / 3.0 = 0.3333333333 (not perfectly 1/3)
-- Rounding errors accumulate with many divisions
```

---

## Composite Types

### Records (Named Tuples)
```daml
data Address = Address with
  street  : Text
  city    : Text
  country : Text
  zipCode : Text

-- Use in a template:
template CustomerProfile
  with
    bank     : Party
    customer : Party
    name     : Text
    address  : Address    -- nested record
  where
    signatory bank, customer
```

### Variants (Enums with Data)
```daml
data TradeStatus
  = Pending
  | Settled Text    -- includes settlement reference
  | Failed Text     -- includes failure reason
  | Cancelled

-- Pattern match on it:
getStatusMessage : TradeStatus -> Text
getStatusMessage status = case status of
  Pending       -> "Trade is pending settlement"
  Settled ref   -> "Settled with ref: " <> ref
  Failed reason -> "Failed: " <> reason
  Cancelled     -> "Trade was cancelled"
```

### Lists
```daml
myList : [Int] = [1, 2, 3, 4, 5]

-- Common list operations:
let doubled = map (*2) myList           -- [2,4,6,8,10]
let evens   = filter even myList        -- [2,4]
let total   = foldl (+) 0 myList        -- 15
let first   = head myList               -- 1 (crashes if empty!)
let safeHead = listToOptional myList    -- Some 1
```

### Optional (Maybe)
```daml
-- Represents a value that might not exist
findWallet : Party -> [Wallet] -> Optional Wallet
findWallet owner wallets =
  find (\w -> w.owner == owner) wallets

-- Always handle both cases:
case findWallet alice wallets of
  None       -> error "Wallet not found"
  Some wallet -> wallet.balance
```

---

## The `ensure` Clause — Your First Defense

The `ensure` clause is a **precondition** on contract creation. If it evaluates to `False`, the creation fails immediately.

```daml
template Loan
  with
    lender      : Party
    borrower    : Party
    amount      : Decimal
    interestRate : Decimal
  where
    signatory lender, borrower

    -- Contract CANNOT be created if any of these fail
    ensure amount > 0.0
        && interestRate >= 0.0
        && interestRate <= 100.0
        && lender /= borrower    -- can't lend to yourself
```

### Why `ensure` Matters

Without `ensure`, invalid state can exist on the ledger:

```daml
-- BAD: No ensure — any values allowed
template BadLoan
  with
    lender   : Party
    borrower : Party
    amount   : Decimal   -- could be -1000.0 !
  where
    signatory lender, borrower
    -- No ensure: negative loans, zero loans, self-loans all possible
```

```daml
-- GOOD: ensure blocks invalid states at creation
template GoodLoan
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
  where
    signatory lender, borrower

    ensure amount > 0.0       -- must be positive
        && lender /= borrower -- must be different parties
```

---

## `assert` Inside Choices

While `ensure` guards contract creation, `assert` guards individual choice executions:

```daml
template TokenBalance
  with
    issuer  : Party
    owner   : Party
    balance : Int
    maxSupply : Int
  where
    signatory issuer, owner

    ensure balance >= 0
        && balance <= maxSupply
        && maxSupply > 0

    choice Transfer : (ContractId TokenBalance, ContractId TokenBalance)
      with
        recipient     : Party
        transferAmount : Int
      controller owner
      do
        -- Guard the choice inputs
        assert (transferAmount > 0)           -- must transfer something
        assert (transferAmount <= balance)    -- can't overdraw

        sender   <- create this with balance = balance - transferAmount
        receiver <- create TokenBalance with
          issuer    = issuer
          owner     = recipient
          balance   = transferAmount
          maxSupply = maxSupply
        return (sender, receiver)
```

### `ensure` vs `assert`:

| | `ensure` | `assert` |
|--|----------|----------|
| Where | Template body | Inside choice `do` block |
| Guards | Contract creation | Choice execution |
| Applies to | Template fields | Any condition |
| Failure message | Generic | Can use `assertMsg` for custom message |

---

## Contract Keys

**Contract keys** allow looking up a contract without knowing its ContractId.

```daml
template UserProfile
  with
    platform : Party
    user     : Party
    username : Text
    email    : Text
  where
    signatory platform, user

    -- Key = (platform, username) — must be unique!
    key (platform, username) : (Party, Text)
    maintainer key._1        -- platform enforces uniqueness
```

### Using Keys:
```daml
-- Look up (returns Optional ContractId)
result <- lookupByKey @UserProfile (platform, "alice123")
case result of
  None    -> abort "User not found"
  Some cid -> -- do something with cid

-- Fetch by key (fails if not found)
(cid, profile) <- fetchByKey @UserProfile (platform, "alice123")
```

> **Warning:** Contract keys have a TOCTOU (time-of-check-time-of-use) vulnerability — the contract found by `lookupByKey` might be archived by the time you try to use it.

---

## Exercise 3: Add Validation

The following template is missing validation. Add `ensure` and `assert` clauses:

```daml
template Auction
  with
    seller       : Party
    highestBidder : Party
    highestBid   : Decimal
    reservePrice : Decimal
    deadline     : Time
  where
    signatory seller
    observer highestBidder

    -- TODO: Add ensure clause here

    choice PlaceBid : ContractId Auction
      with
        bidder    : Party
        bidAmount : Decimal
      controller bidder
      do
        -- TODO: Add assert for bid amount > highestBid
        -- TODO: Add assert for bidAmount > 0
        now <- getTime
        -- TODO: Add assert that now < deadline
        create this with
          highestBidder = bidder
          highestBid    = bidAmount
```

**Answer:**
```daml
template Auction
  with
    seller        : Party
    highestBidder : Party
    highestBid    : Decimal
    reservePrice  : Decimal
    deadline      : Time
  where
    signatory seller
    observer highestBidder

    ensure highestBid >= 0.0
        && reservePrice > 0.0

    choice PlaceBid : ContractId Auction
      with
        bidder    : Party
        bidAmount : Decimal
      controller bidder
      do
        assert (bidAmount > 0.0)
        assert (bidAmount > highestBid)
        now <- getTime
        assert (now < deadline)
        create this with
          highestBidder = bidder
          highestBid    = bidAmount
```

---

## Key Takeaways

1. **`Int`** is 64-bit — overflow causes transaction abort
2. **`Decimal`** has 10 decimal places — rounding errors accumulate
3. **Records, Variants, Lists, Optional** are your main composite types
4. **`ensure`** guards contract creation — blocks invalid state at the source
5. **`assert`** guards choice execution — validates inputs
6. **Contract keys** enable lookup by value, but have TOCTOU risks

---

## Next Lesson
→ **Lesson 4: Parties, Authority & the Authorization Model**
