# MyVault

**Offline stock manager for small shops.** Add your products, see what you have,
and never lose track of what is running out — all stored on your own Windows PC.
No account, no subscription, no internet connection.

<!-- markdownlint-disable-next-line MD033 -->
<img src="build/icon.png" alt="MyVault icon" width="96" />

---

## What it does

**Your products**

Every item always has the same four standard details:

| Standard detail | |
| --- | --- |
| **Name** | what the product is called |
| **Price** | what you sell it for |
| **Quantity** | how many you have |
| **Barcode** | scan it or type it |

If your shop needs more than that, press **Add a detail** and create your own —
**Size** for a clothes shop, **Age range** for a toy shop, **Expiry date** for a
mini-market. You can have **up to 5** extra details, and each one can be free
text, a number, a date, a yes/no, or a list you choose from. They appear on every
item and you can search, filter and sort by them.

Optional extras are there when you want them and ignorable when you don't:
category, item code/SKU, cost price, supplier, a per-item low-stock limit and
notes.

**Finding things**

- One search box that looks through **name, barcode and category** at once, or
  narrow it to just one of them
- Search ignores accents and capital letters (`παπουτσι` finds `Παπούτσι`)
- Filter by category, by stock level (in stock / low / out), and by any of your
  own choice-list details
- Sort by name, quantity, price, stock value, category, date added — or by your
  own details — ascending or descending, from the menu or by clicking a column

**Day-to-day work**

- Plus and minus buttons on every row for a quick sale or delivery
- Low-stock and out-of-stock warnings, with your own limit per product
- **Scan a barcode anywhere in the app** and the product comes straight up — USB
  barcode readers work out of the box
- **No scanner? Use a photo.** Press **Barcode photo**, choose a picture of the
  barcode, and MyVault reads the number out of it — then opens the product, or
  starts a new one with the number already filled in. The picture never leaves
  the computer; the reading is done inside the app.
- Totals along the top: how many products, how many pieces, what the stock is worth
- Delete with a one-click **Undo**
- Import and export CSV so a list you already keep in Excel comes across in one go

**Statistics**

**Statistics** in the sidebar answers two different questions.

*What is on my shelves right now* — what the stock is worth at your selling
prices and what it cost you, how many products are running low or out, where the
money is sitting by category, and which products are the most valuable.

*What actually happened* — takings, pieces sold, profit, and deliveries received
over the last week, month, quarter or year, each compared against the same length
of time immediately before it, so a number becomes news. A bar chart per day (or
per month, over longer periods), what is selling best, and — usually the most
useful thing on the screen — **what is not moving**: stock sitting there that has
not sold once in the period. That is money on a shelf.

**Stock take**

**Stock take** in the sidebar is for the day you count the shelves. Pick the
whole shop or one category, walk round with the laptop (or print a counting
sheet and a pen), and type what you actually see. Nothing on file changes until
you press Apply, and every number is saved the moment you type it — a count is
a long job that gets interrupted, so closing MyVault half way through loses
nothing. You get a running total of what is short, what is over and what the
missing stock was worth, and applying it writes every correction into your
history, so next year you can see what went missing this year.

**Returns**

Something brought back is not a delivery. The return button on each row puts the
stock back and takes the money off your takings, filed against the customer if
you have one selected. Without this, a refund would quietly look like stock you
had bought in.

**Order list**

**Order list** answers the morning question: what do I need to order? Everything
at or under its limit, with a suggested quantity worked out from how fast it has
actually been selling, grouped by supplier — because ordering happens one
supplier at a time. Out-of-stock lines come first. Save it as a PDF and send it,
or print it and read it down the phone. The suggestion is a starting point: you
know about the bank holiday, and MyVault does not.

**Printing**

The stock take sheet, the order list and your whole inventory can each be saved
as a **PDF**, laid out for A4 and printed on whatever printer the shop already
has. The document is built inside MyVault and rendered on your own machine —
nothing is uploaded to a converter.

**Invoices and delivery notes**

The other half of a shop's day is not the till. A delivery arrives with thirty
lines on a printed note, and pressing plus thirty times is how a shop ends up
not bothering. **Invoices** lets you enter the whole document — scan or search
each product, or read the supplier's own CSV straight in — see the totals while
there is still time to disagree with them, and post the lot in one press.

Incoming documents add stock and update your cost prices from what the supplier
actually charged this time. Outgoing ones take stock out and bill it to a
customer. Either way every line becomes a movement that names the invoice it
came from, so a whole delivery can be traced back to the piece of paper.

A posted invoice is **never edited or deleted**. If it was wrong you void it,
which posts the opposite and keeps both — because the stock really did move, and
a history that can be quietly rewritten afterwards is not a history. A
half-typed invoice is saved as you go, so closing MyVault mid-delivery loses
nothing.

*Not* included: reading a photographed invoice. Offline OCR of arbitrary invoice
layouts cannot be made reliable, and a misread quantity posted silently into
your stock is worse than typing it.

**VAT**

Off unless you switch it on, because a shop that is not VAT-registered should
not have a tax column in the way. Turn it on in **Settings → VAT**, set your
usual rate, and each product can override it — a bookshop sets 6% as the default
and puts 24% on the pens.

The **VAT** screen then answers the question you actually have to answer:
**what do I owe?** That is not the VAT on your sales. It is the VAT you
collected, *less the VAT you already paid your suppliers*, and MyVault shows all
three so the deduction is visible rather than assumed. Choose a quarter or a
year — calendar periods, the ones a return is filed for, not a rolling ninety
days — see the turnover and tax broken down per rate the way a return is laid
out, and save it as a PDF for your accountant.

Two settings decide whether every figure is right, so they are asked plainly:
whether your **prices already include VAT** (in a shop they do — that is what
the customer hands over) and whether your **cost prices do** (usually not — a
supplier invoice is normally net). Getting either backwards moves everything by
about a fifth.

Stock takes, write-offs and corrections are deliberately **left out** of the
sums and reported separately. Whether a write-off needs a VAT adjustment depends
on why the stock went, which MyVault cannot know — so it says how many there
were rather than guessing. These figures are a working total to hand an
accountant. They are not a tax return and not advice.

**Services, and discounts on a line**

Half the lines on a real invoice are often not things on a shelf: fitting,
delivery, an hour's labour, a repair. Tick **"This is a service"** on a product
and it carries a price and a VAT rate like anything else and goes on an invoice
like anything else — it just never has a quantity. So it stays out of your stock
value, your low-stock warnings, your order list and your stock takes, and billing
one no longer takes stock off a shelf that was never there.

Each invoice line can also carry a **discount percentage**, because that is how a
supplier actually gives one: 10% off the wine, nothing off the spirits. The
discount comes off the **unit price** rather than the line total. That is a
deliberate choice with a visible consequence — on an awkward quantity it can land
a cent or two away from what a supplier's own paper prints, because their paper
discounts the line. MyVault does it the other way because a movement stores a
price per unit, and the VAT return is built from units × price: any other
ordering leaves your invoice and your VAT return quietly disagreeing. If you want
the supplier's exact figure, type it straight into the unit price instead.

**Prices and margins**

MyVault already knows what you paid for the last delivery — the invoice is in
it. What it could not tell you before is what that means for the shelf. Two
things in particular go unnoticed for months, and both cost money:

- **You bought something cheaper than usual.** The supplier ran a deal or you
  took a bigger box. Nothing on any screen changed, so either you never notice
  the extra margin you are earning, or you drop the shelf price to celebrate and
  forget to put it back when the next delivery arrives at the old price.
- **You bought something dearer than usual.** The cost crept up over three
  deliveries and the price never moved. This is the one that quietly turns a
  product into a loss, and it is invisible precisely *because* nothing happened —
  no alert fires when a number stays the same.

The **Prices** screen answers three questions per product: what do I normally
pay, what did I pay this time, and what would I have to charge to keep the margin
I had. It sorts your shop into four lists, worst first: **selling below cost**,
**bought cheaper than usual**, **cost went up but the price did not**, and —
only if you set a target — **below your target margin**. Each line comes with
what you could do about it and the margin that choice would actually earn, so you
choose on the number rather than the wording.

And when a delivery is posted, the lines that came in at an unusual price are
shown **there and then**, because that is the one moment you are looking at what
you paid and can still act on it.

Two things worth knowing about the arithmetic:

- **Margin is worked out on the net price.** A shelf price of €12,40 contains
  €2,40 that was never your money. A margin taken against the gross would flatter
  every product in your shop by the VAT rate.
- **"Usually" excludes the delivery being judged.** Otherwise buying cheap three
  times makes cheap the norm, and the fourth cheap delivery looks like business
  as usual. A product's *first* delivery is never called a discount either —
  there is nothing to compare it to.

Nothing here changes a price by itself. Every suggestion sits next to a button
and you press it or you don't: you know about the shop down the road and MyVault
does not. Suggested prices are rounded the way your shop likes them — to five
cents, to a ,99, or not at all — and the margin shown is always the one the
*rounded* price earns, not the one it was calculated from.

Junior staff cannot see this screen. A shelf price is theirs to ring up; what
you paid for it is not.

**Customers**

Keep your regulars: name, phone, email, address and notes. Only the name is
required, because a shop that writes down "Maria, the one with the green van" and
nothing else should not be stopped by a form.

To record who bought what, pick a name in the **Serving** bar above the stock
list. Every sale you ring up then goes against that customer until you clear it.
There is deliberately no "who is this for?" question on each press of the minus
button — it would be answered "nobody" ninety-nine times out of a hundred and
abandoned by the end of the first morning. Open a customer to see everything they
have bought, what they have spent in total, and how long they have been coming.

**Making it yours**

- 21 languages (see below)
- Light theme, dark theme, or follow Windows
- Six accent colours, so the app can match your shop
- Comfortable or compact rows — compact fits noticeably more products on screen
- Four text sizes, scaling the whole app for a small till screen or a big monitor

**Your data**

- Everything is in a single file on your computer
- Written safely (a crash mid-save can never corrupt the file) with automatic
  rolling backups
- Backup and restore to a USB stick whenever you like
- **A second copy on another drive.** Backups normally sit beside your data,
  which saves you from a mistake but not from the disk failing. Point
  **Settings → A copy on another drive** at a USB stick or a second disk and
  every backup is copied there too. MyVault says so if the folder you picked
  turns out to be on the same drive after all, and if the stick is unplugged it
  tells you rather than failing quietly — it never stops you selling.

---

## Languages

MyVault is offered in the twenty most widely spoken languages in the world, plus
Greek. You pick one **on the installer's first screen**, and can change it at any
time in **Settings → Language** — the whole app switches instantly. Until you
choose, MyVault follows the language selected during installation, or your
Windows display language.

Prices, quantities and dates follow the chosen language too, so a German shop
sees `1.234,50` where a British one sees `1,234.50`. **Arabic and Urdu lay the
whole interface out right-to-left.**

**Translated in full** — Arabic, Chinese (Simplified), English, French, German,
Greek, Hindi, Indonesian, Portuguese, Russian, Spanish, Turkish, Vietnamese.

**Offered but still showing English** — Bengali, Chinese (Traditional), Japanese,
Korean, Marathi, Tamil, Telugu, Urdu. These are marked `(English)` in the
language menu rather than pretending to be translated, and the app stays fully
usable in them.

Finishing one is a single file and no code: copy `src/i18n/locales/en.ts` into
`src/i18n/locales/<code>.json`, translate the right-hand side, and leave every
`{placeholder}` in place. `npm test` then checks that the keys and placeholders
all line up. Anything not yet translated falls back to English, so a partly
finished language is safe to ship.

The Windows installer itself speaks 15 of the 21. NSIS, which builds the
installer, ships no translation for Bengali, Urdu, Marathi, Telugu or Tamil, and
the Hindi file it does ship is malformed — it aborts the build outright, so Hindi
is app-only too. Those six appear inside the app, where they work normally, and
the installer falls back to English for them.

---

## Completely offline

Out of the box, MyVault never touches the internet. This is enforced, not just
promised:

- Every network request the app could make is **cancelled before it leaves** —
  only MyVault's own files on your disk are ever loaded.
- The parts of the browser engine underneath that normally phone home on their
  own (update checks, safe-browsing lists, crash reports, usage metrics) are
  **switched off before the engine starts**.
- The interface is locked to its own bundled files, so nothing external can be
  pulled in even if it wanted to.
- Camera, microphone and location permissions are refused outright.
- There is no account, no login, no sync and no telephone-home. Nothing about
  your shop is sent anywhere, ever.

The test suite checks this directly. `npm run test:e2e` launches the real app
and, from inside the running window, tries to reach a web server on this very
machine by five different routes — `fetch`, `XMLHttpRequest`, a WebSocket, an
image and a script tag. Every one has to fail. The server is local and proven
answering first, so a build machine with no route to the internet cannot make
the check pass by accident.

Two independent layers do the blocking, and either alone is enough: strip the
Content-Security-Policy and the request handler still cancels it; strip the
request handler and the policy still refuses it. Only with both removed does
`fetch` get through — which is how the check is known to be capable of
failing.

### What the shop's own files can and cannot do

Two kinds of untrusted input reach MyVault: files a shop picks off a disk, and
text that arrives inside them. Neither is treated as harmless.

**A picture is identified by its bytes, not its name.** When you choose a photo
to read a barcode from, MyVault reads the file's own header and refuses anything
that is not really a JPEG, PNG, GIF, WebP or BMP — whatever the file is called.
This is why SVG is not on that list: it is the one common image format that can
carry script, and an `<svg onload="…">` renamed to `barcode.png` sails through a
check that only looks at the extension. The file is also refused if it is a
folder, a device or a pipe rather than an ordinary file, if it is empty, if it is
over 25 MB, or if its header claims dimensions no camera produces — a 33-byte PNG
saying it is 80000 × 80000 is not a photograph, and drawing it would take the
window down.

Imported CSVs and restored backups get a size limit for the same reason: both
used to be handed straight to a parser however large they were.

**A product name is not a spreadsheet formula.** Names arrive from suppliers'
CSV files and from barcode labels, sit in your stock list, and go back out again
when you export. A name beginning with `=`, `+`, `-` or `@` is treated as a
formula by Excel, LibreOffice and Google Sheets, so MyVault writes it out as text
instead. Nothing is lost — importing your own export gives back exactly the names
you had, however many times you go round.

**Nothing built from a string becomes markup.** The interface is React, which
escapes every value it renders, and there is not one `dangerouslySetInnerHTML` in
the codebase. Underneath that sits a Content-Security-Policy that allows no
inline and no evaluated script at all, which is also what stops an
`<img onerror=…>`; the printed PDF — the only HTML MyVault assembles from your
own text — carries its own policy and escapes every value on the way in; and the
window itself runs inside the operating system's sandbox, with no filesystem and
nothing it can reach but the fixed list of operations in `electron/preload.js`.

The check that matters runs against the packaged build on every push: it starts
the real app, injects an inline `<script>` and an `<img onerror>` into the live
window, and fails if either one runs. Loosening the policy by a single directive
makes that test fail, which is how it is known to be capable of failing.

### The one exception, and its exact size

**Settings → Updates** has three positions, and only the first is the default:

| | What it does |
| --- | --- |
| **Off** *(default)* | Never goes online. Nothing is checked, nothing is sent. |
| **Tell me** | Looks once a day and says if there is a newer version. Downloading and installing are two more presses, both yours. |
| **Automatic** | Looks once a day and downloads quietly. The new version is put in place **the next time MyVault is closed** — never mid-afternoon with a queue at the till. |

It is worth being precise about what switching it on does and does not change:

- It is **off on a fresh install** and stays off until somebody chooses
  otherwise. A shop that never opens that panel is in exactly the state
  described above.
- Even on **Automatic**, MyVault never restarts itself. The swap happens when
  the shop closes the program, and a button is there to do it sooner.
- The first check waits twenty seconds after launch, so opening the app is
  never held up by the network.
- The **interface still cannot reach the network at all** — that rule is
  unchanged, and the test suite still proves it with updates on. Only the
  background part of the program makes the request.
- It can only contact `api.github.com`, `github.com`,
  `objects.githubusercontent.com` and `release-assets.githubusercontent.com`,
  only over HTTPS. Anything else, including a lookalike domain or plain `http`,
  is refused before a byte is fetched. The app lists these hosts on the
  settings panel so the shop can read them.
- The traffic is a download in one direction. **Nothing about the shop is
  uploaded** — not the stock list, not a version number, not a count.
- The downloaded installer is checked against the checksum published with the
  release before it is allowed to run, and an older version is never offered
  as an "update".

---

## Updating the app

Installing a newer version replaces **the program only** — your inventory is kept
somewhere separate and is never touched by the installer. You do not need to
export anything first.

There are two ways to get the newer version onto a shop's PC.

**By hand**, which always works and needs no internet on their side: download
the newer installer yourself and run it over the top. Their items, categories,
extra details and every setting stay exactly as they were.

**From inside the app**, if the shop switches **Settings → Updates** to *Tell
me* or *Automatic*. MyVault then asks GitHub once a day whether a newer
installer exists, and either offers it or fetches it quietly. Read
[the exception above](#the-one-exception-and-its-exact-size) for exactly what
that permits. The portable `.exe` deliberately cannot do this — it
may be running from a USB stick, so it tells the user to download the new file
instead of overwriting itself.

**Copies older than 1.4.1 cannot update themselves, and no fix can reach them.**
Where a build looks for updates is compiled into it. Versions 1.1.0 to 1.4.0 were
built pointing at a separate downloads repository that was never created, so
"Check now" in those copies asks for something that returns 404 and answers *No
published version was found to update to* — correctly, if unhelpfully. 1.4.1 was
the first build with the right address. Anyone on an older one needs the
installer handed to them once, by hand; from then on the in-app updater works.

### Publishing a version the app can find

Because this repository is public, the in-app updater reads its releases
directly — a shop needs no account, no token and no second repository.

Run the workflow with a **Release tag** filled in (or push a `v…` tag). The two
`.exe` files and a small `latest.yml` are attached to a GitHub Release. That
`latest.yml` is what the updater reads to learn the newest version and the
checksum its installer must match; without it beside the `.exe` files, "Check
now" finds nothing, so the build fails rather than publishing a release the app
cannot use.

---

## What it costs to run

Nothing, permanently, on the GitHub Free plan.

MyVault is a desktop program, not a website, so there is nothing to deploy to a
server and no monthly bill behind it:

| A web app would need | MyVault needs |
| --- | --- |
| A server running all the time | Nothing — it runs on the shop's own PC |
| A database | One file, on that same PC |
| A domain and hosting | Nothing — you hand over an `.exe` |
| Paying every month, forever | Paying nothing, ever |

Everything it is built from — Electron, React, Vite, electron-builder, NSIS — is
free and open source. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

The only thing that ever costs money is **optional**: a Windows code-signing
certificate (roughly €200–400 a year) to stop Windows calling the program
"unrecognised" on first run. While you are handing the file to shops yourself it
is not worth buying — [HANDOUT.md](HANDOUT.md) shows the two clicks past the
warning. It becomes worth considering only if you ever distribute widely.

---

## Getting the app

**This repository is public.** Anyone can download the installer from the
[Releases](../../releases/latest) page without an account, which is also how the
in-app updater reaches it. The source is readable too — the licence still
reserves all rights, so it may be read but not copied, redistributed or resold.

**Windows** is what MyVault is built for: run the installer, choose your
language, and it appears in the Start menu. There is also a portable `.exe` that
runs from the folder it sits in — a USB stick behind the counter is fine — and
keeps its data beside itself.

**Linux** builds are published alongside them, mainly for testing:

```bash
chmod +x MyVault-*.AppImage
./MyVault-*.AppImage
```

Nothing to install and no root needed. If your system has no FUSE, run
`./MyVault-*.AppImage --appimage-extract-and-run`; on a minimal or headless
system add `--no-sandbox`. There is a `.deb` as well if you would rather it
appeared in your applications menu: `sudo apt install ./MyVault-*.deb`.

The Linux build is the same code and passes the same tests, including one that
unpacks the AppImage that was just built, starts it, saves a product and reopens
it to check the stock came back. What it has *not* had is a shop using it: the
barcode scanner, the receipt printer and the folder-picker dialogs have only ever
been exercised on Windows.

### Getting an installer to hand out

**On your own Windows PC — free, no limits:**

```bash
npm install
npm run dist:win
```

Both files appear in `release/`. This costs nothing and is the simplest way. On
Linux, `npm run dist:linux` produces the AppImage and the `.deb` the same way,
and `npm run test:packaged` then starts the AppImage it just built and checks it
really works rather than merely existing.

**Or on GitHub**, if you are not at a Windows machine: go to the **Actions** tab,
pick *Build MyVault*, press **Run workflow**, and — this is the part worth
remembering — type a version into **Release tag**, such as `v1.0.1`.

* **With a release tag**, the finished `.exe` files are attached to a
  [Release](../../releases). One click each, a direct download rather than a zip
  to unpack, and they stay there indefinitely.
* **Leaving the box blank** just builds and keeps the files on the run's summary
  page for 7 days, as a plain `.zip` you have to extract.

| File | What it is |
| --- | --- |
| `MyVault-…-setup.exe` | Normal installer. Adds MyVault to the Start menu and desktop. |
| `MyVault-…-portable.exe` | Single `.exe`. Runs from anywhere, including a USB stick. |

Then send a shop the [latest release](../../releases/latest) link, or copy the
`.exe` onto a USB stick — both work, and neither needs the shop to have a
GitHub account.

#### Staying inside the free allowance

The GitHub Free plan includes **2,000 runner minutes** and **500 MB of artifact
storage** per month — and public repositories are not charged runner minutes at
all. Both are plenty here, as long as
the Windows build is not left running on every push:

| | Runs on | Costs roughly |
| --- | --- | --- |
| Tests | every push | ~2 Linux minutes |
| Windows build | every push | ~5 Windows minutes, no storage |
| Keeping the installers | only a version tag, or **Run workflow** | ~175 MB for 7 days |
| Publishing a release | only when you fill in **Release tag** | nothing — release assets are not counted |

Minutes are the plentiful allowance, so the installer is *built* on every push —
that is what catches a break in the NSIS script, the icon or the licence
encoding, none of which the Linux tests can see. Storage is the scarce one: an
Electron app bundles its whole runtime into each `.exe`, so two builds sitting
around would nearly fill the 500 MB. An ordinary push therefore builds, checks
both `.exe` files exist, and throws them away; only a tag or a manual run keeps
them, for 7 days. A **Release** sidesteps the problem entirely: GitHub does not
charge release assets against that 500 MB, which is why a version you actually
intend to hand out is better published as one.

Building locally uses none of this at all.
[HANDOUT.md](HANDOUT.md) is a short bilingual instruction sheet — installing,
the Windows "unrecognised program" warning, and the first few steps — meant to
be passed along with the file.

Windows shows that warning for any program it has not seen before. Getting rid
of it needs a paid code-signing certificate; when you are handing the file to
shops yourself, it is not worth it — the handout explains the two clicks past it.

`npm run dist:win` must run **on Windows** — that is what produces a Windows
executable. You need [Node.js 20 or newer](https://nodejs.org/).

---

## Developing

```bash
npm install
npm run dev        # Vite dev server + Electron with hot reload
npm start          # production build, then run it
npm test           # store, CSV, search, sorting and translation tests
npm run dist:linux # Linux AppImage + .deb (on Linux)
npm run test:packaged  # start the built AppImage and check it works
npm run typecheck  # TypeScript, no emit
npm run icon       # regenerate build/icon.ico (needs Python 3; use python3 on Linux/macOS)
```

### Layout

```
electron/          Main process — the only code that touches the disk
  main.js          Window, native menus, file dialogs, IPC handlers
  preload.js       The narrow bridge exposed to the UI as window.myvault
  store.js         The JSON store: validation, atomic writes, backups, CSV import
  movements.js     The append-only history of every stock movement
  statistics.js    The sums behind Statistics and the order list
  vat.js           VAT: collected less deductible, per rate, per quarter
  pricing.js       Margins, what a product usually costs, and what to charge
  documents.js     Invoices and delivery notes, posted a whole page at a time
  pdf.js           The printable documents, built and escaped here
  offline.js       The rules that keep the app off the network, and the policy
                   that keeps injected markup from doing anything
  files.js         What a file is allowed to be: pictures identified by their
                   own bytes, size and dimension limits, one place for all of it
  csv.js           Dependency-free CSV reader/writer
src/               The user interface (React + TypeScript)
  components/      Screens and widgets
  state/vault.tsx  App state and every action the UI can perform
  lib/             Search, sorting, formatting
  hooks/           Barcode-scanner listener
  i18n/            Languages: en.ts is the source, one JSON per translation
tests/             Plain-Node tests, no framework
build/             App icon, the installer script, and the icon generator
```

The renderer never has access to Node or the file system. It can only call the
fixed list of operations in `electron/preload.js`, and every one of them is
validated in `electron/store.js` before anything is written. React is bundled
into `dist/` at build time, which is why `dependencies` is empty — the packaged
app ships only MyVault's own code.

Two of the test files are worth knowing about, because they are the ones that
justify trusting the numbers rather than the code:

- `tests/workflow.test.js` runs one month through one shop — opening stock, a
  supplier's delivery, till sales, a wholesale invoice, a refund, a stock take —
  and then checks that the takings screen, the VAT return, the order list, the
  customer's own page and the stock on the shelf all tell the same story. Every
  expected figure in it was worked out on paper first and is written down beside
  its arithmetic, so nothing is asserted against another part of MyVault.
- `tests/pricing.test.js` checks the margin arithmetic against sums done on
  paper, including every combination of the two VAT settings and every rounding
  style — a suggestion that quietly rounds a price back under its cost is worse
  than no suggestion.
- `tests/design.test.js` measures the stylesheet rather than reading it: every
  text colour against every surface it can land on, in both themes, at the 4.5:1
  WCAG AA asks for body text. The file's own header claimed it cleared AA and it
  did not — a colour is only wrong once somebody measures it.
- `tests/edges.test.js` is the opposite: a product deleted while it sits on a
  half-typed invoice, an order for ten when there are three on the shelf, a
  category thrown away mid-count, a minus sign typed into a price. Every check
  in it started as a probe that failed.

---

## Reading a barcode from a photograph

A shop without a barcode reader still has a phone. **Barcode photo** on the
stock list, and **Read from photo** next to the barcode box when adding an item,
both take a picture and pull the number out of it.

- **Registering new stock**: photograph the barcode, and if the shop does not
  have that product yet the Add-item form opens with the number already in
  place. Type the name and the price and it is registered.
- **Finding something**: if the barcode is already known, the item opens for
  editing instead — which is nearly always why someone photographs a barcode at
  the counter.
- **Formats**: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, Code 93, ITF,
  Codabar, QR and Data Matrix. Photos taken sideways or upside-down are read
  too; MyVault tries all four orientations.
- **Where it happens**: entirely inside the app, on this computer. The decoder
  is bundled with MyVault. No picture is uploaded, and this works with no
  internet connection at all.

It is a photograph, so it is not infallible. A blurred, angled or half-cropped
barcode will not read, and MyVault says so rather than guessing — try again
closer, sharper, with the whole barcode in frame and a little white space
either side. A USB reader is still faster if you have one.

Note that an EAN-13 beginning with `0` is the same symbol as a UPC-A and comes
back in its twelve-digit form without the leading zero. That is correct, and it
matches what a USB scanner reports for the same product.

---

## Is my work really saved?

Yes, and it is checked mechanically rather than promised. `npm run test:e2e`
starts the **real** application five times against one data folder and, between
launches, reads the file on disk directly:

1. First run — the shop is empty and one data file appears.
2. Three products are added and the shop name is set, through the actual form.
   Both are on disk **before** the app is closed: MyVault saves as you work, not
   when you quit, so a power cut costs nothing.
3. The app is closed and reopened. Same file, same three records — matched by
   their ids, so lookalikes would not pass — with every quantity, price and
   barcode intact, and the stock list showing them rather than an empty shop.
4. A sale is rung up and the app closed seconds later. It is still there next
   time.
5. The file is stamped as written by an older MyVault, which is exactly what an
   update looks like from the inside. The stock survives, and an untouched copy
   of the old file is parked in `backups/` first.

Finally: after five launches there is still **exactly one** data file, and no
half-written leftovers.

The test is only worth its runtime if it fails when it should. Making `init()`
start from an empty database — the precise bug of "it forgets everything" —
makes it fail on step 3 with *"reopening reuses the same file rather than
starting a new one"*. It runs on every push.

One thing that legitimately changes between runs: the file's inode. Saving
writes a temporary file and renames it over the original, so a crash mid-write
can never leave a half-written stock list. "The same file" therefore means the
same contents and the same records, not the same inode.

---

## Staff and permissions

A shop is rarely one person. **Staff** in the sidebar gives everyone their own
PIN and decides what they may do.

| Role | What they can do |
| --- | --- |
| **Manager** | Everything: products, categories, extra details, settings, statistics, VAT, customers, stock takes, and who else works here. |
| **Senior** | Adds products, books deliveries in, rings up sales, takes returns, counts the shelves, enters and posts invoices, exports a CSV, reads the statistics, keeps the customer list. **Not** the VAT screen — the shop's tax position is the owner's — and not categories, extra details, settings, or deleting products. |
| **Assistant** | Looks a product up and takes one off when it sells, and can say which customer they are serving. Nothing else — not the takings, not the customer list itself, not counting the shelves, not correcting a count upwards (a delivery rather than a sale), and not handing money back. A refund is a judgement about whether the shop really sold that thing, and that belongs to a senior. |

**The installer asks who will manage this copy.** A page during installation
collects the manager's name and PIN, so a freshly installed MyVault is never
sitting there with nobody in charge. The installer hands them over through the
registry; MyVault reads them the first time it runs, turns the PIN into a salted
hash, and **deletes both values immediately**. They are in the clear for exactly
that gap, on the machine being installed to — which is worth knowing, and is why
it is written here rather than glossed over.

**An existing shop is not disturbed.** Updating over a shop that already has data
and no staff list changes nothing: MyVault opens straight into the stock with
full access, as before. The installer's manager is only created when there is no
staff list at all. And a one-person shop that finds a daily PIN a nuisance can
turn the whole thing off again from the Staff screen — everyone is removed, the
stock is untouched, and MyVault opens freely as it used to.

Each person signs in with a 4-to-12-digit PIN on a keypad. PINs are **salted and
hashed with scrypt**, never stored as you typed them, and never cross into the
window: the interface is told who is signed in and what they may do, and nothing
else. Signing out, or closing MyVault, leaves the next person a locked screen.

You cannot lock yourself out by accident. The last manager cannot be deleted or
demoted, and a data file that has somehow ended up with no manager at all is
treated as having no staff list — the shop gets full access back rather than a
door it cannot open.

### What this is, and what it is not

This is **staff separation, not security.** It decides what each person can do
*inside MyVault*. It is not a lock on the computer: everything lives in one file
on that PC, and anyone who can open that file in Notepad can read it, or delete
it, or reinstall the program. Protect the PC itself the way you protect the till
drawer — a Windows account password does more here than any PIN could.

What it *does* do is real. The checks run in the background process, on the far
side of the bridge, not in the buttons. Hiding a button is the polite half;
`tests/roles.e2e.js` proves the other half by signing in as an assistant, calling
the program's own internals directly — past the interface entirely — and
requiring all ten manager-and-senior actions to be refused.

### If the manager PIN is forgotten

The first time a manager is created — by the installer or in the app — MyVault
shows a **recovery code** once: four groups of five characters, like
`K7QMR-BXTVW-2H9DJ-PSFZN`. That screen cannot be clicked past; the only way on is
the button saying you have written it down.

Keep it with the shop's important papers. If the PIN is ever forgotten, press
**Forgotten the PIN?** on the sign-in screen, type the code, and choose a new
manager PIN. You are signed straight in.

Some details that matter in a shop:

- The code is **stored only as a salted scrypt hash**, so MyVault genuinely
  cannot show it to you again. Lose the paper and the answer is to generate a
  new code from the Staff screen, not to look the old one up.
- It is **single-use**. A slip of paper somebody has already used is worthless,
  and a fresh code is minted the moment the old one is spent.
- It is **case- and dash-forgiving**: `k7qmr bxtvw 2h9dj psfzn` works. The
  alphabet leaves out `O`, `I`, `L`, `0` and `1`, because this gets copied by
  hand and read back months later.
- Twenty characters from a 31-character alphabet is about 99 bits. Guessing is
  not a way in, which is why there is no lockout to trip over.

**And if the code is lost too**, nothing is lost either. Close MyVault, open the
data folder (the path is on the Settings screen), and either restore a backup
from before roles were set up, or delete the `users` list from `myvault.json`.
MyVault reopens unlocked with all your stock intact. That last paragraph is,
honestly, the same fact as "this is not security" seen from the useful side.

---

## Where your data lives

| Build | Location |
| --- | --- |
| Installed | `%APPDATA%\MyVault\data\myvault.json` |
| Portable | `MyVault-Data\myvault.json` next to the `.exe` |

**Settings → Open folder** takes you straight there. Dated backups are kept in
the `backups` sub-folder (the last 10, at most one per 12 hours), plus whatever
you save yourself with **Backup**.

Beside them is a `history` folder holding one file per year of stock movements —
every sale, delivery and correction, one line each. It is kept separate on
purpose. `myvault.json` is rewritten in full every time anything changes, so a
history inside it would make each sale cost a little more than the one before;
kept apart and only ever appended to, the hundred-thousandth sale costs exactly
what the first one did. Nothing in that folder is read when MyVault opens — only
when you ask for statistics or for what a customer bought.

**How big can a shop get?** The history is effectively unbounded: 60,000
movements is an 11 MB file that reads back in under a fifth of a second, and a
year you are not looking at is never opened. The product list is the part with a
ceiling, because every sale saves it: around 5,000 products a sale takes about
7 ms, and at 20,000 about 30 ms — still quick, and far past what this app is for.
Above 2,000 products the data file stops being written with indentation, which
halves its size; below that it stays something you could open and read.

If the file is ever unreadable, MyVault will not overwrite it — it moves it aside
into `backups/` and tells you where it went.

---

## Bringing in a list from Excel

Save your sheet as CSV and use **Import CSV**. Commas and semicolons both work.

Only `Name` is required. These column names are understood:

`Name`, `Barcode`, `SKU`, `Category`, `Quantity`, `Price`, `Cost`,
`Low stock threshold`, `Supplier`, `Notes`

**Any other column becomes one of your extra details automatically** — so a
`Size` or `Age range` column comes across without you setting anything up first,
up to the limit of 5. If a sheet has more columns than that, the products are
still imported and MyVault tells you which columns it had to leave out.
Categories that do not exist yet are created. Rows whose barcode matches a
product you already have update that product instead of duplicating it.

Prices may be written either way: `12.50` or `12,50`.

---

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl` + `N` | Add an item |
| `Ctrl` + `F` | Jump to the search box |
| `Enter` | Save the open item |
| `Esc` | Close the dialog |
| Double-click a row | Edit that item |
| *Scan a barcode* | Find that item, from any screen |

---

## Licence

**MyVault is free to use** — for your own shop, commercially, on as many of your
own computers as you like, for as long as you like.

**All rights are reserved.** It may not be copied, redistributed, resold, forked
or reproduced as another product. Being able to read the source here does not
grant permission to reuse it. The full terms are in [LICENSE](LICENSE), the
installer shows them before installing, and they are summarised inside the app
under **Settings → Licence**.

The open-source components MyVault is built on (Electron, Chromium, Node.js,
React) keep their own licences, which those terms do not — and cannot — restrict.
They are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Copyright © 2026 Aristotelis Katsigiannis (Αριστοτέλης Ν. Κατσιγιάννης).

The Latin spelling is the one in `package.json`, because that is what Windows
shows as the publisher — and non-ASCII does not survive the trip into the
installer's metadata, where the Greek came out as `???st?t????`. The Greek stays
in `LICENSE`, which the installer renders as UTF-8 and gets right.

> A licence stops people reusing the code *lawfully*; keeping this repository
> private is what stops them seeing it at all. Both are in place. This is a plain
> summary, not legal advice.
