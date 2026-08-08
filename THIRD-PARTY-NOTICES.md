# Third-party notices

MyVault itself is covered by the terms in [LICENSE](LICENSE). It is, however,
built on open-source components that are licensed **separately by their own
authors**. Those components are not covered by MyVault's licence and keep their
own terms — which permit reuse — and their notices must be preserved.

The reserved-rights terms in `LICENSE` apply to MyVault's own code and to the
application as a whole. They do not, and cannot, restrict anyone's rights to the
components below.

## Bundled in the installed application

| Component | Licence | Used for |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | MIT | The desktop application shell |
| [Chromium](https://www.chromium.org/) (via Electron) | BSD-3-Clause and others | Rendering the interface |
| [Node.js](https://nodejs.org/) (via Electron) | MIT | Reading and writing your data file |
| [React](https://github.com/facebook/react) | MIT | The user interface |
| [React DOM](https://github.com/facebook/react) | MIT | The user interface |

Electron ships its own licence texts inside the installed application
(`LICENSE.electron.txt` and `LICENSES.chromium.html`). Those files must be kept
as they are — do not remove them from a build you distribute.

## Used only to build the app, not shipped inside it

| Component | Licence |
| --- | --- |
| [Vite](https://github.com/vitejs/vite) | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [esbuild](https://github.com/evanw/esbuild) | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | MIT |
| [NSIS](https://nsis.sourceforge.io/) (via electron-builder) | zlib/libpng licence |
| [concurrently](https://github.com/open-cli-tools/concurrently) | MIT |
| [cross-env](https://github.com/kentcdodds/cross-env) | MIT |
| [wait-on](https://github.com/jeffbski/wait-on) | MIT |

Everything else in this repository — the interface, the data store, the search
and sorting, the icon, the translations and the styling — is MyVault's own work
and is covered by [LICENSE](LICENSE).

Run `npm ls --all` to see the full dependency tree, including transitive
build-time packages.
