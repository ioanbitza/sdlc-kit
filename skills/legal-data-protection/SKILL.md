---
name: legal-data-protection
user-invocable: false
description: Data protection rules (GDPR, Regulation (EU) 2016/679) an app that stores personal data must keep. Rules LD-01 to LD-11, each with its article. Read by the legal role before the requirements and by finder-legal in the review. Not legal advice.
---

# Legal: data protection

## What this covers
An app that stores a customer's name, email, phone or address stores personal data, and Regulation (EU) 2016/679 (GDPR) applies to whoever runs it. This file turns the articles that touch the app's design into rules a reviewer can cite. It is not legal advice: the legal role and finder-legal check the requirements and the code against these rules, and the human decides. What the law requires of the organisation (a privacy notice, a processor contract, a data protection officer) is outside the app and outside this file. The text of the Regulation: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679 (CELEX 32016R0679).

## Rules
Rule ids are `LD-nn`. A finding cites one of them; the script refuses an id that is not here.

### LD-01 Personal data is any information about an identifiable person
Why: a name, an email, a phone number, an address, a customer number joined to a name, an IP address: each one makes a person identifiable, so the rules below apply to the field, however small the app.
Source: Article 4(1), https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679
Applies to: both

### LD-02 Every personal data field has a stated purpose and is used only for it
Why: data collected for an invoice cannot later feed a mailing list the customer never heard of; a field with no purpose has no legal ground to exist.
Source: Article 5(1)(a) lawfulness, fairness and transparency; Article 5(1)(b) purpose limitation
Applies to: both

### LD-03 The app stores only the personal data its purpose needs, by default
Why: a field "because it may be useful later" is the one that leaks; minimisation is also the default setting, not an option the user must find.
Source: Article 5(1)(c) data minimisation; Article 25(2) data protection by default
Applies to: both

### LD-04 Personal data can be corrected, and the correction reaches every place it is shown
Why: the person has a right to have inaccurate data rectified without undue delay; a copy left in a cache or a second key is inaccurate data the app still keeps.
Source: Article 5(1)(d) accuracy; Article 16 right to rectification
Applies to: both

### LD-05 Personal data is kept no longer than its purpose needs, and every entity with personal data has a retention rule
Why: a customer record with no end date is kept forever by default; the requirements must say how long each kind of record lives and what happens then.
Source: Article 5(1)(e) storage limitation
Applies to: both

### LD-06 The person can obtain a copy of their personal data
Why: the right of access needs a path in the app: which data is held, for what purpose, how long; the copy is provided in a commonly used electronic form, within one month of the request.
Source: Article 15(1) and 15(3) right of access; Article 12(3) one month to act on a request
Applies to: both

### LD-07 The person can have their personal data erased; a refusal rests on a listed exception and the app says which
Why: erasure is a right, not a feature; the exceptions are closed. An invoice the law requires to be kept is one (a legal obligation, 17(3)(b)); a legal claim is another (17(3)(e)). Erasure is then refused for the data on that document, for the retention period, and the app says so instead of failing silently. A project domain skill may carry the retention rule as a `D-nn`; this rule is what makes the refusal lawful.
Source: Article 17(1) right to erasure; Article 17(3)(b) and 17(3)(e) exceptions
Applies to: both

### LD-08 An export for the person is structured, commonly used and machine-readable
Why: portability means the person can take the data elsewhere; a PDF, a screenshot or a printed table is not machine-readable, a JSON or CSV file is.
Source: Article 20(1) right to data portability
Applies to: both

### LD-09 Personal data does not leak into logs, error messages, URLs or the storage of a shared machine
Why: `console.log(customer)`, an error that echoes the email, a name in a query string, or data left in `localStorage` on a shared computer are unauthorised disclosures the app itself causes; security must fit the risk.
Source: Article 5(1)(f) integrity and confidentiality; Article 32(1) security of processing
Applies to: both

### LD-10 The categories of personal data, their purposes and their retention are written down
Why: an organisation that must keep records of processing (every one that processes personal data other than occasionally) takes those records from somewhere; the requirements and the data model are that somewhere, and a reviewer can check them.
Source: Article 30(1) records of processing activities; Article 30(5) the exception for fewer than 250 persons, which does not apply when the processing is not occasional
Applies to: requirements

### LD-11 Private by default: nothing is shared, public or pre-ticked without the person's action
Why: data protection by design puts the safeguard in the design, not in a setting; by default personal data is not accessible to an indefinite number of people.
Source: Article 25(1) and 25(2) data protection by design and by default
Applies to: both

## What a reviewer checks
Questions to the requirements:
- Which fields in the data model are personal data (LD-01), and does each have a purpose a requirement names (LD-02)?
- Is there a field no purpose needs (LD-03)?
- Is there a requirement for seeing, correcting, exporting and erasing a person's data (LD-04, LD-06, LD-07, LD-08), and does the erasure requirement name the exception that blocks it and for how long (LD-07)?
- Does every entity with personal data have a retention rule (LD-05, LD-10)?
- Are the defaults private (LD-11)?

Questions to the code:
- Does any `console.log`, thrown error, page title or URL carry a name, an email, a phone number or an address (LD-09)?
- Does a delete leave a copy under another key, in a cache or in an index (LD-04, LD-07)? Does a refused erasure say why (LD-07)?
- Is the export a structured file with every personal data field (LD-08)?
- Is there a test per rule the slice touches whose assertion fails if the rule is broken?
