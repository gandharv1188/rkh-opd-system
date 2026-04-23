# DIS Security Review Checklist

Pre-launch security checklist for the Document Ingestion Service (DIS). Every item must be ticked before any tenant data flows through production. Re-run before each major release.

Related tickets: DIS-008 (RLS), DIS-055 (secrets adapter), DIS-090 (upload caps), DIS-097 (worker token), DIS-136 (operator auth), DIS-161 (PII redactor).

## RLS + Authz

- [ ] All `dis_*` tables have RLS policies enabled (M-008) and default-deny on anon
- [ ] Cross-patient reads denied at the adapter layer, not just the UI
- [ ] Internal endpoints require `X-Worker-Token` header (DIS-097) with constant-time compare
- [ ] Operator auth verified via sign-in flow (DIS-136); session cookies are HttpOnly + SameSite=Lax
- [ ] Service-role key is never exposed to the browser; only used inside Edge Functions
- [ ] Per-tenant row scoping enforced in every SELECT/UPDATE/DELETE path

## Secrets

- [ ] No secrets in logs (verified against DIS-161 PII redactor test fixtures)
- [ ] Secrets rotate via DIS-055 adapter 5-minute cache — no hard-coded fallbacks
- [ ] No secret values in git history (scanned with gitleaks / trufflehog)
- [ ] Client anon key is the only Supabase key shipped to the browser
- [ ] `.env*` files are gitignored; CI fails on committed `.env`
- [ ] Edge Function secrets set via `supabase secrets set`, not inline in code

## TLS

- [ ] HTTPS only; HTTP requests 301-redirect to HTTPS
- [ ] HSTS header set with `max-age>=31536000; includeSubDomains`
- [ ] Certificate pinning for ABDM gateway endpoints in server-to-server calls
- [ ] TLS 1.2+ only; legacy cipher suites disabled on custom domain
- [ ] Mixed-content warnings resolved (no `http://` assets on HTTPS pages)

## Input validation

- [ ] Zod schema on every HTTP handler (request body + query + headers)
- [ ] File uploads size-capped with 413 response (DIS-090)
- [ ] Content-type allowlist enforced server-side (magic-byte sniff, not just header)
- [ ] SSRF: no user-controlled URLs fetched from the API layer; outbound allowlist only
- [ ] Filename sanitised before Storage write (no traversal, no NUL, length bounded)
- [ ] Numeric and date inputs range-checked against CHECK constraints in schema

## XSS (verification UI)

- [ ] React auto-escapes by default; raw-HTML injection props are not used anywhere in `dis/ui`
- [ ] CSP header configured with `script-src 'self'`, no `unsafe-inline` in prod
- [ ] No inline `<script>` tags in production bundle
- [ ] User-supplied markdown rendered via allowlist sanitiser
- [ ] `esc()` applied to every `innerHTML` insertion in legacy `web/` pages

## Logging + audit

- [ ] Structured logs exclude PHI (names, DOB, UHID, ABHA) by default
- [ ] Audit trail for every `dis_*` mutation: actor, timestamp, before/after hash
- [ ] Failed auth attempts rate-limited and logged

## Dependencies

- [ ] `npm audit --production` clean at release cut
- [ ] Lockfile committed; CI rebuilds from lockfile only
- [ ] Third-party CDN scripts pinned with SRI hashes

## Sign-off

- Reviewer: _________________
- Date: _________________
- Release tag: _________________
