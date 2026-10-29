---
name: legal-<area>
description: <The legal rules this project adds to the kit's, in one sentence: which law or contract they come from and who reads them (the legal role, finder-legal).>
---

## What this covers
<Two to five lines: which obligation the app must keep that the kit's legal skills (legal-data-protection LD-nn, legal-licenses LL-nn, legal-e-invoicing LE-nn) do not cover: a national law, a sector rule, a contract clause, a licence the project negotiated. Say that it is not legal advice and that the human decides.>

## Rules
<One rule per heading. The id is a two-letter prefix that starts with L, then a number: `LX-01`, `LX-02`, ... in one sequence. Pick a prefix the kit does not use (not LD, LL or LE), so a finding names one skill. The legal role and finder-legal cite the rules by id; the script refuses an id no legal skill defines.>

### LX-01 <The rule in one sentence, as an obligation: "An invoice is kept for ten years from the end of the fiscal year">
Why: <what goes wrong without it, in the user's world>
Source: <the primary source, with the link: the article of the law on legislatie.just.ro or eur-lex.europa.eu, the clause of the contract, the licence text>
Applies to: <requirements|code|both>

### LX-02 <...>
Why: <...>
Source: <...>
Applies to: <...>

## What a reviewer checks
<Three to six lines a reviewer can run on a requirement, a data model or a diff: "every invoice has a retention end date", "the erasure path refuses an invoice younger than ten years and says why".>
