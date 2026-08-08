# Fakelos (Φάκελος)

**Compliance autopilot for Greek short-term rentals — built for the winter off-season.**

> _Ο φάκελος του ακινήτου σου, πάντα έτοιμος._
> Your property file, always inspection-ready.

---

## The one-paragraph pitch

Since 1 October 2025, every short-term rental in Greece must hold a civil liability
policy, an electrician's declaration, a pest-control certificate, serviced fire
extinguishers, smoke detectors, emergency lighting and a first-aid kit — and prove it
during a joint Ministry of Tourism / AADE inspection announced just 10 days in advance.
The first fine is €5,000. The third is €20,000. Almost none of this work can be done in
August while the flat is booked solid; it has to happen between November and March, which
is exactly the period when a Greek host has time but no income and therefore no
motivation. Fakelos turns those five dead months into a dated, sequenced work plan, stores
every certificate with its expiry date, nags the host before each one lapses, and produces
a single inspection-ready PDF on demand.

**Market:** ~160,000 active Greek listings at peak 2025. **Price:** €9/mo host, €29/mo
manager. **Second revenue line:** referral commission on the liability insurance the law
now forces every host to buy.

---

## What's in this repo

| Path | What it is |
|---|---|
| [`docs/01-research.md`](docs/01-research.md) | Field research on Greek winter low-season problems, with sources |
| [`docs/02-problem-ranking.md`](docs/02-problem-ranking.md) | 10 candidate problems scored on demand / competition / ease / monetization |
| [`docs/03-product-spec.md`](docs/03-product-spec.md) | Fakelos concept, ICP, feature spec, user stories, data model |
| [`docs/04-build-guide-nocode.md`](docs/04-build-guide-nocode.md) | Step-by-step build on a €0 no-code stack |
| [`docs/05-monetization.md`](docs/05-monetization.md) | Pricing, unit economics, affiliate revenue, realistic MRR path |
| [`docs/06-launch-plan.md`](docs/06-launch-plan.md) | Day-by-day 90-day launch plan tuned to the Greek seasonal calendar |
| [`docs/07-compliance-reference.md`](docs/07-compliance-reference.md) | The actual legal requirements, sourced — the product's knowledge base |
| [`data/compliance-rules.json`](data/compliance-rules.json) | Machine-readable requirement catalog that drives the app |
| [`data/tak-rates.json`](data/tak-rates.json) | Climate Resilience Fee rates by property type and season |
| [`app/index.html`](app/index.html) | **Working prototype** — property scorer, fine exposure, ΤΑΚ calculator, winter work plan |

## Try the prototype

```bash
open app/index.html        # macOS
xdg-open app/index.html    # Linux
```

No build step, no dependencies, no network calls. Single self-contained file — which is
deliberate: it is simultaneously the MVP's core loop and the free lead magnet that feeds
the funnel described in `docs/06-launch-plan.md`.

## Start here

If you read one thing, read [`docs/02-problem-ranking.md`](docs/02-problem-ranking.md) for
why this problem beat nine others, then [`docs/06-launch-plan.md`](docs/06-launch-plan.md)
for what to do on Monday.

---

## ⚠️ Disclaimer

This repository is a business plan and a prototype, not legal or tax advice. Greek
short-term rental law changed materially in 2024, 2025 and again in 2026, and it continues
to move. Every rate, deadline and requirement encoded here was compiled from public
secondary sources in August 2026 and **must be verified against AADE, the Ministry of
Tourism and a Greek accountant before you rely on it or sell a product built on it.**
Sources are cited in `docs/07-compliance-reference.md`. If you ship this, the single
highest-value early hire is a Greek accountant on retainer to sign off the rule set every
quarter.
