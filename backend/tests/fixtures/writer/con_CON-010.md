---
id: CON-010
title: "technology: SSO must use SAML 2.0 with Okta; alternative auth "
type: technology
status: confirmed
date: 2026-04-08
category: constraint
tags: [constraint, technology, confirmed]
aliases: [CON-010]
cssclasses: [constraint, node-cyan]
---

# CON-010: technology constraint

SSO must use SAML 2.0 with Okta; alternative auth protocols are excluded.

## Impact
Forces SAML 2.0 implementation; OAuth2-only or custom auth not viable.

## Source
> "The system MUST support single sign-on via SAML 2.0 because all our users authenticate through Okta. This is non-negotiable."

## Affected Requirements
- [[BR-022]] — constrained
- [[BR-023]] — constrained
- [[BR-024]] — constrained
