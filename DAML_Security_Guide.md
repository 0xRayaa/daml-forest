# DAML Smart Contract Security Guide

### Common Vulnerabilities, Exploits & Best Practices

> **Audience:** Developers, auditors, and security researchers working with DAML & Canton  
> **Purpose:** Canton marketing presentation & DAML workshop reference  
> **By:** CredShields

---

## Table of Contents

1. [Authorization Vulnerabilities](#1-authorization-vulnerabilities)
2. [Privacy & Confidentiality Leaks](#2-privacy--confidentiality-leaks)
3. [Double Spend & Contention Issues](#3-double-spend--contention-issues)
4. [Arithmetic & Logic Bugs](#4-arithmetic--logic-bugs)
5. [Time Manipulation](#5-time-manipulation)
6. [Contract Key Integrity Issues](#6-contract-key-integrity-issues)
7. [Choice & Workflow Logic](#7-choice--workflow-logic)
8. [Contract Lifecycle & Archival](#8-contract-lifecycle--archival)
9. [Choice Design Flaws](#9-choice-design-flaws)
10. [Canton / Ledger-Level Issues](#10-canton--ledger-level-issues)
11. [Upgrade & Migration Risks](#11-upgrade--migration-risks)
12. [Ledger API Security](#12-ledger-api-security)
13. [Trigger & Automation Risks](#13-trigger--automation-risks)
14. [Off-Ledger Integration](#14-off-ledger-integration)
15. [Workshop Exercises](#15-workshop-exercises)

---

## 1. Authorization Vulnerabilities

Authorization is the most critical layer in DAML. Every contract has **signatories** (who must authorize creation) and **observers** (who can see the contract). Choices have **controllers** (who can exercise them). Mistakes here can be catastrophic.

### 1.1 Missing `ensure` Checks

The `ensure` clause is a precondition that must hold true for a contract to be created. Omitting it allows invalid state to exist on-ledger.

**Vulnerable Code:**

```daml
-- BAD: No validation on contract creation
template Loan
  with
    lender : Party
    borrower : Party
    amount : Decimal
    interestRate : Decimal
  where
    signatory lender, borrower
    observer lender, borrower

    choice Repay : ContractId Loan
      with
        repaymentAmount : Decimal
      controller borrower
      do
        create this with amount = amount - repaymentAmount
```

**What's wrong:**
- No `ensure` clause: `amount` could be negative or zero at creation
- `interestRate` could be negative (free money!)
- `repaymentAmount` is never validated -- could be negative (increasing the loan) or greater than `amount`
- After `Repay`, the loan is recreated even if fully paid off

**Fixed Code:**

```daml
-- GOOD: Proper validation
template Loan
  with
    lender : Party
    borrower : Party
    amount : Decimal
    interestRate : Decimal
  where
    signatory lender, borrower
    observer lender, borrower

    ensure amount > 0.0
      && interestRate >= 0.0
      && interestRate <= 100.0

    choice Repay : Optional (ContractId Loan)
      with
        repaymentAmount : Decimal
      controller borrower
      do
        assert (repaymentAmount > 0.0)
        assert (repaymentAmount <= amount)
        let remaining = amount - repaymentAmount
        if remaining > 0.0
          then do
            cid <- create this with amount = remaining
            return (Some cid)
          else
            return None
```

### 1.2 Wrong Controller on Choices

If the wrong party is designated as controller, unauthorized parties can execute sensitive actions.

**Vulnerable Code:**

```daml
-- BAD: Anyone who is the "operator" can transfer funds
template Account
  with
    bank : Party
    owner : Party
    balance : Decimal
  where
    signatory bank
    observer owner

    -- VULNERABILITY: bank can transfer without owner consent!
    choice Transfer : (ContractId Account, ContractId Account)
      with
        recipient : Party
        transferAmount : Decimal
      controller bank
      do
        -- Bank alone moves owner's money
        senderAccount <- create this with balance = balance - transferAmount
        recipientAccount <- create Account with
          bank = bank
          owner = recipient
          balance = transferAmount
        return (senderAccount, recipientAccount)
```

**What's wrong:**
- Only `bank` is controller -- the account `owner` has no say in transfers from their own account
- The `owner` is merely an observer, not a signatory -- they cannot block creation of bad contracts

**Fixed Code:**

```daml
-- GOOD: Owner must authorize transfers
template Account
  with
    bank : Party
    owner : Party
    balance : Decimal
  where
    signatory bank, owner  -- owner is now a signatory
    observer bank

    ensure balance >= 0.0

    choice Transfer : (ContractId Account, ContractId Account)
      with
        recipient : Party
        transferAmount : Decimal
      controller owner  -- owner controls their own transfers
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

### 1.3 Overly Broad Signatories

Making too many parties signatories creates a usability problem (all must authorize) but also a trust problem if the wrong parties are included.

**Vulnerable Code:**

```daml
-- BAD: Auditor as signatory -- gives them veto power over everything
template Trade
  with
    buyer : Party
    seller : Party
    auditor : Party
    asset : Text
    price : Decimal
  where
    signatory buyer, seller, auditor  -- auditor can block all trades!

    choice Settle : ()
      controller buyer
      do
        return ()
```

**Fixed Code:**

```daml
-- GOOD: Auditor is observer only -- can see but not block
template Trade
  with
    buyer : Party
    seller : Party
    auditor : Party
    asset : Text
    price : Decimal
  where
    signatory buyer, seller
    observer auditor  -- read-only access for compliance

    ensure price > 0.0

    choice Settle : ()
      controller buyer
      do
        return ()
```

---

## 2. Privacy & Confidentiality Leaks

DAML's privacy model is built around the principle of **need-to-know**: parties only see contracts they are stakeholders of. But several patterns can inadvertently leak data.

### 2.1 Unnecessary Observers

**Vulnerable Code:**

```daml
-- BAD: All counterparties see all trade details
template PortfolioTrade
  with
    trader : Party
    counterparty : Party
    allCounterparties : [Party]  -- every counterparty in the portfolio
    asset : Text
    quantity : Int
    price : Decimal
  where
    signatory trader, counterparty
    observer allCounterparties  -- LEAK: everyone sees this trade!
```

**What's wrong:**
- Every counterparty in the portfolio can see the details of this specific bilateral trade
- Competitive information (pricing, quantities) is exposed to unrelated parties

**Fixed Code:**

```daml
-- GOOD: Only relevant parties see the trade
template PortfolioTrade
  with
    trader : Party
    counterparty : Party
    regulator : Party
    asset : Text
    quantity : Int
    price : Decimal
  where
    signatory trader, counterparty
    observer regulator  -- only the regulator needs visibility
```

### 2.2 Divulgence via Fetch

When a choice on contract A fetches contract B, the submitting party of the transaction learns the contents of contract B -- even if they are not a stakeholder. This is called **divulgence**.

**Vulnerable Code:**

```daml
template SecretPricing
  with
    dealer : Party
    secretSpread : Decimal
  where
    signatory dealer

template PublicQuote
  with
    dealer : Party
    client : Party
    pricingRef : ContractId SecretPricing
  where
    signatory dealer
    observer client

    -- VULNERABILITY: client exercises this and learns secretSpread!
    choice GetQuote : Decimal
      with
        basePrice : Decimal
      controller client
      do
        pricing <- fetch pricingRef  -- divulges SecretPricing to client
        return (basePrice + pricing.secretSpread)
```

**What's wrong:**
- When `client` exercises `GetQuote`, the `fetch` of `SecretPricing` **divulges** its contents to `client`
- The client learns the dealer's secret spread -- competitive information leak

**Fixed Code:**

```daml
template SecretPricing
  with
    dealer : Party
    secretSpread : Decimal
  where
    signatory dealer

    -- GOOD: dealer calculates the quote internally
    nonconsuming choice CalculateQuote : Decimal
      with
        basePrice : Decimal
      controller dealer  -- only dealer can exercise
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

    choice FulfillQuote : ContractId Quote
      controller dealer  -- dealer exercises, not client
      do
        -- dealer internally fetches their own pricing
        -- client never sees SecretPricing
        let finalPrice = basePrice + 0.05  -- dealer computes off-ledger or via internal choice
        create Quote with
          dealer = dealer
          client = client
          price = finalPrice
          validUntil = "2024-12-31"

template Quote
  with
    dealer : Party
    client : Party
    price : Decimal
    validUntil : Text
  where
    signatory dealer
    observer client
```

### 2.3 Observer Escalation via Choice Chains

**Vulnerable Code:**

```daml
template ConfidentialDeal
  with
    partyA : Party
    partyB : Party
    terms : Text
  where
    signatory partyA, partyB

    -- BAD: allows adding arbitrary observers after creation
    nonconsuming choice ShareWith : ContractId SharedView
      with
        viewer : Party
      controller partyA  -- only partyA needed -- partyB has no say!
      do
        create SharedView with
          owner = partyA
          viewer = viewer
          dealTerms = terms  -- leaks confidential terms

template SharedView
  with
    owner : Party
    viewer : Party
    dealTerms : Text
  where
    signatory owner
    observer viewer
```

**What's wrong:**
- `partyA` can unilaterally share deal terms with anyone
- `partyB` never consented to this disclosure

**Fixed Code:**

```daml
template ConfidentialDeal
  with
    partyA : Party
    partyB : Party
    terms : Text
  where
    signatory partyA, partyB

    -- GOOD: both parties must agree to share
    choice ProposeShare : ContractId ShareProposal
      with
        viewer : Party
      controller partyA
      do
        create ShareProposal with
          proposer = partyA
          approver = partyB
          viewer = viewer
          dealTerms = terms

template ShareProposal
  with
    proposer : Party
    approver : Party
    viewer : Party
    dealTerms : Text
  where
    signatory proposer
    observer approver

    choice ApproveShare : ContractId SharedView
      controller approver  -- partyB must approve
      do
        create SharedView with
          owners = [proposer, approver]
          viewer = viewer
          dealTerms = dealTerms

    choice RejectShare : ()
      controller approver
      do return ()

template SharedView
  with
    owners : [Party]
    viewer : Party
    dealTerms : Text
  where
    signatory owners
    observer viewer
```

### 2.4 Nested Exercise Divulgence Chains

When a choice exercises another choice on a different contract, the submitter can see intermediate results, creating a chain of unintended visibility.

**Vulnerable Code:**

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
      controller client
      do
        -- Exercises a choice on SubAccount, which internally
        -- fetches CreditLimit, which fetches RiskProfile...
        -- Client sees ALL intermediate contracts in the chain!
        exercise subAccountRef (AllocateFunds asset qty)

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
        credit <- fetch creditRef  -- divulged to original submitter (client)!
        assert (credit.limit >= qty)
        create TradeConfirmation with ..
```

**What's wrong:**
- `client` exercises `ExecuteTrade`, which calls `AllocateFunds`, which fetches `CreditLimit`
- The entire chain divulges `CreditLimit` contents to `client` -- they learn the broker's internal credit parameters

**Fixed Code:**

```daml
-- GOOD: Break the chain -- broker handles internal lookups in a separate transaction
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
        -- Client only creates a request -- no internal fetches exposed
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

    -- Broker processes internally -- client sees nothing
    choice ProcessRequest : ContractId TradeConfirmation
      controller broker
      do
        -- Broker's internal lookups happen here, controlled by broker
        -- Client is not the submitter, so no divulgence
        create TradeConfirmation with
          broker = broker
          client = client
          asset = asset
          qty = qty
```

### 2.5 Monolithic Contracts Leaking Unrelated Data

**Vulnerable Code:**

```daml
-- BAD: One giant contract holds everything
template CustomerRecord
  with
    bank : Party
    customer : Party
    auditor : Party
    -- Public info
    name : Text
    accountType : Text
    -- Sensitive info visible to auditor unnecessarily
    ssn : Text
    internalCreditScore : Int
    amlRiskFlag : Bool
  where
    signatory bank, customer
    observer auditor  -- auditor sees SSN, credit score, AML flags!
```

**Fixed Code:**

```daml
-- GOOD: Separate contracts by sensitivity level
template CustomerPublicProfile
  with
    bank : Party
    customer : Party
    auditor : Party
    name : Text
    accountType : Text
  where
    signatory bank, customer
    observer auditor  -- auditor sees only public info

template CustomerSensitiveData
  with
    bank : Party
    customer : Party
    ssn : Text
    internalCreditScore : Int
  where
    signatory bank, customer
    -- No observer -- only bank and customer can see

template CustomerComplianceData
  with
    bank : Party
    customer : Party
    complianceOfficer : Party
    amlRiskFlag : Bool
  where
    signatory bank, customer
    observer complianceOfficer  -- only compliance sees AML data
```

---

## 3. Double Spend & Contention Issues

DAML uses a **consuming** model: when a choice is exercised on a contract, that contract is archived (consumed). This prevents double-spend but introduces contention patterns.

### 3.1 Missing Archival (Replay/Reuse)

**Vulnerable Code:**

```daml
template PaymentVoucher
  with
    issuer : Party
    beneficiary : Party
    amount : Decimal
  where
    signatory issuer
    observer beneficiary

    -- BAD: nonconsuming choice -- voucher can be redeemed unlimited times!
    nonconsuming choice Redeem : ContractId Payment
      controller beneficiary
      do
        create Payment with
          from = issuer
          to = beneficiary
          amount = amount

template Payment
  with
    from : Party
    to : Party
    amount : Decimal
  where
    signatory from
```

**What's wrong:**
- `Redeem` is `nonconsuming` -- the voucher is never archived
- Beneficiary can call `Redeem` unlimited times, creating infinite payments

**Fixed Code:**

```daml
template PaymentVoucher
  with
    issuer : Party
    beneficiary : Party
    amount : Decimal
  where
    signatory issuer
    observer beneficiary

    ensure amount > 0.0

    -- GOOD: consuming choice -- voucher is archived after single use
    choice Redeem : ContractId Payment
      controller beneficiary
      do
        create Payment with
          from = issuer
          to = beneficiary
          amount = amount

template Payment
  with
    from : Party
    to : Party
    amount : Decimal
  where
    signatory from
    observer to
```

### 3.2 Contention on Hot Contracts

When multiple parties need to update the same contract simultaneously, consuming choices create bottlenecks.

**Vulnerable Pattern:**

```daml
-- BAD: Single contract for global state -- massive contention
template GlobalOrderBook
  with
    exchange : Party
    orders : [(Party, Text, Decimal)]  -- all orders in one contract
  where
    signatory exchange

    choice AddOrder : ContractId GlobalOrderBook
      with
        trader : Party
        asset : Text
        price : Decimal
      controller exchange
      do
        -- Every order update consumes and recreates this contract
        -- Only one transaction can succeed at a time!
        create this with orders = (trader, asset, price) :: orders
```

**Fixed Code:**

```daml
-- GOOD: Each order is its own contract -- no contention
template Order
  with
    exchange : Party
    trader : Party
    asset : Text
    price : Decimal
    quantity : Int
    status : Text
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

---

## 4. Arithmetic & Logic Bugs

### 4.1 Unchecked Arithmetic

DAML's `Int` is a 64-bit signed integer. `Decimal` has fixed precision (10 decimal places). Neither has automatic overflow protection.

**Vulnerable Code:**

```daml
template TokenBalance
  with
    issuer : Party
    owner : Party
    balance : Int
  where
    signatory issuer, owner

    choice Mint : ContractId TokenBalance
      with
        additionalTokens : Int
      controller issuer
      do
        -- BAD: no overflow check, no upper bound
        -- additionalTokens could be negative (burning without consent)
        -- balance + additionalTokens could overflow
        create this with balance = balance + additionalTokens

    choice Transfer : (ContractId TokenBalance, ContractId TokenBalance)
      with
        recipient : Party
        transferAmount : Int
      controller owner
      do
        -- BAD: only checks sufficient balance, not negative transfer
        assert (transferAmount <= balance)
        sender <- create this with balance = balance - transferAmount
        receiver <- create TokenBalance with
          issuer = issuer
          owner = recipient
          balance = transferAmount
        return (sender, receiver)
```

**What's wrong:**
- `Mint`: `additionalTokens` could be negative, effectively burning tokens
- `Mint`: no maximum supply enforcement
- `Transfer`: `transferAmount` could be zero or negative -- negative transfer creates tokens from nothing
- No `ensure` on the template itself

**Fixed Code:**

```daml
template TokenBalance
  with
    issuer : Party
    owner : Party
    balance : Int
    maxSupply : Int
  where
    signatory issuer, owner

    ensure balance >= 0
      && balance <= maxSupply
      && maxSupply > 0

    choice Mint : ContractId TokenBalance
      with
        additionalTokens : Int
      controller issuer
      do
        assert (additionalTokens > 0)
        let newBalance = balance + additionalTokens
        assert (newBalance <= maxSupply)
        assert (newBalance > balance)  -- overflow check
        create this with balance = newBalance

    choice Transfer : (ContractId TokenBalance, ContractId TokenBalance)
      with
        recipient : Party
        transferAmount : Int
      controller owner
      do
        assert (transferAmount > 0)
        assert (transferAmount <= balance)
        sender <- create this with balance = balance - transferAmount
        receiver <- create TokenBalance with
          issuer = issuer
          owner = recipient
          balance = transferAmount
          maxSupply = maxSupply
        return (sender, receiver)
```

### 4.2 Decimal Precision Loss

**Vulnerable Code:**

```daml
-- BAD: Repeated division accumulates rounding errors
template FeeCalculator
  with
    operator : Party
    totalAmount : Decimal
  where
    signatory operator

    nonconsuming choice CalculateMultiTierFee : Decimal
      controller operator
      do
        -- Each division loses precision
        let tier1 = totalAmount / 3.0
        let tier2 = tier1 / 7.0
        let tier3 = tier2 / 11.0
        let fee = tier1 + tier2 + tier3
        return fee  -- accumulated rounding error
```

**Fixed Code:**

```daml
-- GOOD: Minimize divisions, use multiplication where possible
template FeeCalculator
  with
    operator : Party
    totalAmount : Decimal
  where
    signatory operator

    nonconsuming choice CalculateMultiTierFee : Decimal
      controller operator
      do
        -- Single division at the end
        let fee = totalAmount * (1.0/3.0 + 1.0/21.0 + 1.0/231.0)
        return fee
```

---

## 5. Time Manipulation

DAML provides `getTime` to access ledger time. On Canton, ledger time has a **skew tolerance** -- the sequencer accepts transactions within a time window. This can be exploited.

### 5.1 Time-Dependent Logic Without Bounds

**Vulnerable Code:**

```daml
template TimedAuction
  with
    seller : Party
    highestBidder : Party
    highestBid : Decimal
    deadline : Time
  where
    signatory seller
    observer highestBidder

    choice Bid : ContractId TimedAuction
      with
        bidder : Party
        bidAmount : Decimal
      controller bidder
      do
        now <- getTime
        -- BAD: exact time comparison is unreliable due to ledger time skew
        assert (now < deadline)
        assert (bidAmount > highestBid)
        create this with
          highestBidder = bidder
          highestBid = bidAmount

    choice Close : ContractId AuctionResult
      controller seller
      do
        now <- getTime
        -- BAD: a participant could submit this slightly before deadline
        -- due to time skew, it could be accepted
        assert (now >= deadline)
        create AuctionResult with
          seller = seller
          winner = highestBidder
          finalPrice = highestBid

template AuctionResult
  with
    seller : Party
    winner : Party
    finalPrice : Decimal
  where
    signatory seller
    observer winner
```

**What's wrong:**
- Exact time comparisons (`now < deadline`) are unreliable -- ledger time skew (typically 1-2 minutes on Canton) means transactions could be accepted slightly before or after the intended boundary
- A participant could close the auction slightly early or bid slightly after deadline

**Fixed Code:**

```daml
template TimedAuction
  with
    seller : Party
    highestBidder : Party
    highestBid : Decimal
    deadline : Time
    gracePeriod : RelTime  -- buffer for time skew
  where
    signatory seller
    observer highestBidder

    ensure highestBid >= 0.0

    choice Bid : ContractId TimedAuction
      with
        bidder : Party
        bidAmount : Decimal
      controller bidder
      do
        now <- getTime
        -- GOOD: grace period accounts for time skew
        assert (addRelTime now gracePeriod < deadline)
        assert (bidAmount > highestBid)
        assert (bidAmount > 0.0)
        create this with
          highestBidder = bidder
          highestBid = bidAmount

    choice Close : ContractId AuctionResult
      controller seller
      do
        now <- getTime
        -- GOOD: only closeable well after deadline
        assert (now >= addRelTime deadline gracePeriod)
        create AuctionResult with
          seller = seller
          winner = highestBidder
          finalPrice = highestBid

template AuctionResult
  with
    seller : Party
    winner : Party
    finalPrice : Decimal
  where
    signatory seller
    observer winner
```

### 5.2 Deadline Bypass via Delayed Exercise

**Vulnerable Code:**

```daml
template ServiceAgreement
  with
    provider : Party
    client : Party
    fee : Decimal
    expiryDate : Time
  where
    signatory provider, client

    -- BAD: No time check -- client can exercise after contract "expired"
    choice RenewAtOldRate : ContractId ServiceAgreement
      with
        newExpiry : Time
      controller client
      do
        -- Missing: assert (now < expiryDate)
        -- Client can renew at the old (cheaper) rate forever
        create this with expiryDate = newExpiry
```

**What's wrong:**
- No time check in `RenewAtOldRate` -- the client can renew at the old fee rate long after expiry
- Provider cannot increase fees because client keeps renewing the same contract

**Fixed Code:**

```daml
template ServiceAgreement
  with
    provider : Party
    client : Party
    fee : Decimal
    expiryDate : Time
    gracePeriod : RelTime
  where
    signatory provider, client

    ensure fee > 0.0

    choice RenewAtOldRate : ContractId ServiceAgreement
      with
        newExpiry : Time
      controller client
      do
        now <- getTime
        -- GOOD: Can only renew before expiry + grace period
        assert (now <= addRelTime expiryDate gracePeriod)
        assert (newExpiry > expiryDate)
        create this with expiryDate = newExpiry

    -- Provider can expire and offer new terms after deadline
    choice Expire : ContractId ExpiredAgreement
      controller provider
      do
        now <- getTime
        assert (now > addRelTime expiryDate gracePeriod)
        create ExpiredAgreement with
          provider = provider
          client = client
          previousFee = fee
```

### 5.3 Multi-Step TOCTOU Across Transactions

**Vulnerable Code:**

```daml
-- Step 1: Client checks price (Transaction 1)
-- Step 2: Client submits order at that price (Transaction 2)
-- Between steps, the price could have changed!

template PriceOracle
  with
    operator : Party
    asset : Text
    price : Decimal
  where
    signatory operator
    key (operator, asset) : (Party, Text)
    maintainer key._1

template OrderSubmission
  with
    exchange : Party
    trader : Party
  where
    signatory exchange
    observer trader

    -- BAD: trader reads price off-ledger then submits with assumed price
    choice SubmitOrder : ContractId Order
      with
        asset : Text
        quantity : Int
        expectedPrice : Decimal  -- price trader saw in a PREVIOUS transaction
      controller trader
      do
        -- Price may have changed between when trader checked and now!
        (_, oracle) <- fetchByKey @PriceOracle (exchange, asset)
        -- BAD: only warns but doesn't prevent stale price execution
        create Order with
          exchange = exchange
          trader = trader
          asset = asset
          quantity = quantity
          executionPrice = oracle.price  -- could be very different from expectedPrice
```

**Fixed Code:**

```daml
template OrderSubmission
  with
    exchange : Party
    trader : Party
  where
    signatory exchange
    observer trader

    -- GOOD: Atomic price check + order in single transaction with slippage tolerance
    choice SubmitOrder : ContractId Order
      with
        asset : Text
        quantity : Int
        expectedPrice : Decimal
        maxSlippage : Decimal  -- e.g., 0.02 for 2%
      controller trader
      do
        (_, oracle) <- fetchByKey @PriceOracle (exchange, asset)
        let priceDiff = abs (oracle.price - expectedPrice) / expectedPrice
        -- Reject if price moved too much
        assert (priceDiff <= maxSlippage)
        create Order with
          exchange = exchange
          trader = trader
          asset = asset
          quantity = quantity
          executionPrice = oracle.price
```

---

## 6. Contract Key Integrity Issues

Contract keys provide a way to look up contracts without knowing their contract ID. But they introduce their own class of bugs.

### 6.1 TOCTOU (Time-of-Check-Time-of-Use) with `lookupByKey`

**Vulnerable Code:**

```daml
template Wallet
  with
    bank : Party
    owner : Party
    balance : Decimal
  where
    signatory bank, owner
    key (bank, owner) : (Party, Party)
    maintainer key._1

    ensure balance >= 0.0

template PaymentProcessor
  with
    bank : Party
  where
    signatory bank

    nonconsuming choice ProcessPayment : ()
      with
        payer : Party
        amount : Decimal
      controller bank
      do
        -- BAD: TOCTOU -- wallet state could change between lookup and fetch
        walletKeyOpt <- lookupByKey @Wallet (bank, payer)
        case walletKeyOpt of
          None -> abort "No wallet found"
          Some walletCid -> do
            wallet <- fetch walletCid
            -- By the time we fetch, another transaction may have
            -- already consumed this contract!
            assert (wallet.balance >= amount)
            -- This exercise will fail if the contract was consumed
            exercise walletCid Archive
            create Wallet with
              bank = bank
              owner = payer
              balance = wallet.balance - amount
            return ()
```

**Fixed Code:**

```daml
template Wallet
  with
    bank : Party
    owner : Party
    balance : Decimal
  where
    signatory bank, owner
    key (bank, owner) : (Party, Party)
    maintainer key._1

    ensure balance >= 0.0

    -- GOOD: Put the debit logic on the Wallet itself
    choice Debit : ContractId Wallet
      with
        amount : Decimal
      controller bank
      do
        assert (amount > 0.0)
        assert (balance >= amount)
        create this with balance = balance - amount

template PaymentProcessor
  with
    bank : Party
  where
    signatory bank

    nonconsuming choice ProcessPayment : ()
      with
        payer : Party
        amount : Decimal
      controller bank
      do
        -- GOOD: exerciseByKey is atomic -- no TOCTOU gap
        exerciseByKey @Wallet (bank, payer) (Debit amount)
        return ()
```

### 6.2 Key Collision / Squatting

**Vulnerable Code:**

```daml
-- BAD: User-controlled key component allows squatting
template UserProfile
  with
    platform : Party
    user : Party
    username : Text  -- user picks their own username
    email : Text
  where
    signatory platform, user
    key (platform, username) : (Party, Text)  -- user-chosen key!
    maintainer key._1
```

**What's wrong:**
- A malicious user could register a username like "admin" or squat on usernames
- No validation on username format
- Once a key exists, no one else can create a contract with the same key

**Fixed Code:**

```daml
-- GOOD: Platform controls key assignment with validation
template UserProfile
  with
    platform : Party
    user : Party
    username : Text
    email : Text
  where
    signatory platform, user
    key (platform, user) : (Party, Party)  -- keyed by party, not user input
    maintainer key._1

    ensure DA.Text.length username >= 3
      && DA.Text.length username <= 30
```

---

## 7. Choice & Workflow Logic

Choices that accept contract IDs without validation, or workflows that allow steps to be skipped or reordered, are a major source of bugs.

### 7.1 Unvalidated Contract ID Arguments

**Vulnerable Code:**

```daml
template Settlement
  with
    exchange : Party
    buyer : Party
    seller : Party
  where
    signatory exchange
    observer buyer, seller

    -- BAD: Accepts any ContractId without verifying it belongs to this trade
    choice Settle : ()
      with
        paymentCid : ContractId Payment
        deliveryCid : ContractId Delivery
      controller exchange
      do
        payment <- fetch paymentCid
        delivery <- fetch deliveryCid
        -- No check that payment.buyer == buyer or delivery.seller == seller
        -- Exchange could use a payment from a DIFFERENT trade!
        archive paymentCid
        archive deliveryCid
        return ()
```

**What's wrong:**
- `paymentCid` and `deliveryCid` are blindly trusted -- no validation that they belong to this specific trade
- An exchange could settle using payment from trade A and delivery from trade B, mismatching counterparties

**Fixed Code:**

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
        -- GOOD: Validate fetched contracts match this trade
        assert (payment.payer == buyer)
        assert (payment.tradeRef == tradeId)
        assert (delivery.deliverer == seller)
        assert (delivery.tradeRef == tradeId)
        archive paymentCid
        archive deliveryCid
        return ()
```

### 7.2 Multi-Step Workflow Without Intermediate Authorization

**Vulnerable Code:**

```daml
-- A loan approval workflow where steps can be bypassed
template LoanApplication
  with
    applicant : Party
    bank : Party
    amount : Decimal
    status : Text  -- "submitted" | "reviewed" | "approved" | "disbursed"
  where
    signatory bank, applicant

    -- BAD: No enforcement of step ordering!
    choice UpdateStatus : ContractId LoanApplication
      with
        newStatus : Text
      controller bank
      do
        -- Bank can jump directly from "submitted" to "disbursed"
        -- skipping review and approval entirely!
        create this with status = newStatus
```

**Fixed Code:**

```daml
-- GOOD: Each state is a separate template -- impossible to skip steps
template LoanSubmitted
  with
    applicant : Party
    bank : Party
    reviewer : Party
    amount : Decimal
  where
    signatory applicant
    observer bank, reviewer

    ensure amount > 0.0

    choice Review : ContractId LoanReviewed
      controller reviewer
      do
        create LoanReviewed with
          applicant = applicant
          bank = bank
          reviewer = reviewer
          amount = amount

    choice Reject : ()
      controller reviewer
      do return ()

template LoanReviewed
  with
    applicant : Party
    bank : Party
    reviewer : Party
    amount : Decimal
  where
    signatory applicant, reviewer
    observer bank

    choice Approve : ContractId LoanApproved
      controller bank
      do
        create LoanApproved with
          applicant = applicant
          bank = bank
          amount = amount

    choice SendBack : ContractId LoanSubmitted
      controller bank
      do
        create LoanSubmitted with ..

template LoanApproved
  with
    applicant : Party
    bank : Party
    amount : Decimal
  where
    signatory applicant, bank

    choice Disburse : ContractId LoanDisbursed
      controller bank
      do
        create LoanDisbursed with
          applicant = applicant
          bank = bank
          amount = amount
```

### 7.3 Out-of-Order Workflow Execution

**Vulnerable Code:**

```daml
-- BAD: Steps reference each other by ContractId but don't validate sequence
template WorkflowStep
  with
    operator : Party
    stepNumber : Int
    payload : Text
    completed : Bool
  where
    signatory operator

    nonconsuming choice Complete : ContractId WorkflowStep
      with
        previousStepCid : Optional (ContractId WorkflowStep)
      controller operator
      do
        -- BAD: never checks that previousStepCid is actually step N-1
        -- or that it's completed
        create this with completed = True
```

**Fixed Code:**

```daml
-- GOOD: Each step explicitly requires the output of the previous step
template WorkflowStep1Complete
  with
    operator : Party
    payload : Text
  where
    signatory operator

template WorkflowStep2
  with
    operator : Party
    payload : Text
  where
    signatory operator

    -- Can ONLY execute if Step 1 output exists
    choice Execute : ContractId WorkflowStep2Complete
      with
        step1Proof : ContractId WorkflowStep1Complete
      controller operator
      do
        step1 <- fetch step1Proof  -- validates Step 1 actually completed
        assert (step1.operator == operator)  -- same workflow
        create WorkflowStep2Complete with
          operator = operator
          payload = payload
```

---

## 8. Contract Lifecycle & Archival

Contracts that can never be cleaned up, propose-accept patterns without timeouts, and delegation chains that accumulate permissions are all lifecycle bugs.

### 8.1 Orphaned Contracts (Can Never Be Archived)

**Vulnerable Code:**

```daml
-- BAD: No way to archive this contract once created
template PermanentRecord
  with
    issuer : Party
    subject : Party
    data : Text
  where
    signatory issuer
    observer subject
    -- No choices at all! This contract lives forever.
    -- It will consume ledger storage indefinitely.
    -- If data becomes incorrect, there's no way to fix it.
```

**What's wrong:**
- No consuming choices -- contract cannot be archived by anyone
- Ledger state grows unboundedly
- Incorrect data cannot be corrected or removed

**Fixed Code:**

```daml
-- GOOD: Always provide an archive/cleanup path
template ManagedRecord
  with
    issuer : Party
    subject : Party
    data : Text
  where
    signatory issuer
    observer subject

    -- Issuer can archive when no longer needed
    choice Revoke : ()
      controller issuer
      do return ()

    -- Subject can request removal (e.g., GDPR right-to-erasure)
    choice RequestRemoval : ContractId RemovalRequest
      controller subject
      do
        create RemovalRequest with
          issuer = issuer
          subject = subject
          recordData = data

    -- Update incorrect data
    choice UpdateRecord : ContractId ManagedRecord
      with
        newData : Text
      controller issuer
      do
        create this with data = newData
```

### 8.2 Propose-Accept Without Timeout/Rejection

**Vulnerable Code:**

```daml
-- BAD: Proposal lives forever if not accepted
template TradeProposal
  with
    proposer : Party
    counterparty : Party
    terms : Text
  where
    signatory proposer
    observer counterparty

    choice Accept : ContractId Trade
      controller counterparty
      do
        create Trade with
          party1 = proposer
          party2 = counterparty
          terms = terms
    -- No Reject choice!
    -- No expiry!
    -- Proposer cannot withdraw!
```

**What's wrong:**
- Counterparty can ignore the proposal -- it stays on ledger forever
- Proposer cannot cancel/withdraw
- No expiry date -- terms may become stale
- No rejection mechanism -- proposer never gets feedback

**Fixed Code:**

```daml
template TradeProposal
  with
    proposer : Party
    counterparty : Party
    terms : Text
    expiresAt : Time
  where
    signatory proposer
    observer counterparty

    ensure expiresAt > datetime 2020 Jan 1 0 0 0

    choice Accept : ContractId Trade
      controller counterparty
      do
        now <- getTime
        assert (now < expiresAt)  -- cannot accept expired proposal
        create Trade with
          party1 = proposer
          party2 = counterparty
          terms = terms

    choice Reject : ()
      controller counterparty
      do return ()  -- explicit rejection, archives the proposal

    choice Withdraw : ()
      controller proposer
      do return ()  -- proposer can cancel

    choice Expire : ()
      controller proposer
      do
        now <- getTime
        assert (now >= expiresAt)  -- can only expire after deadline
        return ()
```

### 8.3 Delegation Chains Accumulating Excessive Permissions

**Vulnerable Code:**

```daml
-- BAD: Unbounded re-delegation
template Delegation
  with
    owner : Party
    delegate : Party
    canRedelegate : Bool
  where
    signatory owner
    observer delegate

    -- Delegate can create further delegations without limit
    choice Redelegate : ContractId Delegation
      with
        newDelegate : Party
      controller delegate
      do
        assert canRedelegate
        -- BAD: new delegate also gets canRedelegate = True!
        -- This creates an unbounded chain of delegations
        create Delegation with
          owner = owner  -- original owner may not even know about newDelegate
          delegate = newDelegate
          canRedelegate = True  -- infinite delegation chain!
```

**Fixed Code:**

```daml
template Delegation
  with
    owner : Party
    delegate : Party
    canRedelegate : Bool
    maxDepth : Int      -- limits delegation chain
    currentDepth : Int
  where
    signatory owner
    observer delegate

    ensure currentDepth >= 0 && currentDepth <= maxDepth

    choice Redelegate : ContractId Delegation
      with
        newDelegate : Party
      controller delegate
      do
        assert canRedelegate
        assert (currentDepth < maxDepth)  -- GOOD: bounded depth
        create Delegation with
          owner = owner
          delegate = newDelegate
          canRedelegate = currentDepth + 1 < maxDepth  -- disable at max
          maxDepth = maxDepth
          currentDepth = currentDepth + 1

    -- Owner can revoke any delegation
    choice Revoke : ()
      controller owner
      do return ()
```

---

## 9. Choice Design Flaws

### 9.1 Non-Consuming When It Should Consume

**Vulnerable Code:**

```daml
template Approval
  with
    manager : Party
    employee : Party
    requestType : Text
  where
    signatory manager
    observer employee

    -- BAD: nonconsuming -- approval can be "used" multiple times
    nonconsuming choice UseApproval : ContractId ActionTaken
      controller employee
      do
        create ActionTaken with
          approvedBy = manager
          actor = employee
          action = requestType
```

**Fixed Code:**

```daml
template Approval
  with
    manager : Party
    employee : Party
    requestType : Text
  where
    signatory manager
    observer employee

    -- GOOD: consuming -- single use
    choice UseApproval : ContractId ActionTaken
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

### 9.2 Unbounded Loops in Choices

**Vulnerable Code:**

```daml
template BatchProcessor
  with
    operator : Party
  where
    signatory operator

    -- BAD: unbounded list could hit transaction size limits
    nonconsuming choice ProcessAll : [ContractId Receipt]
      with
        items : [(Party, Decimal)]  -- could be millions of items!
      controller operator
      do
        mapA (\(party, amount) ->
          create Receipt with
            operator = operator
            beneficiary = party
            amount = amount
          ) items

template Receipt
  with
    operator : Party
    beneficiary : Party
    amount : Decimal
  where
    signatory operator
    observer beneficiary
```

**What's wrong:**
- No limit on `items` list size
- Large lists will exceed Canton's maximum transaction size
- All-or-nothing: if one item fails, the entire batch rolls back

**Fixed Code:**

```daml
template BatchProcessor
  with
    operator : Party
    maxBatchSize : Int
  where
    signatory operator

    ensure maxBatchSize > 0 && maxBatchSize <= 100

    -- GOOD: bounded batch size
    nonconsuming choice ProcessBatch : [ContractId Receipt]
      with
        items : [(Party, Decimal)]
      controller operator
      do
        assert (length items > 0)
        assert (length items <= maxBatchSize)
        mapA (\(party, amount) -> do
          assert (amount > 0.0)
          create Receipt with
            operator = operator
            beneficiary = party
            amount = amount
          ) items

template Receipt
  with
    operator : Party
    beneficiary : Party
    amount : Decimal
  where
    signatory operator
    observer beneficiary
```

---

## 10. Canton / Ledger-Level Issues

These vulnerabilities are specific to Canton's distributed architecture.

### 10.1 Domain Trust Misconfiguration

```
Risk: Connecting a participant to an untrusted domain (sequencer + mediator)

- The SEQUENCER orders transactions -- a malicious sequencer can:
  - Reorder transactions to favor certain parties
  - Delay or drop transactions (censorship)
  - Observe transaction metadata (who submits, when)

- The MEDIATOR validates transactions -- a malicious mediator can:
  - Learn which parties are involved in a transaction
  - See transaction metadata (not payload, which is encrypted)
  - Selectively reject valid transactions

Mitigation:
- Only connect participants to domains with trusted operators
- Use Canton's domain trust configuration to restrict which domains
  a participant will transact on
- Monitor sequencer behavior for anomalies (delays, reordering)
- In multi-domain setups, prefer domains with known SLAs
```

### 10.2 Party Allocation Without Governance

```
Risk: Unrestricted party allocation allows:
- Impersonation (creating party "Bank_of_America" on a test network)
- Resource exhaustion (millions of parties)
- Namespace pollution

Mitigation:
- Use Canton's party management APIs with proper authorization
- Implement a party registration workflow:

  1. Request party allocation via a governance contract
  2. Admin reviews and approves
  3. Party is allocated with a controlled display name
  4. Party-to-participant mapping is recorded on-ledger
```

### 10.3 Sequencer DoS via Transaction Flooding

```
Risk: A participant can flood the sequencer with high volumes of
      transactions (valid or invalid), degrading performance for all.

Mitigation:
- Canton supports rate limiting at the sequencer level
- Configure per-participant submission rate limits
- Use Canton's traffic control (introduced in Canton 2.x):
  - Participants purchase "traffic credits"
  - Each transaction costs credits based on size
  - Prevents unbounded submission
- Monitor participant submission rates and alert on anomalies
```

---

## 11. Upgrade & Migration Risks

### 11.1 Breaking Template Changes

**Vulnerable Approach:**

```daml
-- Version 1: Original template
template Invoice_v1
  with
    issuer : Party
    payer : Party
    amount : Decimal
  where
    signatory issuer
    observer payer

-- Version 2: Added a required field with no migration path!
template Invoice_v2
  with
    issuer : Party
    payer : Party
    amount : Decimal
    currency : Text      -- NEW required field
    dueDate : Time       -- NEW required field
  where
    signatory issuer
    observer payer
```

**What's wrong:**
- Existing `Invoice_v1` contracts on the ledger cannot magically become `Invoice_v2`
- No migration contract exists to transition between versions
- Old and new code may reference different template IDs, causing `fetch` failures

**Fixed Approach:**

```daml
-- GOOD: Upgrade contract pattern
template Invoice
  with
    issuer : Party
    payer : Party
    amount : Decimal
    currency : Optional Text  -- backwards compatible: Optional
    dueDate : Optional Time   -- backwards compatible: Optional
  where
    signatory issuer
    observer payer

-- Migration helper to upgrade old contracts
template InvoiceUpgrade
  with
    issuer : Party
  where
    signatory issuer

    nonconsuming choice UpgradeInvoice : ContractId Invoice
      with
        oldInvoiceCid : ContractId Invoice
        newCurrency : Text
        newDueDate : Time
      controller issuer
      do
        oldInvoice <- fetch oldInvoiceCid
        archive oldInvoiceCid
        create oldInvoice with
          currency = Some newCurrency
          dueDate = Some newDueDate
```

### 11.2 Weak Authorization on Upgrade Choices

**Vulnerable Code:**

```daml
-- BAD: Anyone can trigger an upgrade
template UpgradeableContract
  with
    issuer : Party
    holder : Party
    value : Decimal
    version : Int
  where
    signatory issuer
    observer holder

    -- Only issuer controls the upgrade -- holder has no say!
    choice UpgradeToV2 : ContractId UpgradeableContract
      with
        newValue : Decimal
      controller issuer
      do
        -- BAD: issuer can unilaterally change value during "upgrade"
        create this with
          value = newValue  -- silently changes holder's value!
          version = 2
```

**What's wrong:**
- Issuer can unilaterally upgrade and change `value` during the process
- Holder never consents to the upgrade or the new terms
- "Upgrade" becomes a backdoor to modify contract state

**Fixed Code:**

```daml
template UpgradeableContract
  with
    issuer : Party
    holder : Party
    value : Decimal
    version : Int
  where
    signatory issuer, holder  -- both must agree

    choice ProposeUpgrade : ContractId UpgradeProposal
      controller issuer
      do
        create UpgradeProposal with
          issuer = issuer
          holder = holder
          currentValue = value
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

    -- GOOD: Holder must explicitly accept -- value is preserved
    choice AcceptUpgrade : ContractId UpgradeableContract
      controller holder
      do
        create UpgradeableContract with
          issuer = issuer
          holder = holder
          value = currentValue  -- value preserved, not changed
          version = proposedVersion

    choice RejectUpgrade : ()
      controller holder
      do return ()
```

### 11.3 Package ID Reference Issues

```
When DAML code is compiled, each package gets a unique hash-based ID.
Changing ANY code in a package changes its ID.

Risks:
- Hardcoded package references break after recompilation
- Templates with the same name in different packages are DIFFERENT types
- Cross-package fetches fail if the wrong package version is deployed

Mitigation:
- Use Canton's package management to track deployed versions
- Test upgrades on a sandbox before deploying to production
- Use DAML's built-in upgrade mechanism (DAML 2.x+)
- Never reference package IDs directly in application code
- Maintain a package dependency map and test all paths during upgrades
```

---

## 12. Ledger API Security

The Ledger API is the gateway between off-chain applications and the DAML ledger. Misconfigurations here bypass all on-ledger protections.

### 12.1 Unauthenticated or Weakly Authenticated API Access

```
Risk: The Ledger API (gRPC and JSON API) without proper authentication
      allows anyone with network access to submit transactions.

Vulnerable Configuration:
- Running JSON API without TLS (plaintext gRPC)
- Using static/shared API tokens instead of per-user JWTs
- No mutual TLS (mTLS) between participants and the API

Mitigation:
- Always enable TLS for gRPC and JSON API endpoints
- Use JWT tokens with proper claims (actAs, readAs party restrictions)
- Enable mTLS for service-to-service communication
- Never expose the Ledger API directly to the internet
```

### 12.2 Overly Permissive JWT Claims

```
Vulnerable JWT payload:
{
  "ledgerId": "my-ledger",
  "applicationId": "my-app",
  "actAs": ["Alice", "Bob", "Admin"],    // TOO BROAD -- one token for all parties
  "readAs": ["Alice", "Bob", "Admin"],
  "admin": true                           // DANGEROUS -- grants admin functions
}

Risks:
- A compromised token grants access to ALL parties
- "admin": true exposes party allocation, package upload, pruning
- No token rotation or expiry

Fixed JWT payload:
{
  "ledgerId": "my-ledger",
  "applicationId": "alice-frontend",
  "actAs": ["Alice"],                     // GOOD: single party per token
  "readAs": ["Alice"],
  "admin": false,                         // GOOD: no admin access
  "exp": 1735689600                       // GOOD: token expires
}

Best Practices:
- Issue per-party, per-application tokens with minimal claims
- Set short expiry times (15-60 minutes) with refresh token rotation
- Never include "admin": true in application tokens
- Use an OAuth2/OIDC provider (e.g., Auth0, Keycloak) for token management
- Log and monitor all admin API calls
```

### 12.3 API Endpoints Exposing Admin Functions

```
Canton admin endpoints that should be restricted:
- Package upload (participants.upload_dar_file)
- Party allocation (participants.allocate)
- Ledger pruning (participants.prune)
- Domain connection management (domains.connect/disconnect)
- Key management (keys.*)

Mitigation:
- Separate admin API port from ledger API port
- Bind admin API to localhost only (not 0.0.0.0)
- Use network policies/firewalls to restrict admin API access
- Require separate, short-lived admin tokens
- Audit log all admin operations
```

---

## 13. Trigger & Automation Risks

DAML Triggers are background processes that react to ledger events. They run off-ledger but submit transactions, making them a unique attack surface.

### 13.1 Unbounded Retry Logic (Resource Exhaustion)

**Vulnerable Trigger:**

```daml
-- BAD: Trigger retries indefinitely on failure
myTrigger : Trigger ()
myTrigger = Trigger
  { initialize = pure ()
  , updateState = \_ -> pure ()
  , rule = retryRule
  , registeredTemplates = RegisteredTemplates [registeredTemplate @Invoice]
  , heartbeat = Some (seconds 5)
  }

retryRule : Party -> TriggerA () ()
retryRule party = do
  invoices <- query @Invoice
  forA_ invoices \(cid, invoice) -> do
    -- BAD: If processInvoice keeps failing (e.g., contract archived
    -- by someone else), this retries every 5 seconds forever,
    -- flooding the ledger with failed commands
    dedupExercise cid ProcessInvoice
```

**What's wrong:**
- If `ProcessInvoice` fails (contract already archived, assertion failure), the trigger retries every heartbeat
- Failed commands pile up, consuming sequencer resources
- No backoff, no failure limit, no dead-letter handling

**Fixed Trigger:**

```daml
-- GOOD: Track failures and stop retrying
myTrigger : Trigger (Map (ContractId Invoice) Int)
myTrigger = Trigger
  { initialize = pure Map.empty  -- track retry counts
  , updateState = \_ -> pure ()
  , rule = boundedRetryRule
  , registeredTemplates = RegisteredTemplates [registeredTemplate @Invoice]
  , heartbeat = Some (seconds 30)  -- longer heartbeat
  }

boundedRetryRule : Party -> TriggerA (Map (ContractId Invoice) Int) ()
boundedRetryRule party = do
  failureMap <- get
  invoices <- query @Invoice
  forA_ invoices \(cid, invoice) -> do
    let retryCount = Map.findWithDefault 0 cid failureMap
    when (retryCount < 3) $ do  -- GOOD: max 3 retries
      dedupExercise cid ProcessInvoice
      -- Increment retry count (reset on success via ACS change)
      modify (Map.insert cid (retryCount + 1))
```

### 13.2 Triggers Reacting to Adversary-Controlled Contracts

**Vulnerable Trigger:**

```daml
-- BAD: Trigger auto-accepts ANY incoming proposal
autoAcceptRule : Party -> TriggerA () ()
autoAcceptRule party = do
  proposals <- query @TradeProposal
  forA_ proposals \(cid, proposal) -> do
    when (proposal.counterparty == party) $ do
      -- DANGER: Automatically accepts ALL proposals!
      -- An attacker can create proposals with any terms
      dedupExercise cid Accept
```

**What's wrong:**
- Attacker creates `TradeProposal` with extreme terms (e.g., price = 0.01)
- Trigger blindly accepts without checking terms
- Automated = instant exploitation, no human in the loop

**Fixed Trigger:**

```daml
-- GOOD: Validate before auto-accepting
autoAcceptRule : Party -> TriggerA () ()
autoAcceptRule party = do
  proposals <- query @TradeProposal
  forA_ proposals \(cid, proposal) -> do
    when (proposal.counterparty == party) $ do
      -- GOOD: Only auto-accept proposals that meet criteria
      let termsValid = proposal.price >= minAcceptablePrice
                    && proposal.quantity <= maxAutoAcceptQty
                    && proposal.proposer `elem` trustedCounterparties
      if termsValid
        then dedupExercise cid Accept
        else do
          -- Flag for manual review instead of auto-rejecting
          debug ("Manual review needed for proposal from " <> show proposal.proposer)
```

### 13.3 Missing Idempotency Leading to Duplicate Actions

**Vulnerable Trigger:**

```daml
-- BAD: Trigger creates duplicate payment for the same invoice
paymentRule : Party -> TriggerA () ()
paymentRule party = do
  invoices <- query @Invoice
  forA_ invoices \(cid, invoice) -> do
    when (invoice.status == "approved") $ do
      -- If this command fails and retries, or if the trigger restarts,
      -- it will create ANOTHER payment for the same invoice
      dedupCreate Payment with
        payer = party
        amount = invoice.amount
        invoiceRef = invoice.invoiceId
```

**What's wrong:**
- If the trigger restarts between creating `Payment` and the `Invoice` being updated, it creates a duplicate payment
- `dedupCreate` only deduplicates within a single trigger instance lifetime

**Fixed Trigger:**

```daml
-- GOOD: Check for existing payment before creating
paymentRule : Party -> TriggerA () ()
paymentRule party = do
  invoices <- query @Invoice
  payments <- query @Payment
  let paidInvoiceIds = map (\(_, p) -> p.invoiceRef) payments
  forA_ invoices \(cid, invoice) -> do
    when (invoice.status == "approved"
          && invoice.invoiceId `notElem` paidInvoiceIds) $ do  -- GOOD: idempotency check
      dedupCreate Payment with
        payer = party
        amount = invoice.amount
        invoiceRef = invoice.invoiceId
```

---

## 14. Off-Ledger Integration

DAML ledgers interact with external systems (databases, APIs, oracles). The boundary between on-ledger and off-ledger is where many security assumptions break down.

### 14.1 Oracle / External Data Feed Manipulation

**Vulnerable Code:**

```daml
-- BAD: Oracle contract with no validation or staleness check
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

    -- Any operator-signed update is trusted
    choice UpdatePrice : ContractId PriceOracle
      with
        newPrice : Decimal
      controller operator
      do
        -- BAD: No bounds check -- operator (or compromised key) can set any price
        -- BAD: No staleness check -- price could be hours old
        create this with
          price = newPrice
          lastUpdated = lastUpdated  -- BUG: timestamp not updated!

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
        -- BAD: No staleness check on consumer side either
        -- If oracle hasn't been updated in hours, this uses stale data
        create Decision with
          user = user
          asset = asset
          priceUsed = oracle.price
```

**Fixed Code:**

```daml
template PriceOracle
  with
    operator : Party
    asset : Text
    price : Decimal
    lastUpdated : Time
    maxDeviation : Decimal   -- max allowed price change per update (e.g., 0.10 = 10%)
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
        -- GOOD: Circuit breaker -- reject extreme price movements
        let deviation = abs (newPrice - price) / price
        assert (deviation <= maxDeviation)
        create this with
          price = newPrice
          lastUpdated = now  -- GOOD: actually update the timestamp

template OracleConsumer
  with
    user : Party
    oracleOperator : Party
    maxStaleness : RelTime  -- e.g., 5 minutes
  where
    signatory user

    choice MakeDecision : ContractId Decision
      with
        asset : Text
      controller user
      do
        now <- getTime
        (_, oracle) <- fetchByKey @PriceOracle (oracleOperator, asset)
        -- GOOD: Reject stale oracle data
        assert (addRelTime oracle.lastUpdated maxStaleness >= now)
        create Decision with
          user = user
          asset = asset
          priceUsed = oracle.price
```

### 14.2 Missing Validation of Off-Ledger Data

**Vulnerable Code:**

```daml
-- BAD: External system result is blindly committed on-ledger
template ExternalVerification
  with
    operator : Party
    subject : Party
  where
    signatory operator
    observer subject

    -- Operator submits result from external KYC provider
    choice SubmitKycResult : ContractId KycVerified
      with
        status : Text       -- "pass" or "fail" -- but no validation!
        score : Int          -- risk score from external system
        rawResponse : Text   -- entire API response dumped on-ledger
      controller operator
      do
        -- BAD: No validation of status values
        -- BAD: rawResponse may contain PII that shouldn't be on-ledger
        -- BAD: score has no bounds
        create KycVerified with
          operator = operator
          subject = subject
          kycStatus = status
          riskScore = score
          externalData = rawResponse  -- PII ON LEDGER!
```

**Fixed Code:**

```daml
data KycStatus = Pass | Fail | NeedsReview
  deriving (Eq, Show)

template ExternalVerification
  with
    operator : Party
    subject : Party
  where
    signatory operator
    observer subject

    choice SubmitKycResult : ContractId KycVerified
      with
        status : KycStatus   -- GOOD: enum, not free-text
        score : Int
        externalRefId : Text  -- GOOD: just a reference ID, not raw data
      controller operator
      do
        -- GOOD: Validate all external data
        assert (score >= 0 && score <= 100)
        assert (DA.Text.length externalRefId > 0)
        assert (DA.Text.length externalRefId <= 64)
        create KycVerified with
          operator = operator
          subject = subject
          kycStatus = status
          riskScore = score
          externalRef = externalRefId  -- reference only, no PII on-ledger
```

### 14.3 Race Conditions Between Off-Ledger and On-Ledger State

```
Scenario: An off-ledger payment system and the DAML ledger must stay in sync.

VULNERABLE FLOW:
1. Off-ledger: Check user has $100 in bank API         (T=0)
2. On-ledger:  Create PaymentConfirmation contract      (T=1)
3. Off-ledger: Debit $100 from bank API                 (T=2)

Problem: Between steps 1 and 3, the user could:
- Spend the $100 via another channel (mobile app, ATM)
- Submit another on-ledger payment that also passes step 1
- Result: Two PaymentConfirmation contracts but only $100 in the account

FIXED FLOW:
1. Off-ledger: Place HOLD on $100 via bank API          (T=0)
   - Returns holdId (idempotency token)
2. On-ledger:  Create PaymentConfirmation with holdId    (T=1)
   - holdId ensures 1:1 mapping between off-ledger hold and on-ledger contract
3. Off-ledger: Capture held funds using holdId           (T=2)
   - If step 2 fails, release the hold
   - If step 3 fails, archive the on-ledger contract

Key Principles:
- Use idempotency tokens to link off-ledger and on-ledger state
- Place holds/reserves before committing on-ledger
- Implement compensation logic (saga pattern) for failures
- Never assume off-ledger state matches on-ledger state
- Log the holdId/reference on both sides for reconciliation
```

---

## 15. Workshop Exercises

### Exercise 1: Find the Bug -- Authorization

```daml
-- Can you spot the authorization vulnerability?
template Escrow
  with
    payer : Party
    payee : Party
    amount : Decimal
  where
    signatory payer
    observer payee

    choice Release : ()
      controller payer
      do return ()

    choice Claim : ContractId Payment
      controller payee
      do
        create Payment with
          from = payer
          to = payee
          amount = amount

    -- What's wrong with this choice?
    choice Refund : ()
      controller payee  -- HINT: should the payee control refunds?
      do return ()
```

<details>
<summary>Answer</summary>

The `Refund` choice is controlled by `payee` -- the person receiving money can trigger a refund (archiving the escrow and preventing the payer from getting their money back). It should be controlled by `payer` or require both parties.

Additionally, `Claim` has no time lock or condition -- `payee` can claim immediately.

</details>

### Exercise 2: Find the Bug -- Privacy

```daml
template SalaryRecord
  with
    company : Party
    employee : Party
    hrDepartment : Party
    salary : Decimal
    allEmployees : [Party]
  where
    signatory company
    observer allEmployees  -- Why is this a problem?
```

<details>
<summary>Answer</summary>

Every employee can see every other employee's salary! The `observer allEmployees` makes all salary records visible to all employees. Only the specific `employee` and `hrDepartment` should be observers.

</details>

### Exercise 3: Find the Bug -- Double Spend

```daml
template GiftCard
  with
    store : Party
    holder : Party
    balance : Decimal
  where
    signatory store
    observer holder

    nonconsuming choice MakePurchase : ContractId GiftCard
      with
        purchaseAmount : Decimal
      controller holder
      do
        assert (purchaseAmount <= balance)
        create this with balance = balance - purchaseAmount
```

<details>
<summary>Answer</summary>

`MakePurchase` is `nonconsuming` -- the original gift card is never archived. The holder can make unlimited purchases because each call reads the same original balance. It should be a consuming choice.

Also, there is no check that `purchaseAmount > 0`, so negative purchases could increase the balance.

</details>

### Exercise 4: Fix This Template

```daml
-- Fix all the issues you can find
template SimpleToken
  with
    issuer : Party
    owner : Party
    amount : Int
  where
    signatory issuer

    choice Transfer : ContractId SimpleToken
      with
        newOwner : Party
        transferAmount : Int
      controller issuer
      do
        create SimpleToken with
          issuer = issuer
          owner = newOwner
          amount = transferAmount
```

<details>
<summary>Answer</summary>

Issues:
1. `owner` is not a signatory -- issuer has full control over owner's tokens
2. `Transfer` is controlled by `issuer`, not `owner`
3. No `ensure` clause -- `amount` could be negative or zero
4. No validation on `transferAmount`
5. Original token's remaining balance is lost (no remainder contract)
6. `owner` is not even an observer -- they can't see their own tokens!

Fixed version:

```daml
template SimpleToken
  with
    issuer : Party
    owner : Party
    amount : Int
  where
    signatory issuer, owner
    ensure amount > 0

    choice Transfer : (ContractId SimpleToken, ContractId SimpleToken)
      with
        newOwner : Party
        transferAmount : Int
      controller owner
      do
        assert (transferAmount > 0)
        assert (transferAmount <= amount)
        remainder <- create this with amount = amount - transferAmount
        transferred <- create this with
          owner = newOwner
          amount = transferAmount
        return (remainder, transferred)
```

</details>

### Exercise 5: Find the Bug -- Workflow Bypass

```daml
template InsuranceClaim
  with
    insurer : Party
    claimant : Party
    amount : Decimal
    status : Text
  where
    signatory insurer
    observer claimant

    choice UpdateClaim : ContractId InsuranceClaim
      with
        newStatus : Text
        newAmount : Decimal
      controller insurer
      do
        create this with status = newStatus, amount = newAmount
```

<details>
<summary>Answer</summary>

Issues:
1. Status is free-text -- insurer can set any value, including jumping to "paid" directly
2. `newAmount` is unvalidated -- insurer could reduce the claim amount during "processing"
3. No workflow enforcement -- review, approval, and payment steps can all be skipped
4. Claimant has no control -- they can't dispute status changes or amount reductions
5. Should use separate templates per state (ClaimSubmitted -> ClaimReviewed -> ClaimApproved -> ClaimPaid)

</details>

### Exercise 6: Find the Bug -- Trigger Safety

```daml
autoPayRule : Party -> TriggerA () ()
autoPayRule party = do
  invoices <- query @Invoice
  forA_ invoices \(cid, invoice) -> do
    when (invoice.status == "approved") $
      dedupExercise cid Pay
```

<details>
<summary>Answer</summary>

Issues:
1. No validation of invoice terms -- automatically pays ANY approved invoice regardless of amount
2. No retry limit -- if `Pay` fails, it retries every heartbeat forever
3. No idempotency -- if trigger restarts, it may double-pay
4. An adversary who can create approved invoices (or manipulate the approval process) gets unlimited automatic payments
5. Should check: amount bounds, trusted issuers, existing payments for same invoice

</details>

---

## Quick Reference: Security Checklist

| # | Category | Check | Severity |
|---|----------|-------|----------|
| 1 | **Authorization** | Every template has appropriate signatories | Critical |
| 2 | **Authorization** | Every choice has the correct controller | Critical |
| 3 | **Authorization** | `ensure` validates all invariants | High |
| 4 | **Privacy** | Observers are minimal (need-to-know) | High |
| 5 | **Privacy** | No unintended divulgence via `fetch` in choices | High |
| 6 | **Privacy** | Choice chains don't escalate visibility | Medium |
| 7 | **Privacy** | Sensitive data split into separate sub-contracts | Medium |
| 8 | **Privacy** | Nested exercises don't create divulgence chains | High |
| 9 | **Double Spend** | Consuming vs non-consuming is intentional | Critical |
| 10 | **Double Spend** | One-time-use contracts use consuming choices | Critical |
| 11 | **Arithmetic** | All arithmetic inputs are bounds-checked | High |
| 12 | **Arithmetic** | Overflow conditions are considered | Medium |
| 13 | **Arithmetic** | Division by zero is prevented | High |
| 14 | **Arithmetic** | Currency/unit consistency across contracts | Medium |
| 15 | **Time** | Time comparisons include skew tolerance | Medium |
| 16 | **Time** | Grace periods prevent boundary exploitation | Medium |
| 17 | **Time** | Deadlines cannot be bypassed by delayed exercise | High |
| 18 | **Time** | Multi-step workflows handle cross-txn time gaps | Medium |
| 19 | **Keys** | Keys use system-controlled components | Medium |
| 20 | **Keys** | `exerciseByKey` preferred over lookup+fetch+exercise | Medium |
| 21 | **Keys** | Unhandled `None` from `lookupByKey` is checked | High |
| 22 | **Workflow** | Contract ID arguments are validated after fetch | High |
| 23 | **Workflow** | Multi-step workflows enforce step ordering | Critical |
| 24 | **Workflow** | Intermediate authorization checks at each step | High |
| 25 | **Lifecycle** | All contracts have an archive/cleanup path | Medium |
| 26 | **Lifecycle** | Propose-accept has reject + timeout + withdraw | High |
| 27 | **Lifecycle** | Delegation chains are depth-bounded | Medium |
| 28 | **Choices** | Loop bounds are enforced | High |
| 29 | **Choices** | Transaction size limits are respected | Medium |
| 30 | **Upgrades** | Template changes are backwards compatible | High |
| 31 | **Upgrades** | Migration paths exist for breaking changes | High |
| 32 | **Upgrades** | Upgrade choices require multi-party authorization | High |
| 33 | **Ledger API** | TLS/mTLS enabled on all API endpoints | Critical |
| 34 | **Ledger API** | JWT tokens are per-party with minimal claims | High |
| 35 | **Ledger API** | Admin API is not exposed to application users | Critical |
| 36 | **Ledger API** | Token expiry and rotation is configured | High |
| 37 | **Triggers** | Retry logic is bounded (max attempts + backoff) | High |
| 38 | **Triggers** | Auto-accept triggers validate terms before acting | Critical |
| 39 | **Triggers** | Trigger actions are idempotent | High |
| 40 | **Off-Ledger** | Oracle data has staleness checks | High |
| 41 | **Off-Ledger** | External data is validated before on-ledger commit | High |
| 42 | **Off-Ledger** | Off-ledger/on-ledger sync uses idempotency tokens | High |
| 43 | **Off-Ledger** | PII/raw external data is not stored on-ledger | Medium |
| 44 | **Canton** | Domain trust is explicitly configured | High |
| 45 | **Canton** | Party allocation is governed | Medium |
| 46 | **Canton** | Rate limiting is enabled | Medium |

---

## Canton Security Architecture (for presentation)

```
+-------------------+     +-------------------+     +-------------------+
|   Participant 1   |     |   Participant 2   |     |   Participant 3   |
|  (Bank A)         |     |  (Bank B)         |     |  (Regulator)      |
|                   |     |                   |     |                   |
| +---------------+ |     | +---------------+ |     | +---------------+ |
| | DAML Engine   | |     | | DAML Engine   | |     | | DAML Engine   | |
| | (validates)   | |     | | (validates)   | |     | | (validates)   | |
| +---------------+ |     | +---------------+ |     | +---------------+ |
| | Ledger API    | |     | | Ledger API    | |     | | Ledger API    | |
| +---------------+ |     | +---------------+ |     | +---------------+ |
+--------+----------+     +--------+----------+     +--------+----------+
         |                         |                         |
         | encrypted               | encrypted               | encrypted
         |                         |                         |
+--------v-----------+-------------v-----------+-------------v----------+
|                          Canton Domain                                |
|  +----------------+    +-----------------+    +--------------------+  |
|  |   Sequencer    |    |    Mediator     |    |  Domain Manager    |  |
|  | (orders txns)  |    | (validates      |    | (topology,         |  |
|  |                |    |  confirmations) |    |  identity)         |  |
|  +----------------+    +-----------------+    +--------------------+  |
+-----------------------------------------------------------------------+

Key Security Properties:
- Sub-transaction privacy: only involved parties see relevant parts
- Transaction payloads are encrypted; sequencer/mediator see metadata only
- Each participant independently validates via their own DAML engine
- No single point of trust (unlike Fabric orderer or Corda notary)
```

---

*Document Version: 2.0 | Last Updated: April 2026 | CredShields*
