# Security Policy

The ACT (Agent Content Tree) project takes security seriously. This document describes which versions receive security fixes and how to report a vulnerability responsibly.

## Supported versions

| Version | Status |
|---|---|
| 0.2.x | Supported. Security fixes are released as patch versions. |
| < 0.2 | Internal candidate, no security support. Pre-0.2 builds were never published as a public release; please upgrade to 0.2.x. |

When 0.3.x ships, 0.2.x will continue to receive critical security fixes for a transition period announced at the time of release.

## Reporting a vulnerability

**Please do not file public GitHub issues for security bugs.** Public reports give attackers a head start and make coordinated remediation much harder.

You have two private channels to choose from:

1. **Email (preferred)** — write to **security@act-spec.org**. This address is monitored by the project maintainers. Encrypted mail is welcome; see the PGP key section below.
2. **GitHub Private Vulnerability Report** — use the "Report a vulnerability" button on the [Security tab](https://github.com/act-spec/act/security) of the `act-spec/act` repository. This routes the report to maintainers via GitHub's private advisory workflow.

In your report, please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, ideally including a minimal proof-of-concept.
- Affected versions or commits, if known.
- Any mitigations you have already identified.
- Whether you would like to be credited in the published advisory, and if so, how.

## Disclosure timeline

We aim to:

- **Acknowledge** every report within **14 days** of receipt.
- **Remediate or coordinate disclosure** within **90 days** of acknowledgement.

For high-severity issues we will move faster. If a fix requires more than 90 days for legitimate reasons (for example, coordinating with downstream packagers), we will tell you and agree on a revised timeline.

We follow standard coordinated-disclosure practice: a private fix lands first, a release goes out, and a public security advisory and CVE are published once users have had a reasonable window to upgrade.

## PGP key

<!-- TODO(maintainer): publish PGP fingerprint for security@act-spec.org -->

If you need to send encrypted mail before the project key is published, request the current key out-of-band from a maintainer and we will share it directly.

## Hall of fame

We are grateful to the researchers and contributors who report issues responsibly. Coordinators who report a confirmed vulnerability will, with their consent, be credited in the published security advisory and in the project's release notes.
