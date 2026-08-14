# Developer Guide

## Prerequisites

- Node.js 18+
- npm
- Obsidian (for testing)

## Setup

```bash
npm install
```

## Commands

| Task | Command | Notes |
|---|---|---|
| Dev (watch) | `npm run dev` | Runs esbuild in watch mode with inline sourcemaps |
| Production build | `npm run build` | Minified output, no sourcemaps |
| Lint | `npm run lint:obsidian` | ESLint with `eslint-plugin-obsidianmd` |
| Typecheck | `npx tsc --noEmit` | No script alias exists for this |

There is no test framework configured. There are no tests.

Do not run `npm run version` -- it references `version-bump.mjs` which does not exist in this fork.

## Development Workflow

1. Run `npm run dev` to start the esbuild watcher.
2. Symlink or copy the project root into your Obsidian vault's `.obsidian/plugins/storyline/` folder.
3. Enable the plugin in Obsidian settings.
4. Edit source files; esbuild rebuilds `main.js` automatically.
5. In Obsidian, use the "Reload app without saving" command (Ctrl+R) or the Hot-Reload plugin to pick up changes.

## Build Output

- **Entry point:** `main.ts`
- **Bundle:** `main.js` (CommonJS, ES2018 target)
- **Stylesheet:** `styles.css` (not processed or bundled, loaded directly by Obsidian)
- **Markdown templates:** `StoryLine-Conversion-Template.md` and `StoryLine-Scene-Conversion-Template.md` are loaded as text strings by esbuild's `text` loader.

### External Dependencies (not bundled)

These are provided by the Obsidian runtime and marked external in `esbuild.config.mjs`:

- `obsidian`
- `electron`
- `@codemirror/*` (autocomplete, collab, commands, language, lint, search, state, view)
- `@lezer/*` (common, highlight, lr)

### Bundled Dependencies

These are included in `main.js`:

- `pdf-lib` + `@pdf-lib/fontkit` (PDF export)
- `fflate` (compression for DOCX)
- `highlight.js` (syntax highlighting)
- `lucide` (icons)
- `markdown-it` + plugins (Markdown rendering for export)

## TypeScript Configuration

- **Target:** ES6
- **Module:** ESNext
- **Module resolution:** Node
- **Strict null checks:** enabled
- **Path aliases:** `models/*`, `views/*`, `components/*`, `services/*`, `utils/*`

Use path aliases in imports, not relative paths:
```typescript
import { SceneManager } from 'services/SceneManager';
import { Scene } from 'models/Scene';
```

## Linting

ESLint uses flat config (`eslint.config.mjs`) with:
- `@typescript-eslint/parser` (project-aware, uses `tsconfig.json`)
- `eslint-plugin-obsidianmd` recommended rules

Every `.ts` file has a file-wide `eslint-disable` block at the top suppressing `no-unsafe-*`, `no-unused-vars`, `no-floating-promises`, and others. This is intentional and must not be removed.

## Adding a New View

1. Add a view type constant in `constants.ts`:
   ```typescript
   export const MY_VIEW_TYPE = 'story-line-my-view';
   ```

2. Create the view class in `views/MyView.ts` extending `ItemView`.

3. Register the view in `main.ts` `onload()`:
   ```typescript
   this.registerView(MY_VIEW_TYPE, (leaf) =>
       new MyView(leaf, this, this.sceneManager)
   );
   ```

4. Add the view type to the `slViewTypes` array in the undo/redo keydown handler in `main.ts`.

5. Optionally add a command in `onload()` to activate the view.

## Dynamic Narrative Feature

The Dynamic Narrative feature is isolated in `dynamic-narrative/` and adds a new entity hierarchy (Scenarios → Objectives → Arcs → Quests) separate from the main scene/character/location system.

### Directory layout

| Directory | Purpose |
|---|---|
| `dynamic-narrative/models/` | Data types: Scenario, Objective, Arc, Quest + shared types, type guards, utilities |
| `dynamic-narrative/services/` | `DynamicNarrativeManager` — CRUD, file I/O, phase management, cascade rename, categories |
| `dynamic-narrative/views/` | `DynamicNarrativeView` — Single ItemView with 5 tabs + resizable inspector |
| `dynamic-narrative/components/` | UI components: overview, vertical phase board, type/quest grids, inspector, modals (create, phase, category) |

### Key patterns

- **Model files** define entity interfaces extending `DNBase` from `types.ts`.
- **Empty creators** (`createEmptyScenario`, etc.) provide defaults including default phases where applicable.
- **Factory pattern** for phases: `types.ts` exports `createDefaultPhase()` and `createDefaultPhases()`.
- **Type guards** (`isScenario`, `isObjective`, `isArc`, `isQuest`) for narrowing union types.
- **Shared utilities** in `types.ts`: `resolveWikilinkPath`, `deepClone`, `debounce`, `deriveShortDesc`, `getOrderedPhases`, `isDefaultPhase`.
- **Save mutex**: `DynamicNarrativeManager.saveSystemJson()` uses a promise-chain queue to serialize writes.
- **Undo integration**: All update methods pass deep-cloned snapshots to the existing `UndoManager`.
- **Cascade rename**: Wired into `main.ts` vault rename events via `DynamicNarrativeManager.cascadeRename()`.
- **Vault events**: `delete` and `rename` events are handled by `DynamicNarrativeManager.handleFileDeleted()` and cascade rename.
- **Debounced search**: Overview, Kanban, and QuestGrid use a 200ms debounce on search input.
- **Resize handle**: Inspector resize supports both mouse and touch events with proper cleanup on close. Width is session-only (stored in-memory on the view).
- **Phase management**: 5 hardcoded default phases (QuestSleeping, QuestAvailable, QuestStarted, QuestCompleted, QuestFailed) plus user-defined custom phases. Objective and Arc Types own the phase structure; Objective Variants can store field overrides, while Arc Variants read phases from their Arc Type and store only root-level overrides and linked quest lists.
- **Dynamic Narrative boards**: Scenario and Objective Variant tabs use vertically stacked phase panels. Arc Variants use a root-level board with Conditions/Commands Overrides and four category-specific quest groups, without phase panels or drag-and-drop.
- **Linked entity suggestors**: Scenario/Objective Linked Locations, Linked Characters, and Arc Variant root quest links (Goals/Limits/Events/Modifiers) use `renderTagPillInput` with autocomplete suggestions from `LocationManager`, `CharacterManager`, and `DynamicNarrativeManager.getAllQuests()` respectively. Linked-card comments are rendered consistently across all three boards as a one-line preview with a hover tooltip.
- **Open/delete actions**: Inspector header includes file-open (opens `.md` file in new tab) and delete (confirmation modal via `openConfirmModal`) buttons.
- **Quest tab**: The inspector panel is hidden when the Quests tab is active.
- **Scenarios have no default phases**; Objectives, Arcs, and Quests each start with the 5 defaults.

When modifying DN code, keep files isolated within `dynamic-narrative/` and only touch the 6 shared files when absolutely necessary for upstream merge safety.

## Adding a New Service

1. Create the service class in `services/MyService.ts`.
2. Instantiate it in `main.ts` `onload()` and store on the plugin instance.
3. Wire up any file event handlers or cross-service dependencies.

## Mobile Compatibility

The plugin has `isDesktopOnly: false` in `manifest.json`. Any `electron` or desktop-only API usage must be guarded with platform checks:

```typescript
import { Platform } from 'obsidian';

if (Platform.isDesktopApp) {
    // electron-only code
}
```

## Frontmatter Round-Tripping

Scene, character, location, and codex data is stored as YAML frontmatter in Markdown files. The `MetadataParser` service handles parsing and serialization. Never break frontmatter round-tripping -- always preserve unknown fields when writing back.

## Mirroring Rule (Issue #228 phase 2)

> **Every custom field of type Text or Text block is mirrored to the entity note's body automatically, as `# Section` / `## Field` headings appended after a single `<!-- sl-mirror -->` separator. Default fields are never mirrored. There is no per-field toggle and no exception.**

Consequences:

- On **save** (UI edit in StoryLine), the body is regenerated from the in-memory entity's custom fields via `buildMirroredBody(notesContent, mirrored)` (`services/CodexManager.ts`). `mirrored` is built by `EntityTemplateService.buildAutoMirroredSections`, which iterates the custom-section template fields of type `text` / `textarea` -- so adding or removing a custom text / text-block field automatically changes the body shape on the next save.
- On **load**, the managers' parsers (`CharacterManager.parseCharacterContent`, `LocationManager.parseAndStoreContent`, `CodexManager.parseEntry`, and `MetadataParser` for scenes) call `parseMirroredBody(body)` and apply **body wins** -- the body's mirrored values overwrite the frontmatter values in the in-memory entity. Frontmatter is the source of truth only for default fields; the body is the source of truth for custom text / text-block fields.
- The `EntityFileSyncService` (`services/EntityFileSyncService.ts`) silently reconciles the on-disk frontmatter when the body is edited directly in Obsidian (not from StoryLine). It watches `vault.on('modify')` for entity files, debounces 800 ms, diffs the body's mirrored values against the frontmatter, and -- only if they diverge -- reloads entities via `loadActiveProjectEntities()` and rewrites the file through the relevant manager `saveXxx`. Loop protection is provided by the managers' `isSelfWrite()` flags, a per-path `selfPaths` grace set, and the idempotent diff check.

The legacy per-field `mirrorToMd` flag and the "Mirror to note body" toggle button have been removed. Any `mirrorToMd` key present in an existing `entity-templates.json` is stripped on the next load (`EntityTemplateService.normalizeSection`).

## Version Management

- Plugin version is in `manifest.json` and `package.json` (keep in sync).
- `minAppVersion` in `manifest.json` specifies the minimum Obsidian version.
- There is no `versions.json` in this fork.
