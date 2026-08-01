# Publishing MyVault

The goal: **people can download and install the program, and see nothing else.**
No source code, no commit history, no build files, no issues.

This is set up as two repositories, because GitHub has no way to make one file
in a private repository public.

| Repository | Visibility | Holds |
| --- | --- | --- |
| `aristoteleska-cmd/MyVault` (this one) | **Private** ✅ already | All the source, history and development |
| `aristoteleska-cmd/MyVault-Downloads` | **Public** — you create it | Nothing but a download page and the two `.exe` files |

Anyone visiting the public repository sees a download button, install
instructions and the licence. The code that produced it stays here, private.

---

## One-time setup

You only do this once. It takes about five minutes.

### 1. Create the public download repository

On GitHub: **New repository**

- **Name:** `MyVault-Downloads`
- **Visibility:** **Public**
- Tick **Add a README file** (you will replace it in a moment)
- Create it

### 2. Put the download page in it

Copy two files from this private repository into the new public one:

| Copy this file | To there, named |
| --- | --- |
| `publish/README.md` | `README.md` |
| `LICENSE` | `LICENSE` |

That is everything the public repository should ever contain. **Do not** copy
`src/`, `electron/`, `package.json` or anything else.

The easiest way: open the new repository on GitHub, click **Add file → Upload
files**, and drag those two in (renaming `publish/README.md` to `README.md`).

### 3. Give this repository permission to publish there

The build here needs to be allowed to attach files to a release over there.

1. Go to <https://github.com/settings/personal-access-tokens/new>
   (**Settings → Developer settings → Personal access tokens → Fine-grained**)
2. **Token name:** `MyVault publishing`
3. **Expiration:** whatever you are comfortable with — you will need to renew it
4. **Repository access:** *Only select repositories* → pick **MyVault-Downloads**
5. **Permissions → Repository permissions → Contents:** set to **Read and write**
6. **Generate token** and copy it — GitHub shows it only once

Then, in **this** repository (`MyVault`):

1. **Settings → Secrets and variables → Actions**
2. Tab **Secrets** → **New repository secret**
   - Name: `PUBLIC_RELEASE_TOKEN`
   - Value: the token you just copied
3. Tab **Variables** → **New repository variable**
   - Name: `PUBLIC_RELEASE_REPO`
   - Value: `aristoteleska-cmd/MyVault-Downloads`

---

## Publishing a version

Every time you want to give people a new version:

```bash
# 1. Set the version number
npm version 1.0.1 --no-git-tag-version

# 2. Commit it
git add package.json package-lock.json
git commit -m "Release 1.0.1"
git push

# 3. Tag it and push the tag — this is what triggers publishing
git tag v1.0.1
git push origin v1.0.1
```

That last push starts the build. It runs the tests, builds the Windows installer
and the portable `.exe`, and attaches **only those two files** to a new release
in the public repository. Nothing else crosses over.

Watch it under the **Actions** tab here. When it finishes, the download link on
the public page works immediately.

> The version in the tag (`v1.0.1`) and the version in `package.json` (`1.0.1`)
> should match. The tag is what names the release; `package.json` is what names
> the `.exe` files.

---

## Things worth knowing

**The warning Windows shows on first run.** Windows flags any program it has not
seen before as unrecognised. Users can click *More info → Run anyway*, and the
public page tells them so. The warning disappears only with a code-signing
certificate, which costs money each year (roughly €200–400 from a certificate
authority). Worth it if you ever distribute widely; unnecessary while you are
handing the file to shops you know.

**Releases in a private repository are private.** That is the whole reason for
the second repository — attaching a file to a release here would not make it
downloadable by anyone else.

**The build artifacts in the Actions tab stay private.** Every push builds the
app and keeps the `.exe` there for you to test. Only a version tag publishes.

**If you ever delete the public repository,** the download links break, but
nothing here is affected — just create it again and push a new tag.

**Keeping the source private is a choice you can reverse,** but not
retroactively: once the code has been public, copies may exist. Leaving this
repository private is what actually protects it. The licence protects you
legally; privacy protects you practically.
