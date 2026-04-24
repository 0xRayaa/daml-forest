# Lesson 5: Privacy, Observers & Divulgence

> **Based on:** Daml 101 Video Series (Episode 9-10) + Security Guide §2
> **Difficulty:** Intermediate
> **Time:** ~30 minutes

---

## DAML's Privacy Model

DAML enforces **need-to-know privacy** by default. A party can only see contracts where they are a:
- **Signatory** — they helped create it
- **Observer** — they were explicitly given read access
- **Divulgee** — they were shown it through an exercise chain (more on this below)

Unlike Ethereum where all state is public, DAML contracts are **encrypted per recipient** on Canton.

---

## What Parties Can See

```
Alice creates Contract A (signatory: Alice, observer: Bob)
├── Alice sees: Contract A ✅
├── Bob sees:   Contract A ✅ (observer)
└── Charlie sees: nothing ❌

Bob creates Contract B (signatory: Bob)
├── Alice sees: nothing ❌
├── Bob sees:   Contract B ✅
└── Charlie sees: nothing ❌
```

---

## Unnecessary Observers — Data Leakage

Every observer you add is a **potential data leak**:

```daml
-- ❌ BAD: All counterparties in a portfolio see each bilateral trade
template PortfolioTrade
  with
    trader           : Party
    counterparty     : Party
    allCounterparties : [Party]  -- everyone in the portfolio
    asset            : Text
    price            : Decimal
  where
    signatory trader, counterparty
    observer allCounterparties    -- LEAK: competitors see your prices!
```

**Fix:** Only add observers who genuinely need access:
```daml
-- ✅ GOOD: Only regulator gets visibility, not all counterparties
template PortfolioTrade
  with
    trader       : Party
    counterparty : Party
    regulator    : Party
    asset        : Text
    price        : Decimal
  where
    signatory trader, counterparty
    observer regulator   -- only regulator needs to see this
```

---

## Divulgence — The Invisible Leak

**Divulgence** is when a party sees a contract they're not a stakeholder of, because a choice they submitted fetched that contract.

> **Rule:** When party P exercises a choice that `fetch`es contract C, P sees the full contents of C — even if P is not a signatory or observer of C.

```daml
-- Secret dealer spread — only dealer should know
template SecretPricing
  with
    dealer       : Party
    secretSpread : Decimal     -- confidential!
  where
    signatory dealer            -- client is NOT a stakeholder

template PublicQuote
  with
    dealer     : Party
    client     : Party
    pricingRef : ContractId SecretPricing
  where
    signatory dealer
    observer client      -- client sees this contract

    -- ❌ BUG: Client submits this → sees SecretPricing!
    choice GetQuote : Decimal
      with basePrice : Decimal
      controller client   -- client is the submitter
      do
        pricing <- fetch pricingRef  -- DIVULGES SecretPricing to client!
        return (basePrice + pricing.secretSpread)
```

### Why this happens:
When `client` exercises `GetQuote`, they are the **submitter** of the transaction. The DAML runtime must show them all contracts fetched in that transaction to validate it — including `SecretPricing`.

---

## Fixing Divulgence — Invert the Workflow

The fix is to make the **party with the secret** be the submitter:

```daml
-- ✅ GOOD: Client creates a request, dealer processes it
template QuoteRequest
  with
    dealer    : Party
    client    : Party
    basePrice : Decimal
  where
    signatory client    -- client creates the request
    observer dealer     -- dealer sees it

    -- Dealer submits this → fetches run under dealer's authority
    choice FulfillQuote : ContractId Quote
      with
        pricingRef : ContractId SecretPricing
      controller dealer   -- DEALER is the submitter now
      do
        pricing <- fetch pricingRef  -- dealer fetches their own secret
        create Quote with
          dealer    = dealer
          client    = client
          price     = basePrice + pricing.secretSpread
          -- Client never sees SecretPricing! ✅

template Quote
  with
    dealer : Party
    client : Party
    price  : Decimal
  where
    signatory dealer
    observer client   -- client sees final price only
```

---

## Nested Divulgence Chains

The divulgence problem **compounds** in nested exercise chains:

```daml
-- ❌ BAD: Client submits → exercises → exercises → fetch leaks to client!
template MasterAgreement
  with
    broker : Party
    client : Party
    subRef : ContractId SubAccount
  where
    signatory broker
    observer client

    choice ExecuteTrade : ()
      with asset : Text; qty : Int
      controller client    -- client submits the whole tree
      do
        -- This triggers: SubAccount.AllocateFunds → fetch CreditLimit
        -- Client sees CreditLimit even though they're not a stakeholder!
        exercise subRef (AllocateFunds with asset = asset; qty = qty)
```

**The chain:** `client submits ExecuteTrade` → `AllocateFunds exercised` → `CreditLimit fetched` → **client sees CreditLimit!**

```daml
-- ✅ GOOD: Break the chain — client only creates a request
template MasterAgreement
  with
    broker : Party
    client : Party
  where
    signatory broker
    observer client

    choice RequestTrade : ContractId TradeRequest
      with asset : Text; qty : Int
      controller client
      do
        -- Client just creates a request — no fetches
        create TradeRequest with
          broker = broker
          client = client
          asset  = asset
          qty    = qty

-- Broker processes this — broker submits, fetches run under broker's authority
template TradeRequest
  with
    broker : Party
    client : Party
    asset  : Text
    qty    : Int
  where
    signatory client
    observer broker

    choice ProcessRequest : ()
      with subRef : ContractId SubAccount
      controller broker    -- BROKER submits this transaction
      do
        exercise subRef (AllocateFunds with asset = asset; qty = qty)
        -- Fetches in AllocateFunds are under broker's authority ✅
        -- Client sees nothing!
```

---

## Monolithic Contracts — Splitting by Sensitivity

Don't put everything in one contract if different observers need different data:

```daml
-- ❌ BAD: Auditor sees SSN and credit score they don't need
template CustomerRecord
  with
    bank     : Party
    customer : Party
    auditor  : Party
    -- Public
    name        : Text
    accountType : Text
    -- Sensitive — auditor doesn't need these!
    ssn              : Text
    internalCreditScore : Int
    amlRiskFlag      : Bool
  where
    signatory bank, customer
    observer auditor   -- auditor sees EVERYTHING including SSN!
```

```daml
-- ✅ GOOD: Split by sensitivity level
template CustomerPublicProfile
  with
    bank     : Party
    customer : Party
    auditor  : Party
    name        : Text
    accountType : Text
  where
    signatory bank, customer
    observer auditor   -- auditor sees only public info

template CustomerSensitiveData
  with
    bank     : Party
    customer : Party
    ssn      : Text
    internalCreditScore : Int
  where
    signatory bank, customer
    -- No observer: only bank and customer can see

template CustomerComplianceData
  with
    bank              : Party
    customer          : Party
    complianceOfficer : Party
    amlRiskFlag       : Bool
  where
    signatory bank, customer
    observer complianceOfficer  -- only compliance sees AML data
```

---

## Observer Escalation — Unilateral Sharing

Beware of choices that let one party share confidential data without the other's consent:

```daml
-- ❌ BAD: partyA can share deal terms with anyone, no partyB consent
template ConfidentialDeal
  with
    partyA : Party
    partyB : Party
    terms  : Text    -- confidential!
  where
    signatory partyA, partyB

    nonconsuming choice ShareWith : ContractId SharedView
      with viewer : Party
      controller partyA    -- partyA acts alone!
      do
        create SharedView with
          owner     = partyA
          viewer    = viewer
          dealTerms = terms   -- leaks to viewer without partyB consent!
```

```daml
-- ✅ GOOD: Both parties must agree to share
template ConfidentialDeal
  with
    partyA : Party
    partyB : Party
    terms  : Text
  where
    signatory partyA, partyB

    choice ProposeShare : ContractId ShareProposal
      with viewer : Party
      controller partyA
      do
        create ShareProposal with
          proposer = partyA
          approver = partyB
          viewer   = viewer
          terms    = terms

template ShareProposal
  with
    proposer : Party
    approver : Party
    viewer   : Party
    terms    : Text
  where
    signatory proposer
    observer approver

    choice ApproveShare : ContractId SharedView
      controller approver   -- partyB must explicitly approve
      do
        create SharedView with
          owners    = [proposer, approver]
          viewer    = viewer
          dealTerms = terms

    choice RejectShare : ()
      controller approver
      do return ()
```

---

## Exercise 5: Find the Privacy Bugs

Spot all privacy issues in this trading system:

```daml
template TradeTicket
  with
    exchange    : Party
    buyFirm     : Party
    sellFirm    : Party
    allFirms    : [Party]   -- all firms on the exchange
    asset       : Text
    quantity    : Int
    price       : Decimal
    confidentialTerms : Text
  where
    signatory exchange
    observer allFirms   -- (a) bug?

    nonconsuming choice GetTerms : Text
      controller buyFirm    -- (b) bug?
      do
        secret <- fetch (toAnyContractId self)
        return confidentialTerms
```

**Bugs:**
- **(a)** `allFirms` as observers — all competing firms see this bilateral trade's price and quantity
- **(b)** `GetTerms` is `nonconsuming` and the buyer (not both parties) controls it — seller can't prevent repeated access; also `fetch self` inside a buyFirm-submitted transaction re-divulges nothing new but the `nonconsuming` allows repeated calls

---

## Key Takeaways

1. DAML's privacy is **need-to-know** — only signatories and observers see a contract
2. **Unnecessary observers** leak competitive information
3. **Divulgence** happens when a party submits a transaction that `fetch`es a contract they're not a stakeholder of
4. **Fix divulgence** by inverting the workflow — make the secret-holder the submitter
5. **Nested exercise chains** compound divulgence — every fetched contract leaks to the root submitter
6. **Split monolithic contracts** by sensitivity — don't put sensitive data where auditors can see it
7. **Unilateral sharing** — always require both parties' consent before sharing confidential data

---

## Next Lesson
→ **Lesson 6: The UTXO Model & Value Conservation**
