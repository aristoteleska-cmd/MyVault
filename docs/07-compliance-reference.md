# 07 — Compliance reference

> ⚠️ **This is a working research summary, not legal advice.** Compiled from public
> secondary sources in August 2026. Greek short-term rental law changed materially in
> 2024, 2025 and 2026 and continues to move. Verify everything here against AADE, the
> Ministry of Tourism, and a Greek accountant before shipping it to a paying customer.
> Items marked ⚠️ are inconsistently reported across sources and need confirmation first.

This document is the human-readable twin of [`data/compliance-rules.json`](../data/compliance-rules.json).
When one changes, change the other.

---

## 1. Registration — the AMA

Every short-term rental property must hold an **AMA** (Αριθμός Μητρώου Ακινήτου) issued by
AADE's short-term rental registry, and display it on every platform listing.

**Registration freezes:**

| Area | Status |
|---|---|
| Athens municipal districts 1, 2, 3 (Plaka, Koukaki, Kolonaki, Exarcheia, Pagrati) | New AMA registrations blocked through end-2026 |
| Parts of central Thessaloniki | Blocked from 2026-03-01 |

In these "saturated" zones the AMA is **decoupled from the property** — it does not
transfer automatically on sale or inheritance. This materially changes what a buyer is
purchasing and is worth a dedicated content piece.

Enforcement is real: 96% of active Athens listings show registration evidence as of early
2026.

---

## 2. Property standards — Law 5170/2025, in force 2025-10-01

### Habitability

| Requirement | Threshold |
|---|---|
| Primary-use spaces only | Storage rooms, basements and garages may not be let |
| Ceiling height | ≥ 2.5 m |
| Bedroom natural light | Windows ≥ 10% of floor area |
| Natural ventilation | Openings ≥ 5% of floor area |
| Air conditioning | Mandatory, **except mountain areas above 600 m** |

The first four are structural. If a property fails them it cannot be legally let, and no
amount of paperwork fixes it — which is why the app surfaces these first and separately.

### Safety equipment

| Requirement | Detail |
|---|---|
| Fire extinguishers | ≥ one 6 kg portable unit per 100 m² gross floor area |
| Smoke detectors | Autonomous units in **bedrooms and kitchen** |
| Emergency lighting | At all exit points, functioning during a power cut |
| Escape signage | Clearly marked throughout |
| First-aid kit | Antiseptics, gauze, bandages, gloves, ammonia sticks — labelled in **Greek and English** |
| Emergency contacts | Posted visibly: police, fire, ambulance, hospital, taxi |

### Certificates and insurance

| Requirement | Detail | Validity |
|---|---|---|
| Civil liability insurance | From a **licensed Greek insurer**, covering guest and third-party damage | 12 months |
| Electrician's declaration (ΥΔΕ) | Confirms a residual-current device is installed and working | ⚠️ commonly cited as 14 years for domestic installations; shorter periods reported for rental use |
| Pest control certificate | Disinfestation by an **authorised company** | ⚠️ commonly 12 months |

---

## 3. Inspection and penalties

- **Inspecting bodies:** joint Ministry of Tourism and AADE
- **Notice period:** 10 days
- **Payment window:** 15 days, then compulsory collection

| Violation | Fine |
|---|---|
| First | **€5,000** |
| Second within 12 months | **€10,000** |
| Subsequent | **€20,000** |

The 10-day notice is the product's entire reason to exist. It is not enough time to source
an electrician, book pest control and buy compliant extinguishers on a Greek island in
February — the work has to already be done and the paperwork already findable.

---

## 4. Climate Crisis Resilience Fee (ΤΑΚ)

In force since 2024-01-01. Rates rose in January 2025 and are reported unchanged for 2026.
Charged **per night, per room or apartment unit**, collected from the guest, documented on
a special receipt, and remitted via **monthly declaration due the last day of the month
following** issuance.

### Rates for short-term rentals

| Property type | Apr–Oct | Nov–Mar |
|---|---:|---:|
| Short-term rental (standard) | €8.00 | €2.00 |
| Detached house 80 m²+ / holiday home 80 m²+ | €15.00 | €4.00 |
| Holiday home under 80 m² | €8.00 | €2.00 |
| Tourist villa | €15.00 | €4.00 |
| Furnished rooms / apartments | €2.00 | €0.50 |

### Hotel rates (reference only — out of scope)

| Class | Apr–Oct | Nov–Mar |
|---|---:|---:|
| 1–2 star | €2.00 | €0.50 |
| 3 star | €5.00 | €1.50 |
| 4 star | €10.00 | €3.00 |
| 5 star | €15.00 | €4.00 |

The **seasonal rate switch on 1 April and 1 November** is a predictable annual error, and a
free reminder email at both moments is excellent top-of-funnel.

---

## 5. Tax

Short-term rental income is taxed at **15–45%**. AADE announced sweeping digital audits for
2026 covering live platform listings and undeclared income from prior years.

Out of scope for the MVP — this is the accountant's job, and the accountant is a partner
rather than a competitor. See the accountant channel in `06-launch-plan.md`.

---

## 6. Adjacent: myDATA e-invoicing

| Milestone | Date |
|---|---|
| Mandatory B2B e-invoicing, businesses with 2023 revenue > €1m | 2026-02-02 |
| Mandatory B2B e-invoicing, all other businesses | 2026-10-01 |
| Transition period ends | 2026-12-31 |

Invoices not cleared through myDATA are invalid for VAT deduction on the recipient's side.
Penalties reach 50% of the VAT due on a non-compliant invoice.

Relevant to professional hosts, but deliberately **not** part of the MVP — see the
competition analysis in `02-problem-ranking.md` for why this enormous market is the wrong
place to start.

---

## Sources

**Property standards and penalties**
- [GTP Headlines — Greece Introduces New Rules for Short-Term Rentals from October 1](https://news.gtp.gr/2025/09/25/greece-introduces-new-rules-for-short-term-rentals-from-october-1/)
- [Hostaway — Airbnb & Short-Term Rental Rules in Greece: 2026 Compliance Guide](https://www.hostaway.com/blog/airbnb-rules-in-greece/)
- [Golden BnB — Ministry of Tourism clarifying circular](https://www.goldenbnb.gr/en/changes-in-short-term-rentals-what-you-need-to-know-and-how-to-prepare-2/)
- [EU Tourism Platform — Greece tightens short-term rental rules](https://transition-pathways.europa.eu/tourism/news/greece-tightens-short-term-rental-rules-amid-tourism-pressure)

**Registration, AMA and restrictions**
- [GTP Headlines — Short-Term Rentals in Greece: New Restrictions Take Effect in 2026](https://news.gtp.gr/2026/01/26/short-term-rentals-in-greece-new-restrictions-take-effect-in-2026/)
- [BuyGreece — AMA registration, the 60-day rule, and the Athens moratorium](https://www.buygreece.us/blog/greece-short-term-rental-rules-ama-60-day-athens-moratorium-2026)
- [Greek City Times — Athens extends ban on new short-term rentals through 2026](https://greekcitytimes.com/2026/01/06/athens-extends-ban-on-new-short-term-rentals-in-central-districts-through-2026/)
- [Athens Times — AADE to launch sweeping digital checks](https://athens-times.com/short-term-rentals-aade-to-launch-sweeping-digital-checks-on-listings-and-undeclared-income/)

**Climate Resilience Fee**
- [GTP Headlines — Climate Resilience Fee rates increase](https://news.gtp.gr/2025/01/07/climate-resilience-fee-rates-increase-for-greek-hotels-short-term-rentals/)
- [Filoxenos — TAKK Climate Crisis Resilience Fee guide](https://www.filoxenos.gr/en/guides/takk-climate-crisis-resilience-fee-greece)

**myDATA**
- [EDICOM — Greece: Mandatory B2B e-Invoicing via myDATA from February 2026](https://edicomgroup.com/blog/greece-mandatory-electronic-invoice)
- [ecosio — E-invoicing compliance in Greece](https://ecosio.com/en/compliance/greece/e-invoicing/)

**Market data**
- [To Vima — Greece sixth in Europe for Airbnb rentals](https://www.tovima.com/travel/greece-sixth-in-europe-for-airbnb-rentals-as-2026-demand-surges/)
- [AirROI — Athens Airbnb market report 2026](https://www.airroi.com/report/world/greece/attica/athens)
- [Investropa — Airbnb profitability analysis in Greece 2026](https://investropa.com/blogs/news/greece-airbnb)

**Existing tools**
- [Chekin — myDATA guide for vacation rental managers](https://chekin.com/en/blog/mydata-guide-for-vacation-rental-managers-in-greece/)
- [ProofSnap — Greece short-term rental rules 2026](https://getproofsnap.com/posts/greece-short-term-rental-airbnb-regulations-2026.html)
- [Roomismo — Greek PMS](https://roomismo.com/elliniko-pms)
