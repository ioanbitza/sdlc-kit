---
name: legal-licenses
user-invocable: false
description: Licence rules for what an app ships and depends on: SPDX identifiers, permissive versus copyleft versus network copyleft, what redistribution requires, fonts, icons, adapted content, a project without a LICENSE file. Rules LL-01 to LL-11. Read by the legal role and finder-legal. Not legal advice.
---

# Legal: licences

## What this covers
Every library, font, icon set and code snippet an app ships or depends on is someone's copyrighted work, used under a licence. This file says what each common licence asks for and what a reviewer checks, so that a dependency, a font or an adapted file does not put the project in breach. It is not legal advice; the human decides on any copyleft component, in an ADR. Sources are the SPDX License List (https://spdx.org/licenses/, version 3.29.0 at the time of writing), the licence texts as SPDX publishes them, and the Open Source Initiative list (https://opensource.org/licenses). https://choosealicense.com is a secondary pointer only.

## Rules
Rule ids are `LL-nn`. A finding cites one of them; the script refuses an id that is not here.

### LL-01 Every third-party component is named with its SPDX licence identifier
Why: "open source" is not a licence; `MIT`, `Apache-2.0`, `GPL-3.0-only` are. A component whose licence nobody can name cannot be checked against any rule below.
Source: SPDX License List, https://spdx.org/licenses/
Applies to: both

### LL-02 No licence means all rights reserved
Why: copyright exists without any formality, so a repository, a snippet or an image with no licence may not be copied, modified or redistributed; permission must come from the author, in writing.
Source: Berne Convention, Article 5(2), https://www.wipo.int/wipolex/en/text/283698; secondary: https://choosealicense.com/no-permission/
Applies to: both

### LL-03 A permissive licence travels with every copy: the copyright notice and the licence text stay
Why: MIT says the notice and the permission "shall be included in all copies or substantial portions of the Software"; BSD-2-Clause and BSD-3-Clause ask the same for source and binary forms, and BSD-3-Clause also forbids using the authors' names to promote the product. Dropping a licence header from a copied file breaks the one condition these licences have.
Source: https://spdx.org/licenses/MIT.html; https://spdx.org/licenses/BSD-2-Clause.html; https://spdx.org/licenses/BSD-3-Clause.html
Applies to: both

### LL-04 Apache-2.0 asks for the licence, change notices, retained notices and the NOTICE file, and grants a patent licence that ends if you sue
Why: section 4 lists what a redistribution must carry: a copy of the licence (a), prominent notices on modified files (b), the original copyright, patent, trademark and attribution notices (c), and a readable copy of the NOTICE file where one exists (d). Section 3 grants a patent licence that terminates for anyone who files patent litigation over the work.
Source: Apache License 2.0, sections 3 and 4, https://spdx.org/licenses/Apache-2.0.html
Applies to: both

### LL-05 MPL-2.0 is file-level copyleft: a modified MPL file stays under MPL with its source available; the rest of the work may use another licence
Why: section 3.1 keeps Covered Software in source form under the MPL, section 3.2 makes the source of an executable form available, and section 3.3 allows a Larger Work under terms of your choice as long as the MPL files keep theirs.
Source: Mozilla Public License 2.0, sections 1.10, 3.1, 3.2, 3.3, https://spdx.org/licenses/MPL-2.0.html
Applies to: both

### LL-06 LGPL: a library may be used by a work under another licence if the notice and the licence are given and the user can replace or relink the library; a modified library stays LGPL
Why: LGPL-3.0 section 4 and LGPL-2.1 section 6 allow a Combined Work under your own terms only with prominent notice that the library is used, a copy of the licence, and a way for the user to relink or swap the library (a shared library mechanism, or the minimal corresponding source).
Source: https://spdx.org/licenses/LGPL-3.0-only.html, section 4; https://spdx.org/licenses/LGPL-2.1-only.html, section 6
Applies to: both

### LL-07 GPL: a distributed work that includes GPL code is licensed as a whole under the GPL, with its source
Why: section 5(c) requires licensing "the entire work, as a whole" under the GPL; section 6 requires conveying the machine-readable Corresponding Source. An MIT app cannot bundle a GPL library and stay MIT.
Source: GNU General Public License v3.0, sections 5 and 6, https://spdx.org/licenses/GPL-3.0-only.html
Applies to: both

### LL-08 AGPL: a modified AGPL program used over a network must offer its source to the remote users
Why: section 13 adds network interaction to the GPL: users who interact with a modified version remotely must be offered the Corresponding Source from a network server at no charge. Running it as a service is distribution in effect.
Source: GNU Affero General Public License v3.0, section 13, https://spdx.org/licenses/AGPL-3.0-only.html
Applies to: both

### LL-09 Fonts and icons are licensed works too
Why: a font under OFL-1.1 may be bundled and redistributed only if each copy contains the copyright notice and the licence, may not be sold by itself, keeps its Reserved Font Name rules, and stays under OFL; an icon set has a licence of its own (often MIT, CC-BY-4.0 or a proprietary one) read like a library's.
Source: SIL Open Font License 1.1, conditions 1, 2, 3 and 5, https://spdx.org/licenses/OFL-1.1.html; https://spdx.org/licenses/CC-BY-4.0.html
Applies to: both

### LL-10 Content adapted from another project keeps its notice
Why: adapting is copying; the notice names what was adapted, from whom and under which licence, where the adapted text lives. The kit's own `skills/ui-ux/SKILL.md` is the example: "Adapted from UI UX Pro Max by nextlevelbuilder (https://github.com/nextlevelbuilder/ui-ux-pro-max-skill, MIT)", with the MIT notice condition behind it.
Source: MIT License, the notice condition, https://spdx.org/licenses/MIT.html; the kit's `skills/ui-ux/SKILL.md`
Applies to: both

### LL-11 The project has a LICENSE file, and what it ships is compatible with it; a copyleft component is a human decision
Why: without a LICENSE file the project itself is all rights reserved (LL-02), so nobody, not even a colleague, may legally use it. A GPL or AGPL dependency changes the licence of the whole work (LL-07, LL-08): the finder flags it, the human decides in an ADR, the builder never adds it on its own.
Source: Berne Convention, Article 5(2); GPL-3.0 section 5(c); OSI approved licences, https://opensource.org/licenses
Applies to: both

## What a reviewer checks
Questions to the requirements:
- Does the brief or a decision name a library, a font, an icon set, a snippet or a design adapted from elsewhere? Is its licence named by SPDX identifier (LL-01), and is it one the project can use (LL-05 to LL-08, LL-11)?
- Does the project have a LICENSE file and does `ADR-001` say what it is (LL-11)?
- Is a component with no licence treated as all rights reserved (LL-02)?

Questions to the code:
- Was a file, a function or a stylesheet copied or adapted without its copyright notice and licence text (LL-03, LL-04, LL-10)?
- Was a dependency, a font or an icon added without its licence in the repository (LL-01, LL-09)? Was a NOTICE file or a licence header removed (LL-04)?
- Does a copyleft component appear in a non-copyleft project without an ADR (LL-11)?
