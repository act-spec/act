---
id: marketing/pricing
type: page
title: Pricing — three plans, no surprises
summary: Pricing tiers for Acme. Public, deterministically built. Surfaces a marketing pricing-table block in the Plus mount.
---

Acme ships three tiers — Starter, Growth, and Enterprise — billed monthly with
no setup fees. Every tier includes the ACT runtime SDK, the static-export
generators, and the ACT-MCP bridge.

The static marketing build deterministically emits this node so that two
consecutive `act build` runs produce byte-identical output, satisfying
PRD-706-R16 / PRD-103-R4. Determinism is checked in the conformance gate.
