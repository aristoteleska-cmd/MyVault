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
- Totals along the top: how many products, how many pieces, what the stock is worth
- Delete with a one-click **Undo**
- Import and export CSV so a list you already keep in Excel comes across in one go

**Making it yours**

- Light theme, dark theme, or follow Windows
- Six accent colours, so the app can match your shop
- Comfortable or compact rows — compact fits noticeably more products on screen
- Four text sizes, scaling the whole app for a small till screen or a big monitor

**Your data**

- Everything is in a single file on your computer
- Written safely (a crash mid-save can never corrupt the file) with automatic
  rolling backups
- Backup and restore to a USB stick whenever you like

---

## Completely offline

Once installed, MyVault never touches the internet. This is enforced, not just
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

The test suite checks this directly: it launches the real app and tries to reach
the network by five different routes, and every one has to fail.

---

## Updating the app

Installing a newer version replaces **the program only** — your inventory is kept
somewhere separate and is never touched by the installer. You do not need to
export anything first.

To update: download the newer installer and run it over the top. Your items,
categories, extra details and every setting stay exactly as they were.

Extra safety on top of that: the first time a new version opens your file, it
takes an untouched copy of it first — `myvault-before-1.0.0-…json` in the backups
folder. If an update ever misbehaves, that copy is the way back. Those snapshots
are never rotated away by routine backups.

The data file carries a version stamp, so a future release knows how to read a
file written by an older one. If an older version is ever asked to open a newer
file, it keeps the original safe rather than overwriting it.

---

## Getting the app

### If you just want to use it

Grab a build from the **Actions** tab of this repository: open the latest
successful *Build Windows app* run and download either artifact.

| Download | What it is |
| --- | --- |
| `MyVault-windows-installer` | Normal installer. Adds MyVault to the Start menu and desktop. |
| `MyVault-windows-portable` | Single `.exe`. Runs from anywhere, including a USB stick. |

The portable build keeps its data in a `MyVault-Data` folder next to the `.exe`,
so the whole inventory travels with the stick. The installed version keeps its
data in your Windows user folder.

### If you want to build it yourself

You need [Node.js 20 or newer](https://nodejs.org/).

```bash
npm install
npm run dist:win     # produces release/MyVault-1.0.0-setup.exe and the portable exe
```

`npm run dist:win` must run **on Windows** — that is what produces a Windows
executable.

---

## Developing

```bash
npm install
npm run dev        # Vite dev server + Electron with hot reload
npm start          # production build, then run it
npm test           # store, CSV, search, filter and sort tests
npm run typecheck  # TypeScript, no emit
npm run icon       # regenerate build/icon.ico (needs Python 3; use python3 on Linux/macOS)
```

### Layout

```
electron/          Main process — the only code that touches the disk
  main.js          Window, native menus, file dialogs, IPC handlers
  preload.js       The narrow bridge exposed to the UI as window.myvault
  store.js         The JSON store: validation, atomic writes, backups, CSV import
  offline.js       The rules that keep the app off the network
  csv.js           Dependency-free CSV reader/writer
src/               The user interface (React + TypeScript)
  components/      Screens and widgets
  state/vault.tsx  App state and every action the UI can perform
  lib/             Search, sorting, formatting
  hooks/           Barcode-scanner listener
tests/             Plain-Node tests, no framework
build/             App icon and the script that generates it
```

The renderer never has access to Node or the file system. It can only call the
fixed list of operations in `electron/preload.js`, and every one of them is
validated in `electron/store.js` before anything is written. React is bundled
into `dist/` at build time, which is why `dependencies` is empty — the packaged
app ships only MyVault's own code.

---

## Where your data lives

| Build | Location |
| --- | --- |
| Installed | `%APPDATA%\MyVault\data\myvault.json` |
| Portable | `MyVault-Data\myvault.json` next to the `.exe` |

**Settings → Open folder** takes you straight there. Dated backups are kept in
the `backups` sub-folder (the last 10, at most one per 12 hours), plus whatever
you save yourself with **Backup**.

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

MIT.
