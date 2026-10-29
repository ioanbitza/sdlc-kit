---
name: legal-e-invoicing
user-invocable: false
description: The legal frame an invoice feature must fit, from the EU VAT Directive (2006/112/EC, Articles 217 to 248) and the e-invoicing standard EN 16931 (Directive 2014/55/EU): mandatory content, numbering, integrity after issue, storage, acceptance of electronic invoices. Rules LE-01 to LE-08. Not legal advice; accounting practice lives in the project's domain skill.
---

# Legal: e-invoicing

## What this covers
What the law requires of an invoice, as opposed to how accounting practice handles it. The content an invoice must carry, the numbering, the integrity after issue and the storage come from Council Directive 2006/112/EC (the VAT Directive), Title XI, Chapter 3, Articles 217 to 248, read in the consolidated text of 01.01.2025: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101. The European e-invoicing standard, EN 16931, comes from Directive 2014/55/EU on electronic invoicing in public procurement: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0055. National rules (the retention period, the VAT rates, the number series format, rounding) are not here: a project's domain skill (`.claude/skills/domain-<area>/SKILL.md`, `D-nn` rules) carries them and this file points at it. It is not legal advice; the human decides.

## Rules
Rule ids are `LE-nn`. A finding cites one of them; the script refuses an id that is not here.

### LE-01 An invoice carries the details Article 226 requires
Why: the date of issue (1); a sequential number that uniquely identifies it (2); the supplier's VAT identification number (3); the customer's VAT number where the customer is liable for the VAT (4); the full name and address of both (5); the quantity and nature of the goods or the extent and nature of the services (6); the supply date when it differs from the date of issue (7); the taxable amount per rate, the unit price exclusive of VAT and any discount (8); the VAT rate (9); the VAT amount (10); the exemption reference where the supply is exempt (11). A data model that cannot hold one of them cannot issue a lawful invoice.
Source: Article 226, Directive 2006/112/EC (consolidated 01.01.2025), https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006L0112-20250101
Applies to: both

### LE-02 Invoice numbers are sequential, from one or more series, and unique
Why: Article 226(2) asks for "a sequential number, based on one or more series, which uniquely identifies the invoice": no reuse, no number taken by two documents, no gap made by a delete. The series format and what happens to a cancelled number are the domain skill's.
Source: Article 226(2), Directive 2006/112/EC
Applies to: both

### LE-03 An issued invoice does not change; a correction is a new document that refers to it
Why: Article 233(1) requires the integrity of the content ("the content required according to this Directive has not been altered") from issue until the end of the storage period. Article 219 treats a document that amends and refers unambiguously to the initial invoice as an invoice: that is the credit note or corrective invoice, not an edit in place.
Source: Article 233(1) and Article 219, Directive 2006/112/EC
Applies to: both

### LE-04 Authenticity of origin, integrity of content and legibility are ensured by business controls with an audit trail
Why: each taxable person chooses how, and "any business controls which create a reliable audit trail between an invoice and a supply" suffice; an advanced electronic signature or EDI are examples, not obligations. The app's part is to keep who issued what, when, from which order.
Source: Article 233(1) and 233(2), Directive 2006/112/EC
Applies to: both

### LE-05 An electronic invoice is one issued and received in any electronic format, and its use needs the recipient's acceptance
Why: Article 217 defines it; Article 218 makes paper and electronic equal when the chapter's conditions are met; Article 232 makes the electronic form subject to the recipient's acceptance, so a requirement that sends invoices by email or download needs the customer's agreement somewhere in the flow.
Source: Articles 217, 218 and 232, Directive 2006/112/EC
Applies to: requirements

### LE-06 Invoices issued and received are stored for the national period and retrievable without undue delay
Why: Article 244 requires storing copies of every invoice issued and received; Article 245(1) lets the taxable person choose the place if the invoices are available to the authorities without undue delay; Article 247(1) leaves the period to each Member State, and 247(2) lets it require the original form. The period and the form are national: the domain skill or an ADR names them, this rule requires that they exist and that the app can retrieve an invoice for the whole period.
Source: Articles 244, 245(1), 247(1) and 247(2), Directive 2006/112/EC
Applies to: both

### LE-07 Retention beats erasure: personal data on a stored invoice stays for the retention period, and the app says so
Why: the legal obligation to store invoices (LE-06) is the exception that lets a controller refuse erasure for that data, under GDPR Article 17(3)(b). The customer's other data is still erased; the invoice is not, and the refusal names the obligation. See `LD-07` in `legal-data-protection`.
Source: Article 244, Directive 2006/112/EC; Article 17(3)(b), Regulation (EU) 2016/679, https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679
Applies to: both

### LE-08 An invoice to a public buyer is a structured electronic invoice that follows EN 16931
Why: Directive 2014/55/EU defines an electronic invoice as one "issued, transmitted and received in a structured electronic format which allows for its automatic and electronic processing" (Article 2(1)), and contracting authorities must receive and process invoices that comply with the European standard and one of the listed syntaxes (Article 7). The standard is EN 16931-1:2017 (the semantic data model of the core elements) with the syntax list in CEN/TS 16931-2:2017, whose references the Commission published in Decision (EU) 2017/1870. A PDF by email is not that. A future invoice feature for public buyers is designed against the standard's core elements, which include everything in LE-01.
Source: Directive 2014/55/EU, Articles 2(1), 3 and 7, https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0055; Commission Implementing Decision (EU) 2017/1870, https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32017D1870
Applies to: requirements

## What a reviewer checks
Questions to the requirements:
- Does the data model hold every Article 226 detail an invoice needs (LE-01)? Does the numbering requirement say sequential and unique, and what a cancelled number becomes (LE-02)?
- Is there a requirement that an issued invoice is read-only and that a correction is a new document (LE-03)? Who issued it, when, from what (LE-04)?
- Does the flow include the customer's acceptance of electronic invoices (LE-05)? Is the retention period named, by the domain skill or an ADR (LE-06), and does erasure respect it (LE-07)?
- If public buyers are in scope, does the plan name EN 16931 (LE-08)?

Questions to the code:
- Can an issued invoice be edited, or its lines changed through the order (LE-03)? Is there a test that refuses the change?
- Does the sequence reuse a number or leave a gap after a delete, a reload or two creates (LE-02)?
- Can the code create an invoice without a mandatory detail (LE-01)? Can a stored invoice be retrieved after the customer is erased (LE-06, LE-07)?
