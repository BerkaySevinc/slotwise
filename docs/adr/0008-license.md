# ADR-0008: License

## Status

Accepted

## Context

The repository is public from the first day, as a portfolio project. Without a license the default is "all rights reserved": anyone can read the code, but nobody may use, copy or change it. A license has to be chosen, and it has to fit two things at once: a portfolio that people can inspect and reuse, and the possibility that Slotwise becomes a real hosted product (a pilot with a business, later maybe paying customers).

The choice has a cost that is easy to miss. Code that has been released under a permissive license stays available under it for everyone who already has a copy. Later versions can be relicensed only by the holder of the copyright, and only for code the holder wrote or has the contributors' agreement for.

## Decision

- Use the **MIT License** for now. It is in `LICENSE` and named in the README, `package.json` and `api/openapi.yaml`.
- Treat it as a starting point that can be changed, not as a final choice. **Revisit it before any of these happens:** the first paying customer, accepting code from outside contributors, a competitor hosting the code as a service, or a wish for an explicit patent grant.
- Candidates for a later license:
  - **Apache-2.0**: still open source, adds an explicit patent grant.
  - **Functional Source License (FSL)** or **PolyForm Shield**: source-available, forbid use that competes with Slotwise. FSL turns into an open license after two years.
  - **AGPL-3.0**: open source, but anyone who runs a modified version as a network service must publish their changes.
- Until the license is settled for good, **do not merge code from outside contributors** without a written agreement that lets the owner relicense it (a contributor agreement). Otherwise the owner could no longer change the license for that code alone.
- A change of license is a new ADR that supersedes this one. Do not copy third-party or proprietary code into the repository (see `CLAUDE.md`), so that the owner keeps the right to relicense what is here.

## Consequences

- Anyone may use, copy, change and sell the code, including in a closed product and including a competing hosted service, as long as the copyright and license notice stay with it. There is no warranty and no liability.
- MIT does not mention patents, and it does not cover the name or logo of the project.
- Copies taken under MIT keep that license. A later switch only applies to versions released after it.
- Dependencies must have licenses that allow this. Checked on 2026-10-22: every installed package is permissive (MIT, Apache-2.0, ISC, BSD, MIT-0, 0BSD, BlueOak), except `lightningcss` (MPL-2.0, a file-level copyleft), which only the test tooling uses during development and which is not part of any shipped bundle. Check new dependencies when they are added.
- Switching to a source-available license later would no longer be "open source" in the sense of the OSI definition, which can matter for how the project is seen.

## Alternatives considered

- **No license:** nobody could legally use the code, and a public repository without a license looks unfinished.
- **Apache-2.0 now:** a good fit and only slightly longer, but the patent grant is not needed yet for a project like this.
- **AGPL-3.0 now:** discourages hosted competitors, but also discourages everyone else, including employers who want to reuse parts of it.
- **FSL or PolyForm Shield now:** the right tools if the main goal were to protect a commercial product. The goal today is a portfolio and a pilot, so the lower-friction MIT was chosen, with the door left open.
- **A private repository:** conflicts with the decision to be public from day one.
