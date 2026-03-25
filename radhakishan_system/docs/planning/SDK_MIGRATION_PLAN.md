# SDK Migration Plan

## When to Move from Claude.ai to Claude SDK

---

## When to Migrate

Migrate when ANY of these conditions are met:

1. **Volume** — more than 150 prescriptions/day makes SDK more cost-effective
2. **Multi-doctor concurrent** — more than 2 doctors using simultaneously
3. **Mobile app needed** — Android / iOS for doctors on rounds
4. **HIS/EMR integration** — connect to hospital information system
5. **Legal digital signature** — DSC/PKI-based prescription signing
6. **Offline mode required** — no internet access in some clinic areas
7. **Knowledge base > 5MB** — formulary grows beyond browser storage limits

---

## What Transfers Directly (zero rework)

| Component                           | Transfer effort                           |
| ----------------------------------- | ----------------------------------------- |
| All system prompts / skill          | Direct copy → SDK system_prompt parameter |
| Supabase schema                     | Zero — unchanged                          |
| All patient/visit/prescription data | Zero — already in Supabase                |
| Formulary and standard Rx data      | Zero — already in Supabase                |
| Clinical rules and NABH logic       | Direct copy                               |
| Dose calculation formulas           | Direct copy to backend                    |

---

## What Needs Rebuilding

| Component              | Effort    | Notes                                          |
| ---------------------- | --------- | ---------------------------------------------- |
| Prescription Pad UI    | 2-3 weeks | Rebuild in React                               |
| Patient Lookup UI      | 1 week    | Rebuild in React                               |
| Formulary Manager UI   | 2 weeks   | Rebuild in React                               |
| Output / PDF rendering | 1 week    | Use Puppeteer for pixel-perfect PDF            |
| Voice dictation        | 2 days    | Upgrade to Whisper API (better Hindi accuracy) |
| QR code                | 1 day     | Same library, different integration            |

**Total estimated effort:** 6-8 weeks with 1 developer

---

## Recommended SDK Stack

```
Frontend (web)     React 18 + Vite
Frontend (mobile)  React Native (shared logic with web)
Voice              OpenAI Whisper API (en-IN model)
AI Generation      Anthropic SDK (claude-sonnet)
Backend            Node.js + Express (or Next.js API routes)
Database           Supabase (existing — no change)
PDF                Puppeteer + custom HTML template
QR Code            qrcode npm package
Hosting (frontend) Vercel (free CDN)
Hosting (backend)  Railway (~$5/month)
Auth               Supabase Auth (doctor login)
```

---

## Cost Comparison at Scale

### 100 prescriptions/day

**Claude.ai Max Plan:**

- Fixed: current subscription cost
- Variable: $0 (included in plan)

**SDK:**

- Claude API: ~$0.036 × 100 = ~$3.60/day = ~$108/month
- Railway hosting: $5/month
- Supabase Pro: $25/month
- Vercel: $0 (free tier)
- **Total: ~$138/month**

### Decision point: Compare your Max Plan cost to $138/month

---

## Migration Checklist

- [ ] Pilot validated with real doctors
- [ ] > 3 months of production prescription data
- [ ] Developer hired / identified
- [ ] Mobile app requirements confirmed
- [ ] Legal digital signature requirements confirmed
- [ ] HIS integration requirements confirmed
- [ ] Funding secured for development
- [ ] Export all data from Supabase (backup)
- [ ] Copy all skills/prompts to new system
- [ ] Parallel run period (both systems simultaneously for 2 weeks)
- [ ] Formal handover and training

---

_Radhakishan Hospital | SDK Migration Reference | Edition 2026_
