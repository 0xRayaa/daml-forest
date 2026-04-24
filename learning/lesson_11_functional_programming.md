# Lesson 11: Functional Programming in DAML

> **Based on:** Official Docs: Functional Programming 101 + Standard Library
> **Difficulty:** Intermediate
> **Time:** ~25 minutes

---

## DAML's Haskell Roots

DAML is based on **Haskell**. If you understand FP basics, DAML becomes much easier to read and write. You don't need to be a Haskell expert — just understand these core patterns.

---

## Functions

```daml
-- Function signature: name : input -> output
double : Int -> Int
double x = x * 2

-- Multiple arguments (curried)
add : Int -> Int -> Int
add x y = x + y

-- Applying functions
result1 = double 5          -- 10
result2 = add 3 4           -- 7
result3 = add 3             -- partially applied: Int -> Int function!
result4 = result3 10        -- 13
```

### Lambda Functions (Anonymous)
```daml
-- \arg -> body
double'  = \x -> x * 2
add'     = \x y -> x + y

-- Common usage: passing to map/filter
doubled = map (\x -> x * 2) [1,2,3]  -- [2,4,6]
```

---

## Working with Lists

Lists are **immutable** and **linked** in DAML (not arrays):

```daml
myList : [Int] = [1, 2, 3, 4, 5]

-- map: transform every element
doubled   = map (\x -> x * 2) myList    -- [2,4,6,8,10]
asText    = map show myList             -- ["1","2","3","4","5"]

-- filter: keep elements matching predicate
evens     = filter even myList          -- [2,4]
positives = filter (> 0) [-1, 2, -3, 4] -- [2,4]

-- foldl: reduce to a single value (left fold)
total     = foldl (+) 0 myList          -- 15
product'  = foldl (*) 1 myList          -- 120

-- Common list operations
len       = length myList       -- 5
firstElem = head myList         -- 1 (crashes on empty list!)
rest      = tail myList         -- [2,3,4,5]
reversed  = reverse myList      -- [5,4,3,2,1]
zipped    = zip [1,2,3] ["a","b","c"]  -- [(1,"a"),(2,"b"),(3,"c")]

-- Safe alternatives
safeHead = listToOptional myList  -- Some 1 (never crashes)
```

### Common DAML Contract Use Cases:
```daml
-- Sum all balances
totalBalance : [Decimal] -> Decimal
totalBalance balances = foldl (+) 0.0 balances

-- Find a party in a list
isApproved : Party -> [Party] -> Bool
isApproved party approvers = party `elem` approvers

-- Compute average fee
averageFee : [Decimal] -> Optional Decimal
averageFee [] = None
averageFee fees =
  let total = foldl (+) 0.0 fees
      count = intToDecimal (length fees)
  in Some (total / count)
```

---

## Pattern Matching

```daml
-- on variants (enums)
describeStatus : TradeStatus -> Text
describeStatus status = case status of
  Pending        -> "Awaiting settlement"
  Settled ref    -> "Settled: " <> ref
  Failed reason  -> "Failed: " <> reason
  Cancelled      -> "Cancelled by parties"

-- on Optional
processWallet : Optional Wallet -> Text
processWallet opt = case opt of
  None       -> "No wallet found"
  Some wallet -> "Balance: " <> show wallet.balance

-- on Lists
processInvoices : [Invoice] -> Text
processInvoices invoices = case invoices of
  []         -> "No invoices"
  [one]      -> "One invoice: " <> one.id
  (h :: t)   -> "First: " <> h.id <> ", plus " <> show (length t) <> " more"
```

---

## The `Optional` Type (Maybe)

`Optional` represents a value that might not exist — safer than null:

```daml
-- Creating Optional values
some42  : Optional Int = Some 42
nothing : Optional Int = None

-- Consuming Optional values — always handle both cases!
case maybeBalance of
  None    -> abort "No balance found"
  Some b  -> assert (b >= 0.0)

-- Helper functions
fromOptional : a -> Optional a -> a
fromOptional defaultVal opt = case opt of
  None    -> defaultVal
  Some v  -> v

-- Example: default balance to 0 if not found
balance = fromOptional 0.0 maybeBalance

-- mapOptional: transform if Some, pass through None
doubled = fmap (*2) (Some 21)   -- Some 42
doubled' = fmap (*2) None       -- None
```

---

## `do` Notation Deep Dive

`do` notation sequences actions, binding results with `<-`:

```daml
choice MyChoice : (ContractId A, ContractId B)
  controller someParty
  do
    -- Bind action results
    cidA <- create ContractA with field = "value"
    cidB <- create ContractB with ref = cidA

    -- Pure let bindings (no action, no <-)
    let sum = 1 + 2
    let message = "Hello " <> show sum

    -- Use bound values
    debug message

    -- Return a tuple
    return (cidA, cidB)
```

### `let` vs `<-`:
```daml
do
  let x = 5 + 3        -- pure computation, no action, x : Int
  y <- getTime          -- action result, y : Time
  let z = show y        -- pure: z : Text
  return x
```

---

## Useful Standard Library Functions

```daml
import DA.List
import DA.Optional
import DA.Text

-- DA.List
sortBy (\a b -> compare a.price b.price) orders   -- sort by field
groupBy (\a b -> a.category == b.category) items  -- group by field
nubBy (\a b -> a.id == b.id) contracts            -- remove duplicates
partition even [1,2,3,4,5]                        -- ([2,4], [1,3,5])

-- DA.Optional
mapOptional (\w -> if w.balance > 0.0 then Some w else None) wallets
catOptionals [Some 1, None, Some 3]  -- [1, 3]
whenSome opt (\v -> ...)             -- execute action if Some

-- DA.Text
T.isPrefixOf "BTC" ticker     -- True for "BTC-USD"
T.intercalate ", " ["a","b"]  -- "a, b"
T.splitOn "." "1.2.3"         -- ["1","2","3"]
show 42                        -- "42"
```

---

## Record Update Syntax

DAML has a clean syntax for updating record fields:

```daml
template Token
  with
    issuer : Party
    owner  : Party
    amount : Decimal
    locked : Bool
  where
    signatory issuer, owner

    choice UpdateAmount : ContractId Token
      with newAmount : Decimal
      controller issuer
      do
        -- Update one field: create this with field = newValue
        create this with amount = newAmount

    choice LockAndTransfer : ContractId Token
      with newOwner : Party
      controller owner
      do
        -- Update multiple fields at once
        create this with
          owner  = newOwner
          locked = True
```

---

## Exception Handling

```daml
import DA.Exception

-- Try an action that might fail
result <- try do
  (cid, contract) <- fetchByKey @Wallet (bank, alice)
  return (Some contract)
catch
  (GeneralError msg) -> do
    debug ("Wallet not found: " <> msg)
    return None

-- Throw custom exceptions
exception InsufficientFunds with
  available : Decimal
  required  : Decimal
    where
      message e = "Need " <> show e.required
               <> " but only have " <> show e.available

-- Use in a choice
choice Withdraw : ContractId Wallet
  with amount : Decimal
  controller owner
  do
    when (amount > balance) $
      throw InsufficientFunds with available = balance; required = amount
    create this with balance = balance - amount
```

---

## Exercise 11: Write Helper Functions

Complete these utility functions used in a DeFi protocol:

```daml
-- 1. Calculate the weighted average price from a list of trades
-- Each trade has a price and quantity
weightedAvgPrice : [(Decimal, Int)] -> Optional Decimal
weightedAvgPrice trades = ???

-- 2. Find all parties who appear in MORE than one trade
duplicateParties : [Party] -> [Party]
duplicateParties parties = ???

-- 3. Apply a fee schedule: 0.1% for < 1000, 0.05% for >= 1000
calculateFee : Decimal -> Decimal
calculateFee amount = ???
```

**Answers:**
```daml
weightedAvgPrice : [(Decimal, Int)] -> Optional Decimal
weightedAvgPrice [] = None
weightedAvgPrice trades =
  let totalQty   = foldl (\acc (_, q) -> acc + intToDecimal q) 0.0 trades
      totalValue = foldl (\acc (p, q) -> acc + p * intToDecimal q) 0.0 trades
  in if totalQty == 0.0 then None
     else Some (totalValue / totalQty)

duplicateParties : [Party] -> [Party]
duplicateParties parties =
  let sorted = sortBy compare parties
      grouped = groupBy (==) sorted
  in map head (filter (\g -> length g > 1) grouped)

calculateFee : Decimal -> Decimal
calculateFee amount =
  if amount < 1000.0
    then amount * 0.001   -- 0.1%
    else amount * 0.0005  -- 0.05%
```

---

## Key Takeaways

1. **Lambdas** (`\x -> expr`) are anonymous functions — critical for `map`/`filter`/`sortBy`
2. **Pattern matching** with `case` is how you branch on Optional, List, and variants
3. **`Optional`** replaces null — always handle both `Some` and `None`
4. **`do` notation** sequences actions; `<-` binds results, `let` binds pure values
5. **Standard library** (`DA.List`, `DA.Optional`, `DA.Text`) has everything you need
6. **Record update syntax** (`create this with field = newValue`) keeps choices clean
7. **Exception handling** with `try`/`catch`/`throw` for recoverable errors

---

## Next Lesson
→ **Lesson 12: Governance, Arithmetic Safety & DoS Prevention**
