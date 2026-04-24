const COURSES = [
  {
    id: 1, icon: "📜", title: "DAML Fundamentals", level: "beginner",
    chapters: [
      {
        id: "1-1", title: "What is DAML?",
        theory: `<h1>What is DAML?</h1>
<p>DAML is a smart contract language for multi-party business applications. Unlike Ethereum, DAML enforces privacy and authorization by design.</p>
<h2>Key Concepts</h2>
<ul><li><strong>Template</strong> — blueprint for a contract</li><li><strong>Signatory</strong> — must authorize creation</li><li><strong>Observer</strong> — can view but not control</li><li><strong>Choice</strong> — the only way to change state</li></ul>
<h2>The Ledger Model</h2>
<p>DAML contracts are <strong>immutable</strong>. To update state, you archive the old contract and create a new one. The ledger is an append-only log of <code>CREATE</code> and <code>ARCHIVE</code> events.</p>`,
        task: "Add a <code>signatory</code> line to the template below so the bank must authorize account creation.",
        hint: "Use: signatory bank",
        initialCode: `template BankAccount
  with
    bank    : Party
    owner   : Party
    balance : Decimal
  where
    -- Add signatory here
    observer owner`,
        solution: `template BankAccount
  with
    bank    : Party
    owner   : Party
    balance : Decimal
  where
    signatory bank
    observer owner`,
        requiredPatterns: ["signatory bank"],
        forbiddenPatterns: []
      },
      {
        id: "1-2", title: "Your First Choice",
        theory: `<h1>Choices — How Contracts Evolve</h1>
<p>Choices are the only way to change ledger state. A choice has a <strong>controller</strong> (who can exercise it) and a <strong>do block</strong> (what happens).</p>
<pre>choice Transfer : ContractId IOU
  with newOwner : Party
  controller owner
  do
    create this with owner = newOwner</pre>
<h2>Consuming vs Non-Consuming</h2>
<ul><li><strong>Consuming</strong> (default) — archives the contract after execution</li><li><strong>nonconsuming</strong> — contract stays alive</li></ul>
<blockquote>⚠️ nonconsuming choices that create value = infinite money bug!</blockquote>`,
        task: "Add a <code>Transfer</code> choice controlled by <code>owner</code> that creates a new IOU with the new owner.",
        hint: "Use: controller owner, then: create this with owner = newOwner",
        initialCode: `template IOU
  with
    issuer : Party
    owner  : Party
    amount : Decimal
  where
    signatory issuer
    observer owner

    -- Add Transfer choice here`,
        solution: `template IOU
  with
    issuer : Party
    owner  : Party
    amount : Decimal
  where
    signatory issuer
    observer owner

    choice Transfer : ContractId IOU
      with newOwner : Party
      controller owner
      do
        create this with owner = newOwner`,
        requiredPatterns: ["choice Transfer", "controller owner", "create this with owner = newOwner"],
        forbiddenPatterns: []
      },
      {
        id: "1-3", title: "The ensure Clause",
        theory: `<h1>The ensure Clause</h1>
<p>The <code>ensure</code> clause is a precondition on contract creation. If it returns <code>False</code>, the creation fails immediately — invalid state never reaches the ledger.</p>
<pre>template Loan
  with
    amount : Decimal
  where
    signatory lender
    ensure amount > 0.0  -- blocks invalid creation</pre>
<h2>ensure vs assert</h2>
<table><tr><th>Clause</th><th>Where</th><th>Guards</th></tr><tr><td>ensure</td><td>Template body</td><td>Contract creation</td></tr><tr><td>assert</td><td>Choice do block</td><td>Choice execution</td></tr></table>`,
        task: "Add an ensure clause that validates: amount > 0, interestRate >= 0, and lender /= borrower.",
        hint: "ensure amount > 0.0 && interestRate >= 0.0 && lender /= borrower",
        initialCode: `template Loan
  with
    lender       : Party
    borrower     : Party
    amount       : Decimal
    interestRate : Decimal
  where
    signatory lender, borrower
    -- Add ensure clause here`,
        solution: `template Loan
  with
    lender       : Party
    borrower     : Party
    amount       : Decimal
    interestRate : Decimal
  where
    signatory lender, borrower
    ensure amount > 0.0
        && interestRate >= 0.0
        && lender /= borrower`,
        requiredPatterns: ["ensure amount > 0.0", "interestRate >= 0.0", "lender /= borrower"],
        forbiddenPatterns: []
      },
      {
        id: "1-4", title: "The Propose-Accept Pattern",
        theory: `<h1>Propose-Accept Pattern</h1>
<p>How do two parties create a contract both must sign? Neither can forge the other's signature.</p>
<p><strong>Solution:</strong> Two-step workflow.</p>
<ol><li>Party A creates a <em>Proposal</em> (only A signs)</li><li>Party B exercises <em>Accept</em> → creates the final contract (both sign)</li></ol>
<pre>template TradeProposal
  with buyer : Party; seller : Party
  where
    signatory buyer    -- only buyer signs proposal
    observer seller

    choice Accept : ContractId Trade
      controller seller
      do
        create Trade with buyer; seller</pre>
<p>When seller exercises Accept, DAML combines buyer's signatory authority + seller's controller authority to authorize the Trade creation.</p>`,
        task: "Complete the LoanProposal template with an AcceptLoan choice that creates a Loan contract signed by both lender and borrower.",
        hint: "controller borrower, then: create Loan with lender = lender; borrower = borrower; amount = amount",
        initialCode: `template LoanProposal
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
  where
    signatory lender
    observer borrower

    -- Add AcceptLoan choice here

template Loan
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
  where
    signatory lender, borrower`,
        solution: `template LoanProposal
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
  where
    signatory lender
    observer borrower

    choice AcceptLoan : ContractId Loan
      controller borrower
      do
        create Loan with
          lender   = lender
          borrower = borrower
          amount   = amount

template Loan
  with
    lender   : Party
    borrower : Party
    amount   : Decimal
  where
    signatory lender, borrower`,
        requiredPatterns: ["choice AcceptLoan", "controller borrower", "create Loan with"],
        forbiddenPatterns: []
      }
    ]
  },
  {
    id: 2, icon: "🔐", title: "Authorization & Parties", level: "beginner",
    chapters: [
      {
        id: "2-1", title: "Wrong Controller Bug",
        theory: `<h1>Wrong Controller — Most Common DAML Bug</h1>
<p>If the <strong>wrong party</strong> controls a choice, they can move assets they don't own.</p>
<pre>-- ❌ VULNERABLE: bank controls owner's funds!
choice Transfer : ContractId Account
  with recipient : Party; amount : Decimal
  controller bank  -- bank drains accounts at will!
  do ...</pre>
<p>The fix: make the <strong>owner</strong> both a signatory and the controller of their own choices.</p>`,
        task: "Fix the Account template: make owner a signatory AND the controller of the Transfer choice (not the bank).",
        hint: "Change: signatory bank → signatory bank, owner  AND controller bank → controller owner",
        initialCode: `-- ❌ VULNERABLE: Fix this template!
template Account
  with
    bank    : Party
    owner   : Party
    balance : Decimal
  where
    signatory bank
    observer owner

    choice Transfer : ContractId Account
      with recipient : Party; transferAmount : Decimal
      controller bank
      do
        assert (transferAmount > 0.0 && transferAmount <= balance)
        create this with balance = balance - transferAmount`,
        solution: `-- ✅ FIXED
template Account
  with
    bank    : Party
    owner   : Party
    balance : Decimal
  where
    signatory bank, owner
    observer owner

    choice Transfer : ContractId Account
      with recipient : Party; transferAmount : Decimal
      controller owner
      do
        assert (transferAmount > 0.0 && transferAmount <= balance)
        create this with balance = balance - transferAmount`,
        requiredPatterns: ["signatory bank, owner", "controller owner"],
        forbiddenPatterns: ["controller bank"]
      },
      {
        id: "2-2", title: "Privilege Laundering",
        theory: `<h1>Privilege Laundering</h1>
<p>A low-privilege choice secretly uses a high-privilege signatory's authority inside its <code>do</code> block.</p>
<pre>-- ❌ DANGEROUS
template Treasury
  with cfo : Party; operator : Party
  where
    signatory cfo  -- CFO's authority available everywhere!

    choice WeeklyReconcile : ()  -- looks innocent
      controller operator
      do
        -- secretly creates a high-value contract using CFO's authority!
        create CashAdvance with issuer = cfo; amount = 500000.0</pre>
<p>The operator runs a routine reconciliation but secretly mints cash advances using the CFO's signatory authority.</p>`,
        task: "Refactor the Treasury template to separate the low-privilege reconcile from the high-privilege cash advance. The CFO must explicitly control any cash advance.",
        hint: "Give WeeklyReconcile controller operator (no create), add separate IssueCashAdvance with controller cfo",
        initialCode: `-- ❌ Fix the privilege laundering bug
template Treasury
  with
    cfo      : Party
    operator : Party
  where
    signatory cfo

    nonconsuming choice WeeklyReconcile : ()
      controller operator
      do
        create CashAdvance with
          issuer = cfo
          recipient = operator
          amount = 500000.0
        return ()`,
        solution: `-- ✅ Separated by privilege level
template Treasury
  with
    cfo      : Party
    operator : Party
  where
    signatory cfo

    nonconsuming choice WeeklyReconcile : Text
      controller operator
      do
        return "Reconciliation complete"

    choice IssueCashAdvance : ContractId CashAdvance
      with recipient : Party; amount : Decimal
      controller cfo
      do
        assert (amount > 0.0)
        create CashAdvance with
          issuer = cfo
          recipient = recipient
          amount = amount`,
        requiredPatterns: ["controller cfo", "choice IssueCashAdvance"],
        forbiddenPatterns: []
      },
      {
        id: "2-3", title: "Observer Escalation",
        theory: `<h1>Observer Escalation</h1>
<p>When one party unilaterally shares confidential contract data with others without their co-signatory's consent.</p>
<pre>-- ❌ partyA shares deal terms without partyB consent
nonconsuming choice ShareWith : ContractId SharedView
  with viewer : Party
  controller partyA  -- partyA acts alone!
  do
    create SharedView with dealTerms = terms</pre>
<p>Fix: require both parties to agree before sharing — use a propose-accept for the share action.</p>`,
        task: "Fix the ConfidentialDeal template so sharing requires both partyA AND partyB to consent (via a two-step propose-accept).",
        hint: "Replace ShareWith with ProposeShare (controller partyA), then add a separate ShareProposal template with ApproveShare (controller partyB)",
        initialCode: `-- ❌ Fix: partyA can share without partyB's consent
template ConfidentialDeal
  with
    partyA : Party
    partyB : Party
    terms  : Text
  where
    signatory partyA, partyB

    nonconsuming choice ShareWith : ()
      with viewer : Party
      controller partyA
      do
        create SharedView with
          owner  = partyA
          viewer = viewer
          terms  = terms
        return ()`,
        solution: `-- ✅ Both parties must consent to sharing
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

    choice ApproveShare : ()
      controller approver
      do return ()`,
        requiredPatterns: ["choice ProposeShare", "controller partyA", "controller partyB", "ShareProposal"],
        forbiddenPatterns: []
      }
    ]
  },
  {
    id: 3, icon: "⚖️", title: "Privacy & Divulgence", level: "intermediate",
    chapters: [
      {
        id: "3-1", title: "Unnecessary Observers",
        theory: `<h1>Unnecessary Observers — Data Leakage</h1>
<p>Every observer is a potential data leak. Adding competitors as observers on bilateral trades exposes your prices.</p>
<pre>-- ❌ All counterparties see your bilateral trade price
template PortfolioTrade
  with allCounterparties : [Party]
  where
    observer allCounterparties  -- competitors see your prices!</pre>`,
        task: "Fix the PortfolioTrade template — remove allCounterparties observer list and only add the regulator as observer.",
        hint: "Remove allCounterparties field and the observer allCounterparties line. Add: observer regulator",
        initialCode: `-- ❌ Fix: competitors see bilateral trade prices
template PortfolioTrade
  with
    trader            : Party
    counterparty      : Party
    allCounterparties : [Party]
    regulator         : Party
    asset             : Text
    price             : Decimal
  where
    signatory trader, counterparty
    observer allCounterparties
    ensure price > 0.0`,
        solution: `-- ✅ Only regulator gets visibility
template PortfolioTrade
  with
    trader       : Party
    counterparty : Party
    regulator    : Party
    asset        : Text
    price        : Decimal
  where
    signatory trader, counterparty
    observer regulator
    ensure price > 0.0`,
        requiredPatterns: ["observer regulator"],
        forbiddenPatterns: ["observer allCounterparties", "allCounterparties : [Party]"]
      },
      {
        id: "3-2", title: "Divulgence via Fetch",
        theory: `<h1>Divulgence — The Invisible Leak</h1>
<p>When party P submits a transaction that <code>fetch</code>es contract C, P sees the full contents of C — even if P is not a signatory or observer of C.</p>
<pre>-- ❌ Client submits → fetches SecretPricing → client sees it!
choice GetQuote : Decimal
  controller client  -- client is the submitter
  do
    pricing <- fetch secretPricingRef  -- DIVULGES to client!
    return (basePrice + pricing.spread)</pre>
<p><strong>Fix:</strong> Invert the workflow — make the secret-holder the submitter.</p>`,
        task: "Fix the divulgence by restructuring: client creates a QuoteRequest, dealer fetches the secret and returns just the final price.",
        hint: "Client controls QuoteRequest creation. Dealer controls FulfillQuote (where the secret fetch happens). Client never sees SecretPricing.",
        initialCode: `-- ❌ Fix: client sees SecretPricing via divulgence
template PublicQuote
  with
    dealer     : Party
    client     : Party
    secretRef  : ContractId SecretPricing
    basePrice  : Decimal
  where
    signatory dealer
    observer client

    choice GetQuote : Decimal
      controller client
      do
        secret <- fetch secretRef
        return (basePrice + secret.spread)`,
        solution: `-- ✅ Inverted: dealer fetches the secret
template QuoteRequest
  with
    dealer    : Party
    client    : Party
    basePrice : Decimal
  where
    signatory client
    observer dealer

    choice FulfillQuote : ContractId Quote
      with secretRef : ContractId SecretPricing
      controller dealer
      do
        secret <- fetch secretRef
        create Quote with
          dealer = dealer
          client = client
          price  = basePrice + secret.spread

template Quote
  with
    dealer : Party
    client : Party
    price  : Decimal
  where
    signatory dealer
    observer client`,
        requiredPatterns: ["controller dealer", "QuoteRequest", "controller client"],
        forbiddenPatterns: []
      }
    ]
  },
  {
    id: 4, icon: "⚗️", title: "Value Conservation", level: "intermediate",
    chapters: [
      {
        id: "4-1", title: "Value Leakage",
        theory: `<h1>Value Conservation</h1>
<p>In DAML's UTXO model, archiving a contract without putting all its value into new contracts <strong>permanently destroys that value</strong>.</p>
<pre>-- ❌ Fee is computed but never assigned to a contract!
let fee = amount * 0.001
create sender with amount = amount - transferAmount
create receiver with amount = transferAmount - fee
-- fee tokens vanish forever!</pre>
<p>The conservation invariant: <code>sum(inputs) == sum(outputs)</code> for every consuming choice.</p>`,
        task: "Fix the Token Transfer choice to preserve all value — create a third output contract for the fee collector.",
        hint: "Add feeCollector : Party to choice params, create Token with owner = feeCollector; amount = fee. Add assert checking conservation.",
        initialCode: `-- ❌ Fix: fee tokens vanish
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
        assert (transferAmount > 0.0 && transferAmount <= amount)
        let fee           = transferAmount * 0.001
        let recipientGets = transferAmount - fee
        let senderRemains = amount - transferAmount
        sender   <- create this with amount = senderRemains
        receiver <- create Token with
          issuer = issuer; owner = recipient; amount = recipientGets
        return (sender, receiver)`,
        solution: `-- ✅ All value allocated
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
        recipient      : Party
        transferAmount : Decimal
        feeCollector   : Party
      controller owner
      do
        assert (transferAmount > 0.0 && transferAmount <= amount)
        let fee           = transferAmount * 0.001
        let recipientGets = transferAmount - fee
        let senderRemains = amount - transferAmount
        assert (senderRemains + recipientGets + fee == amount)
        sender   <- create this with amount = senderRemains
        receiver <- create Token with
          issuer = issuer; owner = recipient; amount = recipientGets
        feeOut   <- create Token with
          issuer = issuer; owner = feeCollector; amount = fee
        return (sender, receiver, feeOut)`,
        requiredPatterns: ["feeCollector", "assert (senderRemains + recipientGets + fee == amount)"],
        forbiddenPatterns: []
      },
      {
        id: "4-2", title: "Double Spend Bug",
        theory: `<h1>Double Spend — The nonconsuming Trap</h1>
<p>A <code>nonconsuming</code> choice that creates value is an infinite money printer. The contract is never archived, so it can be triggered unlimited times.</p>
<pre>-- ❌ VULNERABLE: Voucher redeemable unlimited times!
nonconsuming choice Redeem : ContractId Payment
  controller beneficiary
  do
    create Payment with from = issuer; amount = amount
    -- Voucher still alive → can redeem again tomorrow!</pre>`,
        task: "Fix the PaymentVoucher by removing nonconsuming so it's consumed on redemption.",
        hint: "Remove the 'nonconsuming' keyword — consuming is the default and archives the voucher.",
        initialCode: `-- ❌ Fix: voucher can be redeemed unlimited times
template PaymentVoucher
  with
    issuer      : Party
    beneficiary : Party
    amount      : Decimal
  where
    signatory issuer
    observer beneficiary
    ensure amount > 0.0

    nonconsuming choice Redeem : ContractId Payment
      controller beneficiary
      do
        create Payment with
          from   = issuer
          to     = beneficiary
          amount = amount`,
        solution: `-- ✅ Consuming: voucher archived after one use
template PaymentVoucher
  with
    issuer      : Party
    beneficiary : Party
    amount      : Decimal
  where
    signatory issuer
    observer beneficiary
    ensure amount > 0.0

    choice Redeem : ContractId Payment
      controller beneficiary
      do
        create Payment with
          from   = issuer
          to     = beneficiary
          amount = amount`,
        requiredPatterns: ["choice Redeem"],
        forbiddenPatterns: ["nonconsuming choice Redeem"]
      }
    ]
  },
  {
    id: 5, icon: "⏱️", title: "Time & Deadlines", level: "intermediate",
    chapters: [
      {
        id: "5-1", title: "The Skew Problem",
        theory: `<h1>Canton's Time Skew Problem</h1>
<p>Participant-proposed time ≠ sequencer-recorded time. The difference can be seconds to minutes.</p>
<p>Exact boundary comparisons fail under skew:</p>
<pre>-- Participant proposes: 16:59:58 ✅
-- Sequencer records:   17:00:03 ❌ — rejected!</pre>
<p><strong>Fix:</strong> Add a grace period using <code>addRelTime</code>.</p>
<pre>assert (now <= addRelTime deadline (minutes 5))</pre>`,
        task: "Fix the SettlementInstruction: add a skewTolerance field and use addRelTime to give a grace period on the deadline check.",
        hint: "Add skewTolerance : RelTime to with block. Change assert to: assert (now <= addRelTime settlementDeadline skewTolerance)",
        initialCode: `-- ❌ Fix: exact comparison fails under time skew
template SettlementInstruction
  with
    sender             : Party
    receiver           : Party
    amount             : Decimal
    settlementDeadline : Time
  where
    signatory sender
    observer receiver
    ensure amount > 0.0

    choice Settle : ()
      controller receiver
      do
        now <- getTime
        assert (now <= settlementDeadline)
        return ()`,
        solution: `-- ✅ Grace period absorbs time skew
template SettlementInstruction
  with
    sender             : Party
    receiver           : Party
    amount             : Decimal
    settlementDeadline : Time
    skewTolerance      : RelTime
  where
    signatory sender
    observer receiver
    ensure amount > 0.0

    choice Settle : ()
      controller receiver
      do
        now <- getTime
        assert (now <= addRelTime settlementDeadline skewTolerance)
        return ()`,
        requiredPatterns: ["skewTolerance", "addRelTime settlementDeadline skewTolerance"],
        forbiddenPatterns: ["assert (now <= settlementDeadline)"]
      }
    ]
  },
  {
    id: 6, icon: "🔑", title: "Keys & Governance", level: "advanced",
    chapters: [
      {
        id: "6-1", title: "TOCTOU with lookupByKey",
        theory: `<h1>TOCTOU — Time of Check vs Time of Use</h1>
<p>Using <code>lookupByKey</code> followed by <code>fetch</code> creates a race condition. The contract may be archived between the two calls.</p>
<pre>-- ❌ Contract may vanish between lookup and fetch!
walletOpt <- lookupByKey @Wallet (bank, payer)
case walletOpt of
  Some cid -> do
    wallet <- fetch cid  -- may fail if archived!</pre>
<p><strong>Fix:</strong> Use <code>fetchByKey</code> — atomic lookup + fetch in one operation.</p>`,
        task: "Replace the lookupByKey + fetch pattern with a single fetchByKey call.",
        hint: "Replace: lookupByKey then fetch with: (walletCid, wallet) <- fetchByKey @Wallet (bank, payer)",
        initialCode: `-- ❌ Fix: TOCTOU race condition
template PaymentProcessor
  with bank : Party
  where
    signatory bank

    nonconsuming choice ProcessPayment : ()
      with payer : Party; amount : Decimal
      controller bank
      do
        walletOpt <- lookupByKey @Wallet (bank, payer)
        case walletOpt of
          None -> abort "No wallet"
          Some walletCid -> do
            wallet <- fetch walletCid
            assert (wallet.balance >= amount)
            archive walletCid
            create Wallet with
              bank    = bank
              owner   = payer
              balance = wallet.balance - amount
        return ()`,
        solution: `-- ✅ Atomic fetchByKey eliminates TOCTOU
template PaymentProcessor
  with bank : Party
  where
    signatory bank

    nonconsuming choice ProcessPayment : ()
      with payer : Party; amount : Decimal
      controller bank
      do
        (walletCid, wallet) <- fetchByKey @Wallet (bank, payer)
        assert (wallet.balance >= amount)
        archive walletCid
        create Wallet with
          bank    = bank
          owner   = payer
          balance = wallet.balance - amount`,
        requiredPatterns: ["fetchByKey @Wallet"],
        forbiddenPatterns: ["lookupByKey @Wallet"]
      },
      {
        id: "6-2", title: "Governance DoS",
        theory: `<h1>Governance Parameter → Division by Zero</h1>
<p>Admin-settable parameters used as denominators can cause system-wide DoS when set to zero.</p>
<pre>-- ❌ collateralRatio=0 → ArithmeticError → system frozen!
return (collateralValue / collateralRatio)</pre>
<p>Fix: bound all governance parameters with <code>ensure</code> at template creation.</p>`,
        task: "Add an ensure clause to LendingPool that prevents any parameter from being zero or out of valid range.",
        hint: "ensure collateralRatio > 0.0 && collateralRatio <= 10.0 && feeRate > 0.0 && feeRate <= 1.0",
        initialCode: `-- ❌ Fix: admin can set collateralRatio=0 → DoS
template LendingPool
  with
    operator        : Party
    collateralRatio : Decimal
    feeRate         : Decimal
  where
    signatory operator
    -- Missing ensure!

    nonconsuming choice CalculateBorrow : Decimal
      with collateralValue : Decimal
      controller operator
      do
        return (collateralValue / collateralRatio)`,
        solution: `-- ✅ Governance parameters bounded at creation
template LendingPool
  with
    operator        : Party
    collateralRatio : Decimal
    feeRate         : Decimal
  where
    signatory operator
    ensure collateralRatio > 0.0 && collateralRatio <= 10.0
        && feeRate > 0.0 && feeRate <= 1.0

    nonconsuming choice CalculateBorrow : Decimal
      with collateralValue : Decimal
      controller operator
      do
        return (collateralValue / collateralRatio)`,
        requiredPatterns: ["ensure collateralRatio > 0.0", "feeRate > 0.0"],
        forbiddenPatterns: []
      }
    ]
  }
];
