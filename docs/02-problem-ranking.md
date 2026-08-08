# 02 — Ten problems, scored

Ten candidate problems that surfaced from the research, each one plausibly solvable with
simple software, each scored and ranked.

## Scoring method

Four criteria, 1–10, weighted by how much each one actually predicts a solo founder's
outcome:

| Criterion | Weight | What a 10 means |
|---|---|---|
| **Demand** | 30% | Large, reachable, already-in-pain audience with a deadline forcing action |
| **Competition gap** | 25% | No credible incumbent; a focused tool would be the best option available |
| **Ease of build** | 20% | Buildable no-code by one person in weeks, no integrations you can't get |
| **Monetization** | 25% | Natural recurring subscription, clear budget, low churn |

Note the weighting choice: **competition gap is worth more than ease of build.** A hard
build in an empty market beats an easy build against entrenched incumbents. Most solo
founders get this backwards and pick the easy build.

---

## The ranking

| # | Problem | Demand | Gap | Ease | Money | **Score** |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **1** | **STR safety & compliance dossier** (Law 5170/2025, AMA, expiring certificates) | 9 | 8 | 9 | 8 | **8.50** |
| 2 | Absent-owner winter property caretaking reports | 7 | 7 | 8 | 7 | 7.20 |
| 3 | ΤΑΚ collection & monthly declaration accuracy | 7 | 7 | 9 | 5 | 6.90 |
| 4 | Seasonal staff rehire pipeline (ERGANI) | 7 | 6 | 7 | 6 | 6.50 |
| 5 | myDATA e-invoicing for micro-freelancers | 9 | 2 | 5 | 7 | 5.95 |
| 6 | Winter cash-flow forecasting for seasonal businesses | 6 | 5 | 8 | 5 | 5.90 |
| 7 | "What's open in winter" local directory | 6 | 6 | 9 | 3 | 5.85 |
| 8 | Off-season mid-term lets (nomads, students) | 8 | 4 | 3 | 7 | 5.75 |
| 9 | Island winter logistics / ferry-dependent ordering | 5 | 8 | 3 | 5 | 5.35 |
| 10 | Group deposit collection for mountain weekends | 5 | 5 | 8 | 4 | 5.35 |

---

## Why each one scored the way it did

**1. STR safety & compliance dossier — 8.50 🏆**
A brand-new law (Oct 2025) creates a checkable list of physical obligations across
~160,000 listings, enforced by inspection with 10 days' notice, fined at €5,000 first
offence. The work is seasonal — it must happen Nov–Mar — and the documents expire
annually, which makes renewal automatic rather than a decision. Every incumbent is
pointed at invoicing instead. It is also genuinely easy to build: a rules catalog, a
document store with dates, a reminder engine and a PDF export. Nothing here needs an API
nobody will give you.

**2. Absent-owner caretaking reports — 7.20**
A large share of Greek holiday stock is owned by people who are not in Greece in
February — diaspora, Northern Europeans, Americans. They pay someone local to check for
storm damage, damp and burst pipes, and they receive that as sporadic WhatsApp photos with
no record. A structured photo-report product is real and buildable. It scored lower on
demand only because the buyer is fragmented and harder to reach cold. **Strong v2 — and
it shares a data model with #1.**

**3. ΤΑΚ declarations — 6.90**
Very real and very easy to build, but it is a calculator plus a monthly reminder. Hard to
charge €9/month for on its own, and PMS vendors are already absorbing it. **Correct
decision: make it a feature of #1, not a company.**

**4. Seasonal staff rehire — 6.50**
Genuine pain: island tavernas and hotels lay off in October and lose trained staff every
winter, then scramble in April. But hiring in Greece routes through ERGANI and through
accountants, the sales cycle is seasonal and narrow, and HR tooling is a crowded global
category. Good idea, wrong first product.

**5. myDATA e-invoicing — 5.95**
Highest raw demand on the list, and it still lands fifth. October 2026 forces every Greek
business onto e-invoicing. But the category is saturated by entrenched accounting vendors,
the real buyer is the accountant rather than the business, and getting a certified
e-invoicing integration right is not a no-code weekend. **High demand does not survive a
competition gap score of 2.** This is the single most instructive row in the table.

**6. Winter cash-flow forecasting — 5.90**
Six months of revenue against twelve months of cost is a real modelling problem, and a
spreadsheet already solves it well enough. Low willingness to pay.

**7. "What's open in winter" directory — 5.85**
Trivially easy and genuinely useful to travellers, but it is an advertising business, not
a subscription one. Monetization score of 3 sinks it.

**8. Off-season mid-term lets — 5.75**
The most *exciting* idea here: match empty Nov–Mar island stock to digital nomads and
remote workers, with Greece's digital nomad visa as tailwind. It scores badly because it
is a two-sided marketplace with a hard cold start, and cold start is what kills solo
founders. Booking.com and Airbnb already own the demand side. Revisit once you have
thousands of properties in the system — which #1 gives you.

**9. Island winter logistics — 5.35**
Enormous competition gap because nobody serves it, and that is a warning, not an
opportunity. Tiny reachable market, deep operational integration required.

**10. Mountain group deposits — 5.35**
Arachova weekend group bookings, splitting deposits. Easy, but the market is a few
thousand transactions a year and Revolut already does most of it.

---

## The strategic pattern

The top-scoring ideas are not independent. **#1, #2 and #3 are the same customer, the same
property record, and the same winter calendar.**

```
        v1 (now)              v2 (year 1)             v3 (year 2)
   ┌──────────────────┐  ┌────────────────────┐  ┌────────────────────┐
   │ #1 Compliance    │→ │ #3 ΤΑΚ tracking    │→ │ #2 Caretaking      │
   │    dossier       │  │    + declarations  │  │    reports         │
   │ Sell: avoid €5k  │  │ Sell: avoid audit  │  │ Sell: peace of mind│
   └──────────────────┘  └────────────────────┘  └────────────────────┘
         one host            same host, more          same host, new
                              surface area              revenue line
```

Each step raises price without a new customer acquisition cost. That is the whole reason
to start with the narrow, boring, deadline-driven one: **compliance gets you the property
record, and the property record is the platform.**

---

## Decision

**Build #1.** It wins on the criteria that matter, it is the only one where a solo
no-code founder can be the best option in the market within a month, and it opens onto
#3 and #2 without changing customers.

Product spec: [`03-product-spec.md`](03-product-spec.md).
