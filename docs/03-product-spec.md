# 03 — Product spec: Fakelos

## Name

**Fakelos** (Φάκελος) — Greek for "the file" or "the dossier." Greek property owners
already say *ο φάκελος του ακινήτου* — "the property file" — for the bundle of documents
you must produce when someone official asks. The product is named after the thing the law
demands you have. It is pronounceable for the large foreign-owner segment (fa-KEH-los) and
it is not taken by an incumbent in this niche.

**Tagline (GR):** Ο φάκελος του ακινήτου σου, πάντα έτοιμος.
**Tagline (EN):** Your property file, always inspection-ready.

---

## The job to be done

> "The Ministry can show up with 10 days' notice and fine me €5,000. I think I'm fine. I
> am not actually sure I'm fine. And I have no idea where the pest control certificate
> from last March is."

Fakelos answers three questions and nothing else:

1. **Am I compliant right now?** — a score, and a list of exactly what is missing
2. **What do I have to do this winter, and when?** — a dated plan, not a checklist
3. **Can I prove it in 30 seconds?** — one link, one PDF

Everything the product does must serve one of those three. Anything else is a PMS, and
building a PMS against Hostaway is how this dies.

---

## Target audience

### Primary ICP — "the accidental host"

Owns 1–3 properties. Inherited the family place on the island, or bought a flat in Athens
in the 2010s. Not a professional. Uses Airbnb's app and an accountant, nothing else.
Earns €10k–30k a year from it, so a €5,000 fine is between two and six months of gross
revenue. Learned about the October 2025 rules from a Facebook group and has been quietly
anxious ever since.

- **Where they are:** Greek Facebook groups (Airbnb Ελλάδα hosts, Βραχυχρόνια Μίσθωση),
  their accountant's office, r/greece, expat forums
- **Language:** Greek first, English second — the product must ship bilingual on day one
- **Willingness to pay:** €9/month is one hour of cleaner time. Trivially justified
  against a €5,000 fine. €99/month is not.

### Secondary ICP — "the co-host" (where the revenue actually is)

Manages 5–30 properties for other owners in Chania, Rethymno, Athens, Paros, Arachova.
Compliance failure is *their* professional liability, not just a cost. They need to prove
to owners that the property is safe and legal. They will pay €29–79/month without
hesitation because one lost management contract costs more than a year of subscription.

**Fewer than 200 of these customers is a real business.** Design the multi-property view
early even though the free tier is single-property.

### Tertiary — "the absent foreign owner"

Diaspora Greeks, British and German owners. Cannot physically check anything. Highest
anxiety, lowest ability to act. Best served in v2 by the caretaking module (problem #2),
and best reached through the co-hosts who already work for them.

### Explicitly not the ICP

Hotels (different law, different fee schedule, sold to by real sales teams) and 30+
property agencies (want API and PMS integration). Both are v3 conversations at the
earliest.

---

## Feature spec

### MVP — the only things in v1

**F1. Property setup**
Type (apartment / detached house / villa / rooms), size in m², region, altitude above
600 m, number of bedrooms, AMA number, season open and close dates. Six fields drive every
rule in the system.

**F2. Compliance scorer**
Walks the Law 5170/2025 requirement catalog (`data/compliance-rules.json`), applying only
the rules that match the property — air conditioning is skipped above 600 m, extinguisher
count scales per 100 m². Returns:
- a 0–100 score
- per-requirement status: OK / expiring / missing / not applicable
- **estimated fine exposure**, which is the number that makes people act

**F3. The dossier**
One record per requirement: document upload, issue date, expiry date, issuing company,
cost paid. This is the core asset. Everything else is a view over it.

**F4. Expiry radar** ← *the retention engine*
Every document has an expiry. Automated email at **T-60, T-30 and T-7 days**, plus a
monthly "state of your properties" digest on the 1st. This is the single feature that
converts a one-time checkup into a subscription — without it, the user solves their
problem once and churns.

**F5. Winter work plan**
Generates a dated Nov–Mar task sequence working backwards from the season-open date, with
the long-lead items first (electrician's declaration, insurance quotes) and the cheap fast
ones last (first-aid kit, emergency contact card). Rendered as a calendar and exportable
to .ics.

**F6. Inspection pack**
One click → a PDF with the property details, the AMA, every valid certificate, and a
generated cover sheet. Also a shareable read-only link. This is what you open when the
inspector calls, and what you send your accountant in April.

**F7. ΤΑΚ calculator**
Nightly Climate Resilience Fee by property type and season, monthly total, and a reminder
before the last-day-of-following-month declaration deadline.

**F8. Multi-property dashboard**
A table of every property with score, next expiry and fine exposure. Ships in v1 because
it is what converts the €29 tier.

### Deliberately out of scope for v1

Bookings, calendars, channel management, pricing, messaging, cleaning schedules, actual
myDATA transmission, e-signatures, insurance underwriting. Every one of these is a
different company.

---

## User stories

```
As an accidental host,
  when I finish a 4-minute questionnaire,
  I see a score, a fine exposure number, and the three things I'm actually missing —
  so I finally know where I stand.

As an accidental host,
  60 days before my pest control certificate expires,
  I get an email in Greek telling me to book it and roughly what it costs —
  so I never discover it during an inspection.

As a co-host with 14 properties,
  when I open the dashboard,
  I see which of my 14 have a red status and what the total fine exposure is —
  so I can fix the worst one first and show the owner I'm on top of it.

As a host who just got an inspection notice,
  when I tap "Inspection pack",
  I get a PDF with every certificate in it —
  so I spend the 10 days fixing gaps instead of hunting for PDFs in my email.
```

---

## Data model

Four tables. This maps directly onto Airtable or Baserow.

```
USERS                  PROPERTIES              DOSSIER_ITEMS          RULES (static)
─────                  ──────────              ─────────────          ─────────────
id                     id                      id                     code
email                  user_id      ──┐        property_id  ──┐       title_en / title_el
locale (el|en)         name           │        rule_code     │       category
plan                   type           │        status        │       applies_if
stripe_customer        size_sqm       │        issued_on     │       validity_months
created_at             region         │        expires_on    │       typical_cost_eur
                       altitude_m     │        provider      │       lead_time_days
                       bedrooms       │        cost_eur      │       fine_band
                       ama_number     │        file_url      │
                       season_open  ──┘        notes       ──┘
                       season_close
```

`RULES` is static config shipped as JSON, not user data — which is why the whole rule
engine can live in a single HTML file in the prototype and in one Airtable table in
production. When the law changes, you edit one file and every customer is updated.

---

## The moat

Honestly assessed, because a no-code compliance checklist is not defensible on its own:

1. **Rule-set freshness.** Greek STR law changed in 2024, 2025 and 2026. Being the tool
   that is correct the week a rule changes is a real, ongoing advantage — and it is
   maintained by attention, which is exactly what a solo founder has and a global PMS
   does not.
2. **The dossier is switching cost.** Once three years of certificates, dates and receipts
   live in Fakelos, leaving means rebuilding the archive.
3. **Insurance distribution.** The law forces every host to buy liability cover. Being the
   place where 5,000 hosts discover they need it is a durable position — see
   `05-monetization.md`.
4. **Language and locality.** Bilingual, Greek-first, with Greek cost benchmarks and
   provider lead times. Global tools will not do this for a 160,000-listing market.

None of these are defensible for five years. They are defensible for the two years it
takes to get to #2 and #3 on the roadmap, which is all an MVP needs.
