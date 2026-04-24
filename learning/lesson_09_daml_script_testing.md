# Lesson 9: Daml Script & Testing

> **Based on:** Daml 101 Video Series (Episode 11-12) + Official Docs: DamlScript & Testing
> **Difficulty:** Beginner → Intermediate
> **Time:** ~30 minutes

---

## What is Daml Script?

**Daml Script** is a testing and scripting language built into DAML. It lets you:
- **Test** your templates without deploying to a real ledger
- **Simulate** multi-party interactions
- **Verify** both happy paths and failure cases
- **Automate** ledger initialization

Think of it like Foundry/Hardhat tests for Solidity — but with built-in party simulation.

```daml
module TestLesson9 where

import Daml.Script

-- A basic test script
myFirstTest : Script ()
myFirstTest = do
  -- Allocate parties (simulated identities)
  alice <- allocateParty "Alice"
  bob   <- allocateParty "Bob"

  -- Alice creates an IOU for Bob
  iouCid <- submit alice do
    createCmd IOU with
      issuer = alice
      owner  = bob
      amount = 100.0

  -- Bob transfers it to Charlie
  charlie <- allocateParty "Charlie"
  submit bob do
    exerciseCmd iouCid Transfer with newOwner = charlie

  return ()
```

---

## Script Basics

### Allocating Parties
```daml
setup : Script ()
setup = do
  -- Basic party allocation
  alice <- allocateParty "Alice"
  bob   <- allocatePartyWithHint "Bob" (PartyIdHint "Bob")

  -- Party display name vs ledger ID
  -- "Alice" is display name — actual party ID is generated
  debug alice  -- prints actual party ID
```

### Submitting Transactions
```daml
-- submit: expects success, fails the test if it errors
cid <- submit alice do
  createCmd MyTemplate with field1 = alice; field2 = 42

-- submitMustFail: expects failure, fails the test if it succeeds
submitMustFail alice do
  createCmd MyTemplate with field1 = alice; field2 = -1  -- should fail ensure

-- submitMulti: multiple parties authorize together
submit [alice, bob] do
  createCmd JointContract with party1 = alice; party2 = bob
```

### Commands in Script
```daml
submit alice do
  -- createCmd: create a contract
  cid1 <- createCmd IOU with issuer = alice; owner = bob; amount = 50.0

  -- exerciseCmd: exercise a choice
  exerciseCmd cid1 Transfer with newOwner = charlie

  -- archiveCmd: archive a contract
  archiveCmd someCid

  -- exerciseByKeyCmd: exercise by contract key
  exerciseByKeyCmd @Wallet (bank, alice) Deposit with amount = 100.0
```

---

## Testing for Failure

One of the most important test patterns — verifying that invalid actions are rejected:

```daml
testLoanValidation : Script ()
testLoanValidation = do
  lender   <- allocateParty "Lender"
  borrower <- allocateParty "Borrower"

  -- ✅ Valid loan should succeed
  validCid <- submit [lender, borrower] do
    createCmd Loan with
      lender   = lender
      borrower = borrower
      amount   = 1000.0
      rate     = 5.0

  -- ❌ Negative amount should fail (ensure clause)
  submitMustFail [lender, borrower] do
    createCmd Loan with
      lender   = lender
      borrower = borrower
      amount   = -100.0  -- should fail!
      rate     = 5.0

  -- ❌ Self-loan should fail (ensure lender /= borrower)
  submitMustFail [lender] do
    createCmd Loan with
      lender   = lender
      borrower = lender  -- same party — should fail!
      amount   = 100.0
      rate     = 5.0

  -- ❌ Bob trying to repay Alice's loan should fail (wrong controller)
  submitMustFail borrower do
    exerciseCmd validCid Cancel  -- only lender can cancel

  return ()
```

---

## Testing Multi-Party Workflows

```daml
testProposeAccept : Script ()
testProposeAccept = do
  buyer  <- allocateParty "Buyer"
  seller <- allocateParty "Seller"

  -- Step 1: Buyer proposes trade
  proposalCid <- submit buyer do
    createCmd TradeProposal with
      buyer  = buyer
      seller = seller
      asset  = "BOND-A"
      price  = 1000.0

  -- Step 2: Seller accepts
  tradeCid <- submit seller do
    exerciseCmd proposalCid Accept

  -- Verify: trade contract exists and has correct data
  Some trade <- queryContractId seller tradeCid
  assert (trade.buyer  == buyer)
  assert (trade.seller == seller)
  assert (trade.price  == 1000.0)

  -- Step 3: Test rejection path
  proposal2Cid <- submit buyer do
    createCmd TradeProposal with
      buyer  = buyer
      seller = seller
      asset  = "BOND-B"
      price  = 2000.0

  submit seller do
    exerciseCmd proposal2Cid Reject

  -- After rejection, proposal should no longer exist
  None <- queryContractId seller proposal2Cid
  return ()
```

---

## Querying the Ledger in Tests

```daml
testQuerying : Script ()
testQuerying = do
  issuer <- allocateParty "Issuer"
  alice  <- allocateParty "Alice"
  bob    <- allocateParty "Bob"

  -- Create a few IOUs
  cid1 <- submit issuer do
    createCmd IOU with issuer = issuer; owner = alice; amount = 100.0
  cid2 <- submit issuer do
    createCmd IOU with issuer = issuer; owner = alice; amount = 200.0
  cid3 <- submit issuer do
    createCmd IOU with issuer = issuer; owner = bob; amount = 50.0

  -- Query all IOUs visible to alice
  aliceIOUs <- query @IOU alice
  assert (length aliceIOUs == 2)  -- alice sees her 2 IOUs

  -- Query all IOUs visible to issuer
  allIOUs <- query @IOU issuer
  assert (length allIOUs == 3)  -- issuer sees all 3

  -- Fetch a specific contract
  Some iou <- queryContractId alice cid1
  assert (iou.amount == 100.0)

  -- Fetch by key
  Some (_, wallet) <- queryContractKey @Wallet alice (bank, alice)
  assert (wallet.balance >= 0.0)
```

---

## Time Manipulation in Tests

```daml
testTimeLogic : Script ()
testTimeLogic = do
  seller <- allocateParty "Seller"
  bidder <- allocateParty "Bidder"

  -- Set ledger time to Jan 1, 2024
  setTime (datetime 2024 1 1 12 0 0)

  auctionCid <- submit seller do
    createCmd TimedAuction with
      seller        = seller
      highestBidder = seller
      highestBid    = 0.0
      deadline      = datetime 2024 1 2 12 0 0   -- deadline: Jan 2
      gracePeriod   = minutes 5

  -- Bid before deadline — should succeed
  updatedCid <- submit bidder do
    exerciseCmd auctionCid Bid with bidder = bidder; bidAmount = 100.0

  -- Advance time past deadline
  passTime (days 2)  -- now Jan 3

  -- Bid after deadline — should fail
  submitMustFail bidder do
    exerciseCmd updatedCid Bid with bidder = bidder; bidAmount = 200.0

  -- Close after deadline — should succeed
  submit seller do
    exerciseCmd updatedCid Close
```

---

## Test Coverage

DAML has built-in test coverage checking. Run with:
```bash
daml test --coverage
```

Output shows:
```
Templates: 5/5 created
Choices:   12/15 exercised   ← find untested choices!
```

### Coverage Example:
```daml
-- Make sure you test EVERY choice and EVERY create path
testFullCoverage : Script ()
testFullCoverage = do
  -- Test all happy paths
  -- Test all failure paths (submitMustFail)
  -- Test edge cases (zero amounts, boundary times)
  -- Test the "escape hatch" (what if a party disappears?)
  return ()
```

---

## Common Test Patterns

### Pattern 1: Setup Helper
```daml
data TestSetup = TestSetup with
  alice : Party
  bob   : Party
  bank  : Party

setupParties : Script TestSetup
setupParties = do
  alice <- allocateParty "Alice"
  bob   <- allocateParty "Bob"
  bank  <- allocateParty "Bank"
  return TestSetup with alice; bob; bank

-- Reuse in multiple tests
testA : Script ()
testA = do
  TestSetup{..} <- setupParties
  -- ... use alice, bob, bank

testB : Script ()
testB = do
  TestSetup{..} <- setupParties
  -- ... use alice, bob, bank
```

### Pattern 2: Assert Custom Messages
```daml
-- Better than just `assert`
assertMsg "Balance should be positive" (balance > 0.0)
assertEq "Balances should match" expectedBalance actualBalance
```

---

## Exercise 9: Write the Test

Write a Daml Script test for this `Escrow` template:

```daml
template Escrow
  with
    buyer  : Party
    seller : Party
    agent  : Party
    amount : Decimal
  where
    signatory buyer, agent
    observer seller
    ensure amount > 0.0

    choice Release : ()  -- agent releases to seller
      controller agent
      do return ()

    choice Refund : ()   -- agent refunds to buyer
      controller agent
      do return ()
```

**Write a test that:**
1. Creates an Escrow with valid data
2. Verifies invalid amounts are rejected
3. Tests that only `agent` can release/refund
4. Tests both the Release and Refund paths

**Answer:**
```daml
testEscrow : Script ()
testEscrow = do
  buyer  <- allocateParty "Buyer"
  seller <- allocateParty "Seller"
  agent  <- allocateParty "Agent"

  -- Valid creation
  cid <- submit [buyer, agent] do
    createCmd Escrow with buyer; seller; agent; amount = 500.0

  -- Invalid amount rejected
  submitMustFail [buyer, agent] do
    createCmd Escrow with buyer; seller; agent; amount = -1.0

  -- Seller can't release (wrong controller)
  submitMustFail seller do
    exerciseCmd cid Release

  -- Agent releases
  submit agent do
    exerciseCmd cid Release

  -- Test refund path
  cid2 <- submit [buyer, agent] do
    createCmd Escrow with buyer; seller; agent; amount = 200.0
  submit agent do
    exerciseCmd cid2 Refund
```

---

## Key Takeaways

1. **Daml Script** is DAML's built-in testing framework
2. `submit` expects success; `submitMustFail` expects failure
3. Always test **both happy paths and failure paths**
4. Use `setTime`/`passTime` for temporal logic tests
5. `query`, `queryContractId`, `queryContractKey` let you inspect ledger state
6. Extract setup into helpers — don't repeat party allocation in every test
7. Run `daml test --coverage` to find untested choices

---

## Next Lesson
→ **Lesson 10: DAML Interfaces**
