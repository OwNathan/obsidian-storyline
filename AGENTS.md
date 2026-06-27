# AGENTS.md

## Project

Fork of [obsidian-storyline](https://github.com/PixeroJan/obsidian-storyline) — an Obsidian plugin that turns a vault into a book planning and writing tool. Plugin ID: `storyline`.

## Commands

| Task | Command |
|---|---|
| Dev (watch) | `npm run dev` |
| Production build | `npm run build` |
| Lint | `npm run lint:obsidian` |
| Typecheck | `npx tsc --noEmit` (no script alias) |

No test framework is configured. There are no tests.

`npm run version` references `version-bump.mjs` which does not exist in this fork — do not run it.

## Architecture

- **Entry point:** `main.ts` → bundled to `main.js` (CJS) via esbuild.
- **Plugin class:** `SceneCardsPlugin` (legacy name from original "scene-cards" plugin).
- **`obsidian`, `electron`, `@codemirror/*`** are external — never bundled, provided by the Obsidian runtime.
- **`.md` files** are loaded as text strings by esbuild (used for conversion templates).
- **tsconfig path aliases:** `models/*`, `views/*`, `components/*`, `services/*`, `utils/*` — use these in imports, not relative paths.

### Directory layout

| Directory | Purpose |
|---|---|
| `models/` | Data types: `Scene`, `Character`, `Location`, `Codex`, `PlotGridData`, `Research`, `StoryLineProject` |
| `services/` | Business logic managers: `SceneManager`, `CharacterManager`, `CodexManager`, `LinkScanner`, `SeriesManager`, `ExportService`, etc. |
| `views/` | 16 Obsidian `ItemView` subclasses (Board, Timeline, Plotgrid, Manuscript, Codex, etc.) |
| `components/` | Reusable UI: modals, inspector, filters, relationship map, virtual scroller |
| `utils/` | Small helpers: `actChapter`, `locale`, `narrow` (type narrowing) |
| `constants.ts` | View type string IDs (e.g. `BOARD_VIEW_TYPE`) |
| `settings.ts` | Settings interface, defaults, and the entire settings tab UI (~3400 lines) |

### Key patterns

- Every `.ts` file starts with a file-wide `eslint-disable` block suppressing `no-unsafe-*`, `no-unused-vars`, `no-floating-promises`, and others. This is intentional — do not remove it.
- Views are registered in `main.ts` `onload()` using `this.registerView(VIEW_TYPE, factory)`.
- Services are instantiated in `onload()` and stored on the plugin instance.
- File events (`vault.on('modify'|'delete'|'rename')`) are debounced and trigger `refreshOpenViews()`.
- Per-project data lives in `System/` JSON files inside each project folder, not in Obsidian's `data.json`.

## Conventions

- The plugin must work on both desktop and mobile Obsidian (`isDesktopOnly: false`). Guard any `electron` or desktop-only API with platform checks.
- Scene data is stored as Markdown files with YAML frontmatter — never break frontmatter round-tripping.
- `styles.css` is the single stylesheet; it is not processed or bundled.
- When adding a new view, register its type constant in `constants.ts`, register it in `main.ts` `onload()`, and add it to the `slViewTypes` array in the undo/redo keydown handler.

## Documentation

Detailed reference docs are in `docs/`:

| File | Contents |
|---|---|
| `docs/architecture.md` | System architecture, Mermaid diagrams, data flow, build pipeline, vault folder structure |
| `docs/developer-guide.md` | Setup, commands, dev workflow, adding views/services, mobile compatibility |
| `docs/models.md` | All data types: Scene, Character, Location, Codex, PlotGridData, Research, StoryLineProject |
| `docs/services.md` | All 21 services: constructors, key methods, responsibilities |
| `docs/views.md` | All 16 views: type constants, constructors, shared patterns, keyboard shortcuts |
| `docs/configuration.md` | Settings, per-project System/ files, constants, CSS variables, manifest |
