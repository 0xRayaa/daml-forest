# 🌲 DamlForest

**Grow into a DAML security expert.** An interactive, browser-based learning trail for spotting and fixing vulnerabilities in [DAML](https://www.digitalasset.com/developers) smart contracts — from tiny *Seedling* to *Ancient Tree*.

No build step. No backend. Open [index.html](index.html) and start learning.

---

## What's inside

- **6 courses** spanning beginner → advanced, with hands-on code challenges:
  1. 📜 DAML Fundamentals
  2. 🔐 Authorization & Parties
  3. ⚖️ Privacy & Divulgence
  4. ⚗️ Value Conservation
  5. ⏱️ Time & Deadlines
  6. 🔑 Keys & Governance
- **In-browser DAML editor** powered by Monaco, with custom DAML syntax highlighting and pattern-based challenge validation ([editor.js](editor.js)).
- **Gamified progression** — 6 growth ranks (Seedling → Sapling → Young Tree → Forest Guardian → Elder Tree → Ancient Tree) earned by fixing bugs and completing chapters ([app.js](app.js)).
- **Standalone learning curriculum** — 12 markdown lessons in [learning/](learning/) covering the ledger model, choices, authorization, divulgence, UTXO conservation, time/skew, keys, Daml Script, interfaces, functional patterns, and governance/arithmetic. Start at [learning/INDEX.md](learning/INDEX.md).

## Local deployment

DamlForest is a fully static site — no build step, no backend, no package manager. Follow the steps below end-to-end.

### Prerequisites

Before you start, make sure you have:

1. **A modern browser** — Chrome, Firefox, Safari, or Edge (latest versions).
2. **Git** — to clone the repo. Verify with `git --version`.
3. **One static HTTP server.** Any of these works; pick what's already installed:
   - Python 3 (ships with macOS and most Linux distros) — `python3 --version`
   - Node.js 18+ — `node --version`
   - PHP 7+ — `php --version`
   - Docker — `docker --version`
4. **Internet access on first load.** Monaco Editor is fetched from `cdnjs.cloudflare.com` ([index.html:349-351](index.html#L349-L351)). Once the browser has cached it, later visits work offline.

> **Why a server?** You *can* double-click `index.html` and it will partially work, but some browsers block CDN scripts and JS modules under the `file://` origin. Serving over `http://` avoids that.

---

### Step 1 — Clone the repository

```bash
git clone <this-repo-url>
cd daml-forest
```

Confirm the files are there:

```bash
ls
# expected: app.js  courses.js  editor.js  index.html  learning  styles.css  README.md
```

### Step 2 — Start a local HTTP server

Run **one** of the commands below from inside `daml-forest/`. All of them serve the current directory on port `8000`.

**Option A — Python 3** (recommended, zero install on macOS/Linux)

```bash
python3 -m http.server 8000
```

**Option B — Node.js via `npx`** (no global install needed)

```bash
npx --yes http-server -p 8000 -c-1 .
# -c-1 disables caching so edits show up on refresh
```

**Option C — PHP**

```bash
php -S localhost:8000
```

**Option D — Docker** (uses nginx, keeps your host clean)

```bash
docker run --rm -p 8000:80 -v "$PWD":/usr/share/nginx/html:ro nginx:alpine
```

**Option E — VS Code "Live Server" extension**

1. Install the *Live Server* extension (publisher: Ritwick Dey).
2. Right-click `index.html` in the Explorer pane.
3. Choose **Open with Live Server**. It picks its own port (usually 5500).

Leave the terminal running — stopping it (`Ctrl+C`) shuts the server down.

### Step 3 — Open the app

Visit **http://localhost:8000** in your browser. You should see the green *DamlForest* hero. Click **Enter the Forest** to start.

If you used Docker or a different port, adjust the URL accordingly.

### Step 4 — Verify it works

A correct install will show:

- ✅ Hero page renders with an animated tree.
- ✅ Clicking **Trails** lists 6 courses.
- ✅ Opening any chapter loads the Monaco code editor with DAML syntax highlighting.
- ✅ The **Run / Check** button validates your code against the chapter's required patterns.

If the editor area stays blank, open DevTools → **Console** and look for blocked requests to `cdnjs.cloudflare.com` — that's the CDN issue from the prerequisites.

---

### Resetting your progress

All state is kept in `localStorage` under the key `damlforest_state` ([app.js:160,164](app.js#L160)). Nothing leaves your browser. To wipe it:

```js
// Paste into DevTools → Console
localStorage.removeItem("damlforest_state");
location.reload();
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Address already in use` on port 8000 | `lsof -i :8000` to find the culprit, or pick another port (e.g. `python3 -m http.server 5173`). |
| Editor area is blank | CDN blocked — check Console for failed requests to `cdnjs.cloudflare.com`; allow it in your adblocker / firewall. |
| Changes to `.js` / `.css` don't show up | Hard-reload (`Cmd/Ctrl + Shift + R`), or run `http-server -c-1` to disable caching. |
| `python3: command not found` | Install Python 3, or use one of the other server options. |

### Deploying to a public host

Because the source *is* the deploy artifact, any static host works — GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3 + CloudFront, Surge. Configuration:

- **Build command:** *(none)*
- **Publish / output directory:** `daml-forest/` (or `.` if the repo root *is* `daml-forest/`)

## Repository layout

| Path | Purpose |
|------|---------|
| [index.html](index.html) | Single-page app shell — hero, course grid, chapter view |
| [styles.css](styles.css) | Forest-themed styling, animations, rank visuals |
| [app.js](app.js) | Navigation, rank progression, progress persistence, tree SVGs |
| [courses.js](courses.js) | All course/chapter content: theory, tasks, starter code, solutions, validation patterns |
| [editor.js](editor.js) | Monaco setup, DAML Monarch grammar, dark theme |
| [learning/](learning/) | Standalone markdown curriculum (12 lessons + index) |

## Curriculum at a glance

| # | Lesson | Level |
|---|--------|-------|
| 1 | Intro to DAML | Beginner |
| 2 | Choices | Beginner |
| 3 | Data Types & `ensure` | Beginner |
| 4 | Parties & Authority | Beginner → Intermediate |
| 5 | Privacy & Divulgence | Intermediate |
| 6 | UTXO & Conservation | Intermediate |
| 7 | Time & Deadlines | Intermediate → Advanced |
| 8 | Keys & Contention | Advanced |
| 9 | Daml Script Testing | Advanced |
| 10 | Interfaces | Advanced |
| 11 | Functional Programming | Advanced |
| 12 | Governance & Arithmetic | Advanced |

See [learning/INDEX.md](learning/INDEX.md) for the full map, role-based learning paths, and the **Top 10 DAML Security Checklist**.

## Adding or editing challenges

Every chapter lives as a plain JS object in [courses.js](courses.js):

```js
{
  id: "1-1",
  title: "What is DAML?",
  theory: `<h1>...</h1>`,            // HTML shown in the chapter intro
  task: "Add a signatory line ...",  // one-sentence instruction
  hint: "Use: signatory bank",
  initialCode: `template ...`,       // starter code in the editor
  solution: `template ...`,          // reference solution
  requiredPatterns: ["signatory bank"], // substrings that must appear to pass
  forbiddenPatterns: []                 // substrings that must NOT appear
}
```

Add a new entry to the relevant course's `chapters` array and reload. Progress is stored in `localStorage`.
