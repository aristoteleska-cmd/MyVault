# 04 — Build guide: shipping Fakelos on €0

Everything below runs on free tiers. Total cost to launch: **€0**, plus about €12 if you
want a `.gr` domain, which you should.

---

## The stack

| Layer | Tool | Free tier | Why this one |
|---|---|---|---|
| Database | **Airtable** | 1,000 records/base | Best Softr integration. Swap to **Baserow** or **NocoDB** if you outgrow it — same shape |
| App UI | **Softr** | 1 published app, 5 users | Real auth, user-specific record filtering, no code. The user-gating is the part that matters |
| Automation | **Make** | 1,000 ops/month | Reminder engine. **n8n** self-hosted if you exceed it |
| Payments | **Lemon Squeezy** | No monthly fee, ~5% + 50c | **Merchant of record — it handles EU VAT/OSS for you.** Do not use raw Stripe for this |
| Email | **Brevo** | 300/day | Transactional + campaigns in one, EU-hosted |
| Landing page | **Carrd** or **Framer** | Free tier | The lead magnet lives here |
| Forms | **Tally** | Unlimited | The free compliance check |
| PDF generation | **Make PDF module** / **DocsAutomator** | Limited free | Inspection pack |
| Files | Airtable attachments | 1 GB | Certificates. Move to Cloudflare R2 at scale |
| Support | **Crisp** | 2 seats | Greek-language chat matters more than you think |
| Analytics | **Umami Cloud** | Free tier | GDPR-clean, no cookie banner needed |

**The one paid thing worth buying early:** a `.gr` domain (~€12/yr). Greek hosts trust a
`.gr` in a way they do not trust a `.io`.

---

## Build order — roughly two weeks part-time

### Day 1–2 · Airtable base

Create four tables matching the data model in `03-product-spec.md`:

- **Users** — email, locale, plan, lemonsqueezy_id
- **Properties** — name, type, size_sqm, region, altitude_m, bedrooms, ama_number,
  season_open, season_close, link to Users
- **Dossier_Items** — link to Properties, rule_code, status, issued_on, expires_on,
  provider, cost_eur, file attachment
- **Rules** — import `data/compliance-rules.json` directly as CSV

Add three formula fields to **Dossier_Items** — these do the entire compliance engine
without a line of backend code:

```
days_to_expiry  = DATETIME_DIFF({expires_on}, TODAY(), 'days')

status_calc     = IF({expires_on} = BLANK(), "missing",
                  IF({days_to_expiry} < 0,  "expired",
                  IF({days_to_expiry} < 30, "expiring", "ok")))

fine_exposure   = IF(OR({status_calc}="missing", {status_calc}="expired"), 5000, 0)
```

Then a rollup on **Properties**: count of non-OK items → drives the score.

That's it. The "compliance engine" is three formulas.

### Day 3–5 · Softr app

Pages to build, in this order:

1. **Sign up / log in** — Softr built-in auth
2. **My properties** — list block, filtered to logged-in user, with the score badge
3. **Add property** — form block writing to Properties
4. **Property detail** — the dossier: list of Dossier_Items with inline edit + upload
5. **Winter plan** — same records, calendar view, sorted by due date
6. **Inspection pack** — button triggering the Make webhook

Gate pages 4–6 behind a paid plan using Softr's conditional visibility on the `plan`
field. Free users see their score and what's missing, but cannot store documents. **That
gate is the entire business model** — the free tier delivers the anxiety, the paid tier
delivers the relief.

### Day 6–7 · The reminder engine (Make)

This is the retention feature. Build one scenario, run it daily at 08:00 EET:

```
Schedule (daily 08:00)
   ↓
Airtable → Search Dossier_Items
   where days_to_expiry ∈ {60, 30, 7}
   ↓
Iterator
   ↓
Router ─── locale = "el" ──→ Brevo: send Greek template
       └── locale = "en" ──→ Brevo: send English template
   ↓
Airtable → log reminder_sent_at
```

A second scenario on the 1st of each month sends the portfolio digest. A third, on the
25th, sends the ΤΑΚ declaration reminder.

Ops budget check: 1,000 Make operations covers roughly 400–600 reminder emails a month,
which is comfortably enough for the first few hundred customers. When you outgrow it,
self-host n8n on a €5 VPS rather than upgrading Make.

### Day 8–9 · Payments

Lemon Squeezy products: Host Monthly €9, Host Annual €89, Manager Monthly €29, Manager
Annual €290. Webhook → Make → update `plan` in Airtable. Softr reads `plan` and unlocks.

**Use Lemon Squeezy rather than Stripe.** As merchant of record it handles EU VAT
registration, OSS filings and invoicing. For a Greek founder selling to Greek and EU
customers this removes a genuinely painful compliance problem — which would be an
embarrassing thing for a compliance product to get wrong.

### Day 10–11 · Inspection pack PDF

Make scenario: webhook from Softr → fetch property + valid dossier items → PDF module →
upload to Airtable → return link. Cover sheet, property details, AMA, then one page per
certificate.

### Day 12–14 · Landing page and the free check

Carrd page with the pitch, and the **free compliance check** as the top call to action.
Either embed `app/index.html` from this repo directly, or rebuild the questions as a Tally
form. The prototype in this repo is already the better version — it computes fine exposure
and generates the winter plan client-side.

Flow: free check → score + fine exposure shown → email capture to see the full report →
Brevo sequence → paid conversion.

---

## Bilingual from day one

Not optional. The primary ICP reads Greek; a meaningful minority of owners read only
English. Options in order of preference:

1. Softr's native multi-language, if it covers your blocks
2. Duplicate page sets at `/el/*` and `/en/*`, switched on the user's `locale` field
3. Browser-language detection on the landing page only

Every email template needs both versions. Every rule in `compliance-rules.json` already
carries `title_el` and `title_en` — that was deliberate.

---

## When to leave no-code

Do not rewrite this in React because it feels more legitimate. Migrate only when you hit a
real wall:

| Signal | Move |
|---|---|
| >1,000 records in a base | Baserow or Postgres + Supabase |
| Make ops exceeded | Self-hosted n8n |
| Softr per-user pricing bites | Next.js + Supabase, keep Airtable as admin |
| Customers ask for an API | You have a real business — hire someone |

Realistically the no-code stack carries you to **€3–5k MRR**. Rewriting before that is
procrastination wearing an engineer's hat.

---

## Rule-set maintenance — the actual operational risk

The product's value is being *correct*. Greek STR law moved in 2024, 2025 and 2026.

- Put `compliance-rules.json` under version control (it already is)
- Set a monthly calendar block to re-check AADE and Ministry of Tourism announcements
- Retain a Greek accountant to sign off the rule set quarterly — budget €100–200/quarter,
  and pay for it out of the first 20 subscriptions
- Show `version` and `last verified` dates in the app footer, and email customers when the
  rule set changes

That last point is not just risk management. "We updated your compliance rules because the
law changed on 1 March" is the most retention-positive email this product can send.
