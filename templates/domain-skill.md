---
name: domain-<area>
description: <How this domain works in this project, in one sentence: what the rules below cover and who reads them (the domain expert, finder-domain, the builder).>
---

## What this domain is
<Two to five lines: what the app handles in this domain, for whom, and what a mistake costs (a wrong invoice total, a gap in the numbering).>

## Terms
- <term>: <the one meaning it has in this project; the word the code and the screen must use>
- <term>: <...>

## Rules
<One rule per heading, numbered D-01, D-02, ... in one sequence. The domain expert and finder-domain cite them by id; a finding with an id that is not here is refused by the script. Legal rules are not domain rules: the kit's legal skills use LD-nn (data protection), LL-nn (licences) and LE-nn (e-invoicing), and a project legal skill under .claude/skills/legal-<area>/ follows templates/legal-skill.md with its own L?-nn prefix. A national retention period or a numbering rule the law fixes may live here as a D-nn; the legal skill then points at it.>

### D-01 <The rule in one sentence, as a fact: "Money is kept in integer cents">
Why: <what goes wrong without it, in the user's world>
Source: <where it comes from: the brief, an ADR, a law or standard by name, the accountant>

### D-02 <...>
Why: <...>
Source: <...>

## What a reviewer checks
<Three to six lines a reviewer can run on a requirement, a data model or a diff: "every money field is an integer", "an issued invoice has no setter", "the sequence has no gap after a delete".>
