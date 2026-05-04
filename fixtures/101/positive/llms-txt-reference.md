# Acme Docs

> Documentation for Acme widgets.

This site provides an ACT (Agent Content Tree) feed:

- [ACT Manifest](/.well-known/act.json)

<!--
Positive fixture for PRD-101. A static site's /llms.txt that references
the ACT manifest at the well-known path. Per PRD-101-R3, this is SHOULD,
not MUST — sites MAY omit the link without losing conformance, but tooling
that scans /llms.txt for ACT signals will find it here. The link target
MUST be `/.well-known/act.json` (path-locked per decision Q2 and PRD-101-R1).
-->
