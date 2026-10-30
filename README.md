# ResearchDeck

A **local-first** research deck desktop app. All user data stays on the user's computer — no servers, no accounts, no database.

## Tech Stack

| Layer         | Choice                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Desktop shell | [Electron](https://www.electronjs.org/) (latest stable)                                                |
| Build tooling | [electron-vite](https://electron-vite.org/) — one Vite pipeline for main / preload / renderer with HMR |
| UI            | React 19 + TypeScript (strict)                                                                         |
| Styling       | Tailwind CSS v4 (`@tailwindcss/vite` plugin, CSS-first config)                                         |
| IPC           | Typed `contextBridge` API exposed from a sandboxed preload script                                      |
| Data storage  | Plain local files in the OS user-data directory (JSON via Node `fs`)                                   |
| Packaging     | electron-builder → dmg (macOS) / NSIS (Windows) / AppImage + deb + rpm (Linux)                         |
| Code quality  | ESLint + Prettier (electron-toolkit configs)                                                           |

## Design decisions

- **No SQLite, no backend.** Every piece of data lives as ordinary files under the OS user-data
  directory (`app.getPath('userData')`). All file I/O happens in the main process and is exposed to
  the UI only through the preload bridge. Revisit a database only if relational queries ever
  become necessary.
- **Electron over Tauri.** Chosen for implementation ease: full Node.js APIs in the main process
  and one consistent Chromium renderer on every platform. Accepted trade-off: larger installers
  (~100 MB) and on-disk footprint.
- **Web-ready by construction.** All privileged operations must live behind the preload `api`
  bridge, so the React renderer can later ship as a website / PWA with a small browser-API adapter.
- **Mobile.** Electron has no mobile runtime; if mobile becomes a requirement later, evaluate
  reusing the React UI with Capacitor or React Native.

## Vaults (local-first data model)

- **App-level registry** — `vaults.json` in Electron's `userData` dir
  (`~/Library/Application Support/ResearchDeck/` on macOS): the list of vaults
  (id, display name, absolute folder path, timestamps) plus `lastVaultId`, which is
  auto-reopened on launch. Written atomically (temp file + rename).
- **Per-vault marker** — `<vault>/.researchdeck/config.json` marks a folder as a vault
  (like Obsidian's `.obsidian/`); it is created when a vault is added and used to detect
  pre-existing vault folders. If the marker is deleted, it is automatically restored —
  on the next vault open and on the next session save (which also recreates the folder).
- **Per-vault session** — `<vault>/.researchdeck/session.json` (debounced, atomic) stores
  the open tabs (vault-relative paths) and the active tab, so reopening a vault restores
  the workspace exactly as it was left. Tabs whose files no longer exist are dropped
  silently on restore.
- **Protection** — duplicate vault folders and ancestor/descendant vault nesting are
  rejected; removing a vault only unlinks it from the list (folder deletion is opt-in
  behind a typed confirmation).
- **File tree** — `vault:readTree` scans the vault folder recursively (hidden entries and
  `.researchdeck/` excluded), capped at depth 10 / 5,000 nodes with a `truncated` flag.

## Project structure

```
src/
├── main/       # Electron main process (Node side): windows, file I/O, native APIs
├── preload/    # Sandboxed bridge: exposes a typed `window.api` to the renderer
└── renderer/   # React UI (Vite + Tailwind)
```

## Getting started

Prerequisites: Node.js ≥ 20.

```bash
npm install
npm run dev
```

## Scripts

| Command                                           | Description                                        |
| ------------------------------------------------- | -------------------------------------------------- |
| `npm run dev`                                     | Dev mode with hot reload                           |
| `npm run build`                                   | Typecheck + bundle main/preload/renderer to `out/` |
| `npm run typecheck`                               | Typecheck both node and web tsconfigs              |
| `npm run lint` / `npm run format`                 | ESLint / Prettier                                  |
| `npm run build:unpack`                            | Package an unpacked app (quick smoke test)         |
| `npm run build:mac` / `build:win` / `build:linux` | Package installers via electron-builder            |

> Note: before shipping Linux builds, replace the placeholder maintainer email in
> `electron-builder.yml`.

## Roadmap

- [x] Desktop scaffold (macOS / Windows / Linux)
- [x] Vaults: folder-as-vault, multi-vault registry, setup & management UI
- [x] File-tree browser + multi-tab workspace with per-vault session restore
- [x] Light/dark theme (default: light)
- [ ] File viewer/editor for open tabs
- [ ] Auto-refreshing file tree (fs.watch) and search
- [ ] Deck research features
- [ ] Web (PWA) build sharing the React renderer
