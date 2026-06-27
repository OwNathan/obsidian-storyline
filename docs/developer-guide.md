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

## Version Management

- Plugin version is in `manifest.json` and `package.json` (keep in sync).
- `minAppVersion` in `manifest.json` specifies the minimum Obsidian version.
- There is no `versions.json` in this fork.
