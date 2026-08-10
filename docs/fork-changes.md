# Fork Changes Tracker

Tracks all modifications to the shared obsidian-storyline codebase. Use this when rebasing/merging upstream changes.

## Last Updated
2026-06-29

## Modified Files

### constants.ts
- Added `DYNAMIC_NARRATIVE_VIEW_TYPE = 'story-line-dynamic-narrative'` constant

### main.ts
- Imports: Added `DynamicNarrativeManager`, `DynamicNarrativeView`, `DYNAMIC_NARRATIVE_VIEW_TYPE`, `deriveProjectFoldersFromFilePath`
- Plugin class: Added `dynamicNarrativeManager` property
- `onload()`: Instantiate DN manager, register DN view, add to `slViewTypes`, add command
- `onload()`: Vault `rename` handler includes `dynamicNarrativeManager.cascadeRename()` call
- `onload()`: Vault `delete` handler includes `dynamicNarrativeManager.handleFileDeleted()` call
- `refreshOpenViews()`: Added DN manager initialization + DN view refresh
- `onunload()`: Added `dynamicNarrativeManager.destroy()` cleanup
- **Added `isSystemFile(filePath)` method** — checks if a path is within the project's `System/` folder, used to prevent refresh feedback loops
- **Vault event handlers patched** — `modify`/`delete`/`rename` handlers skip files in `System/` folder to break the refresh loop caused by `refreshCodexDigests()` writing to `codex-digests.json`
- **`modify` handler** — only calls `debouncedRefresh()` when `handleFileChange()` returns `true` (i.e., the file was actually processed)
- **`modify` handler** — when `handleFileChange()` returns `false`, checks for codex, character, and location/world file modifications (`.md` under respective folder, not self-write) and triggers `debouncedRefresh()` for body-mirrored field parsing
- **`onload()` bootstrap** — calls `codexManager.setFieldTemplates()`, `characterManager.setFieldTemplates()`, `locationManager.setFieldTemplates()` after `fieldTemplates.load()` so managers can resolve universal field template IDs during body parse

### services/SceneManager.ts
- **`handleFileChange()` returns `boolean`** — `true` if the file was processed (scene/notes `.md` file), `false` if filtered out. Used by `main.ts` to conditionally trigger a view refresh.

### settings.ts
- Interface: Added `dnScenarioCategories`, `dnObjectiveCategories`, `dnQuestCategories`, `dnKanbanShowFullHeader`
- `DEFAULT_SETTINGS`: Added defaults for all DN fields
- Settings tab UI: Added "Dynamic Narrative" section with category management and kanban header toggle
- **Removed `dnInspectorWidth`** — inspector width is now session-only (stored in-memory on the view), not persisted to settings
- **Added `mirroredFields: Record<string, string[]>`** — per-category list of textarea field keys whose content is synced to the md body as H1/H2 sections
- `DEFAULT_SETTINGS`: Added `mirroredFields: {}`
- **Added `sceneCategoriesEnabled: boolean`** — opt-in toggle for scene categories feature
- **Added `sceneCategories: SceneCategoryDef[]`** — user-defined scene category definitions (id, label, color, icon)
- **Added `defaultSceneCategory: string`** — default category assigned to new scenes
- `DEFAULT_SETTINGS`: Added `sceneCategoriesEnabled: false`, `sceneCategories: [{ id: 'generic', label: 'Generic', color: '#9E9E9E', icon: 'folder' }]`, `defaultSceneCategory: 'generic'`
- **Settings tab: Scene Categories section** — toggle, default dropdown, inline category rows (color, label, icon, remove), add button; all with `registerSceneCategories()` + `refreshOpenViews()`
- **Color coding dropdown** — added "By Category" option (`'category'`)

### models/Scene.ts
- **Added `SceneCategoryDef` interface** — `{ id, label, color, icon }`
- **Added `SceneCategory` type** — `string`
- **Added `category` field** to `Scene` interface (`category?: SceneCategory`)
- **ColorCodingMode** — added `'category'` to the union type
- **Added `registerSceneCategories(defs)`** — module-level registry function
- **Added `getSceneCategoryConfig()`** — returns `Record<string, SceneCategoryDef>`
- **Added `getSceneCategoryOrder()`** — returns ordered `string[]` of category IDs
- **Added `resolveSceneCategoryCfg(id)`** — safe resolver with fallback

### services/MetadataParser.ts
- **`parseContent()`** — added `category: this.normalizeFrontmatterString(frontmatter.category)` to parse output
- **`generateSceneContent()`** — added `if (scene.category) fm.category = scene.category;` after status
- **`updateFrontmatter()`** — added `category` cleanup: `if (key === 'category' && !value) { delete frontmatter[key]; continue; }`

### components/SceneCard.ts
- Import: Added `resolveSceneCategoryCfg`
- **Icon rendering** — when `sceneCategoriesEnabled`, uses category icon+label instead of status icon+label
- **`getCardColor()`** — added `case 'category':` returning `resolveSceneCategoryCfg(...).color`

### components/Inspector.ts
- Import: Added `SceneCategory`, `getSceneCategoryOrder`, `resolveSceneCategoryCfg`
- **Added `onCategoryChange` callback** to constructor class property and `callbacks` interface
- **Status + Category dropdowns** — refactored into a single `inspector-section` flex row when categories enabled; category dropdown renders only when `sceneCategoriesEnabled` is true
- Both dropdowns reuse existing `.inspector-status-dropdown` / `.inspector-status-button` / `.inspector-status-item` CSS classes

### views/BoardView.ts
- **Added `onCategoryChange` callback** in both mobile and desktop InspectorComponent instantiations — calls `updateScene({ category })` + `refreshBoard()`

### views/DetailsView.ts
- **Added `onCategoryChange` callback** — calls `updateScene({ category })` + `refreshCurrentScene()`

### views/PlotgridView.ts
- **Added `onCategoryChange` callback** in both InspectorComponent instantiations (main inspector + cell inspector) — calls `updateScene({ category })` + `renderGrid()`

### views/SceneInspectorView.ts
- **Added `onCategoryChange` callback** — calls `updateScene({ category })` + `refreshCurrentScene()`

### views/TimelineView.ts
- **Added `onCategoryChange` callback** — calls `updateScene({ category })` + `refresh()`

### main.ts
- Import: Added `registerSceneCategories` from `models/Scene`
- **`onload()`** — added `registerSceneCategories(this.settings.sceneCategories || [])` after `registerCustomStatuses`
- **`saveSettings()`** — added `registerSceneCategories(this.settings.sceneCategories || [])` after `registerCustomStatuses`

### styles.css
- **Added `.inspector-dropdown-wrap`** style (`white-space: nowrap`) for side-by-side dropdown layout

### styles.css
- End of file: Added all `dn-*` prefixed styles (~600 lines covering view layout, tabs, inspector, overview, kanban, quest grid, cards, modals, phases, fields, empty states)
- **Added `.field-mirror-btn*` styles** — mirrors `.field-hide-btn` pattern (hover-on opacity, accent color on hover); `.field-mirror-btn-active` for mirrored state
- **Added `.codex-universal-label-wrap .field-mirror-btn` hover rules** — opacity 0 by default, 0.6 on label wrap hover, 1 (accent) on button hover
- **Added `.character-universal-label-wrap .field-mirror-btn` hover rules** — same pattern as codex label wrap
- **Added `.field-mirror-btn` hover visibility for `.character-field-row`, `.codex-field-row`, `.location-field-row`**

### components/ViewSwitcher.ts
- **Added `DYNAMIC_NARRATIVE_VIEW_TYPE` import**
- **Added "Dynamic Narrative" button** (`{ type: DYNAMIC_NARRATIVE_VIEW_TYPE, label: 'Dynamic Narrative', icon: 'map' }`) between Plotlines and Manuscript in `VIEW_ENTRIES`

### views/DetailsView.ts, views/NotesView.ts, views/SceneInspectorView.ts, views/SynopsisView.ts
- **Added `file` parameter to `vault.on('modify')` callbacks** (where missing)
- **Added System folder guard** (`if (this.plugin.isSystemFile(file.path)) return;`) to prevent refresh cascades from the plugin's own file writes

### services/DynamicNarrativeManager.ts
- **Removed `getInspectorWidth()` and `setInspectorWidth()`** — inspector width is now session-only, managed directly by the view

### dynamic-narrative/components/DNInspector.ts
- **Open/delete buttons** — changed CSS class from `clickable-icon` to `codex-detail-action-btn` (and `codex-detail-action-btn codex-detail-delete-btn` for delete), matching CodexView/CharacterView/LocationView pattern

### services/CodexManager.ts
- **Exported `MirroredSection` interface** — `{ sectionTitle, fieldKey, fieldLabel, value }`
- **Exported `ParsedMirrorSection` interface** — `{ sectionTitle, fieldLabel, value }` (produced by body parser; no field key — resolved later)
- **Exported `MIRROR_SEPARATOR` constant** — `<!-- sl-mirror -->`, single delimiter between notes and mirrored H1/H2 sections (replaces per-section `MIRROR_MARKER_BEGIN`/`MIRROR_MARKER_END`)
- **Exported `buildMirroredBody(notes, mirrored)`** / **`parseMirroredBody(body)`** — standalone shared body construction/parsing utilities; `parseMirroredBody` returns `{ notes, sections: ParsedMirrorSection[] }` instead of the old `{ notes, mirroredValues: Map }`
- **Added `_isSaving` guard flag + `isSelfWrite()`** — prevents vault modify feedback loops during plugin writes
- **Added `setFieldTemplates(templates)`** — receives `UniversalFieldTemplate[]` from main.ts; needed by `resolveMirrorKey()` during body parse
- **`saveEntry(entry, mirrored?)`** — accepts optional `MirroredSection[]`; strips old mirrored content from body via `parseMirroredBody()`, rebuilds with `buildMirroredBody(notes, mirrored)` using single separator + H1/H2 structure; wraps `vault.modify()` in `_isSaving` guard
- **`parseEntry()`** — calls `parseMirroredBody()` → gets `{ notes, sections }`; resolves each section's `sectionTitle`+`fieldLabel` → field key via `resolveMirrorKey()`; body values override frontmatter
- **`resolveMirrorKey(sectionTitle, fieldLabel, catDef)`** — private helper: matches against universal field templates by section+label, then against built-in fields in `catDef.categories` by section title+field label, falls back to composite custom-section key

### services/CharacterManager.ts
- **Imported `MirroredSection`, `buildMirroredBody`, `parseMirroredBody`, `ParsedMirrorSection`** from `CodexManager`; `CHARACTER_CATEGORIES` from models; `UniversalFieldTemplate` from FieldTemplateService
- **Added `_isSaving` guard flag + `isSelfWrite()`** — prevents vault modify feedback loops
- **Added `setFieldTemplates(templates)`** — for resolving universal field keys during body parse
- **`saveCharacter(character, mirrored?)`** — strips old mirrored content from body, rebuilds via `buildMirroredBody()`; wraps `vault.modify()` in `_isSaving` guard
- **`parseCharacterContent()`** — calls `parseMirroredBody()` → `{ notes, sections }`; resolves sectionTitle+fieldLabel → field key via `resolveMirrorKey()`; applies body values over frontmatter
- **`resolveMirrorKey(sectionTitle, fieldLabel)`** — private helper: matches universal templates, then `CHARACTER_CATEGORIES`, falls back to composite key

### services/LocationManager.ts
- **Imported `MirroredSection`, `buildMirroredBody`, `parseMirroredBody`, `ParsedMirrorSection`** from `CodexManager`; `WORLD_CATEGORIES`, `LOCATION_CATEGORIES` from models; `UniversalFieldTemplate` from FieldTemplateService
- **Added `_isSaving` guard flag + `isSelfWrite()`** — prevents vault modify feedback loops
- **Added `setFieldTemplates(templates)`** — for resolving universal field keys during body parse
- **`saveWorld(world, mirrored?)`** / **`saveLocation(loc, mirrored?)`** — accept optional `MirroredSection[]`, passed through to `saveItem()`
- **`saveItem(item, fieldKeys, mirrored?)`** — strips old mirrored content, rebuilds via `buildMirroredBody()`; wraps in `_isSaving` guard
- **`parseAndStoreContent()`** — calls `parseMirroredBody()` → `{ notes, sections }`; resolves sectionTitle+fieldLabel → field key via module-level helper functions `applySectionsToWorld`/`applySectionsToLocation`; applies body values over frontmatter for both branches
- **Module-level helpers** — `resolveLocationMirrorKey()`, `applySectionsToWorld()`, `applySectionsToLocation()`, `applyMirrorValue()` generic helper

### views/CodexView.ts
- Import: Added `MirroredSection` from `CodexManager`
- **`renderField()`** — after hide/unhide toggle, added mirror toggle (`file-text` icon) for `multiline` fields; **force-saves entity immediately** after toggling (builds `MirroredSection[]`, calls `saveEntry()`, clears pending debounce, then saves settings & re-renders)
- **`renderUniversalField()`** — added mirror toggle for `textarea` type; method signature accepts new `categoryId` parameter; **force-saves immediately** on toggle
- **`executeSave()`** — builds `MirroredSection[]` from `settings.mirroredFields[draft.type]`; passes to `saveEntry()`
- **`resolveMirroredSectionInfo()`** — helper resolving section info for built-in keys (scanned from `catDef.categories`), universal IDs (via `fieldTemplates.getById()`), and composite keys
- **`buildCustomSectionsHost()`** — added `isFieldMirrored` / `toggleFieldMirror` callbacks; **force-saves immediately** on toggle

### views/CharacterView.ts
- Import: Added `MirroredSection`, `CUSTOM_SECTION_KEY_SEP`
- **`renderField()`** — after hide/unhide toggle, added mirror toggle (`file-text` icon) for `field.multiline` fields; toggles key in `settings.mirroredFields['character']`; **force-saves entity immediately** (builds `MirroredSection[]`, calls `saveCharacter()`, clears pending debounce, then saves settings & re-renders)
- **`renderUniversalField()`** — added `categoryId` parameter; added mirror toggle for `tpl.type === 'textarea'`; **force-saves immediately** on toggle
- **`scheduleSave()` / `flushPendingSave()`** — builds `MirroredSection[]` from `settings.mirroredFields['character']`, passes `mirrored` to `saveCharacter()`
- **`resolveMirroredSectionInfo()`** — async helper scanning `CHARACTER_CATEGORIES`, universal field templates, and composite keys
- **`buildCustomSectionsHost()`** — added `isFieldMirrored` / `toggleFieldMirror` callbacks (keyed to `'character'`); **force-saves immediately** on toggle
- **Mirror toggle re-render** — uses `renderView()` instead of `renderCharacterDetail()` to preserve view headers/toolbar

### views/LocationView.ts
- Import: Added `MirroredSection`, `CUSTOM_SECTION_KEY_SEP`
- **`renderField()`** — after hide/unhide toggle, added mirror toggle for `field.multiline`; toggles key in `settings.mirroredFields['location']` (shared key for both worlds and locations); **force-saves entity immediately**
- **`renderUniversalField()`** — added `categoryId` parameter; added mirror toggle for `tpl.type === 'textarea'`; **force-saves immediately** on toggle
- **`scheduleSave()` / `flushPendingSave()`** — builds `MirroredSection[]` from `settings.mirroredFields['location']`, passes `mirrored` to `saveWorld()` / `saveLocation()`
- **`resolveMirroredSectionInfo()`** — async helper; scans `WORLD_CATEGORIES` or `LOCATION_CATEGORIES` depending on `draft.type`, plus universal templates and composite keys
- **`buildCustomSectionsHost()`** — added `isFieldMirrored` / `toggleFieldMirror` callbacks (keyed to `'location'`); **force-saves immediately** on toggle
- **Mirror toggle re-render** — uses `renderView()` instead of `renderDetail()` to preserve view headers/toolbar

### components/CustomSectionsRenderer.ts
- **`CustomSectionsHost` interface** — added optional `isFieldMirrored(compositeKey): boolean` and `toggleFieldMirror(compositeKey): Promise<void>` callbacks
- **Textarea field case** — when host provides mirror callbacks, renders mirror toggle icon alongside field label; force-save handled by host's callback

## New Files

### dynamic-narrative/models/
- `types.ts` — Shared types (DNBase, DNPhase, DNLinkedChild, DNEntity, DNEntityType, DEFAULT_DN_PHASES, helpers, type guards, deepClone, debounce, resolveWikilinkPath)
- `Scenario.ts` — Scenario interface and ScenarioPhase (no default phases)
- `Objective.ts` — Objective interface and ObjectivePhase (5 default phases)
- `Arc.ts` — Arc Type/Variant interfaces; Arc Types own phases and Arc Variants store root-level overrides and quest links
- `Quest.ts` — Quest interface and QuestPhase (5 default phases)

### dynamic-narrative/services/
- `DynamicNarrativeManager.ts` — Full CRUD, file I/O with error handling, frontmatter round-tripping with body section preservation, hierarchy queries, auto-linking, phase management, Arc Variant root-level quest linking, cascade rename, category management, save queue mutex, vault event handlers, destroy cleanup

### dynamic-narrative/views/
- `DynamicNarrativeView.ts` — Single ItemView with 5 tabs (Overview, Scenarios, Objectives, Arcs, Quests), plugin header toolbar with `renderViewSwitcher`, resizable inspector with mouse + touch support, inspector hidden for Quests tab, session-only inspector width saved to local `_inspectorWidth` property

### dynamic-narrative/components/
- `DNOverview.ts` — Overview tab with debounced sortable/filterable entity lists, DNCreateModal for creation
- `DNKanban.ts` — Reusable Dynamic Narrative board with debounced sidebar search, phase panels for Scenario/Objective Variant, a root-level Arc Variant layout, create/link modals, and context menus
- `DNQuestGrid.ts` — Quest grid/list + editor + usage sidebar with debounced search
- `DNInspector.ts` — Entity inspector with:
  - **Suggestor-based linked entity inputs** — `renderTagPillInput` for Linked Locations, Linked Characters, and Arc Variant root quest links (Linked Goals/Limits/Events/Modifiers)
  - **Open/delete buttons** in header (`codex-detail-action-btn` class), open file in new tab, delete with `openConfirmModal` dialog
  - **Single-line phase name input** — custom phase names use `<input>` instead of `<textarea>`
  - Phase accordions with auto-save (600ms debounce), DNPhaseModal integration
- `DNCreateModal.ts` — Entity creation modal (name, category, description)
- `DNPhaseModal.ts` — Phase add/edit modal (name read-only for default phases)
- `DNCategoryModal.ts` — Category management modal (add/remove custom categories)

## Integration Boundaries
- DN touches exactly 6 existing files: `constants.ts`, `main.ts`, `settings.ts`, `styles.css`, `components/ViewSwitcher.ts`, `services/SceneManager.ts`
- Scene categories touches 11 existing files: `models/Scene.ts`, `settings.ts`, `services/MetadataParser.ts`, `components/SceneCard.ts`, `components/Inspector.ts`, `styles.css`, `main.ts`, `views/BoardView.ts`, `views/DetailsView.ts`, `views/PlotgridView.ts`, `views/SceneInspectorView.ts`, `views/TimelineView.ts`
- Body mirroring touches these existing files: `settings.ts`, `services/CodexManager.ts`, `services/CharacterManager.ts`, `services/LocationManager.ts`, `main.ts`, `views/CodexView.ts`, `views/CharacterView.ts`, `views/LocationView.ts`, `components/CustomSectionsRenderer.ts`, `styles.css`
- View modify handlers patched in 4 views: `DetailsView.ts`, `NotesView.ts`, `SceneInspectorView.ts`, `SynopsisView.ts`
- DN Inspector button styling patched in `dynamic-narrative/components/DNInspector.ts`
- All DN logic is in `dynamic-narrative/` directory
- Body mirroring logic is distributed across existing services/views (no new directory)
- Worlds and locations share `mirroredFields['location']` settings key (same convention as `hiddenFields`)
- `setFieldTemplates()` called on all three entity managers during `onload()` bootstrap after `fieldTemplates.load()`
- DN manager operates independently alongside other services
- Body mirroring integrates into existing save/parse pipeline of all three entity managers
- File events handled by existing debounced refresh pipeline (with System folder filtering + per-manager self-write guards)
- Undo/redo uses existing `UndoManager` with deep-cloned snapshots
- Save operations use a promise-chain mutex to prevent race conditions
- Cascade rename and file delete handlers are wired into vault event listeners

## Upstream Merge Checklist
- [ ] Check `constants.ts` for new view types (re-add DN if missing)
- [ ] Check `main.ts` imports (re-add DN imports if missing)
- [ ] Check `main.ts` `onload()` for new registrations (re-add DN if missing)
- [ ] Check `main.ts` `slViewTypes` array (re-add DN if missing)
- [ ] Check `main.ts` vault handlers (re-add System folder filtering + conditional refresh if missing)
- [ ] Check `main.ts` `isSystemFile()` helper (re-add if missing)
- [ ] Check `main.ts` vault rename handler (re-add cascadeRename call if missing)
- [ ] Check `main.ts` vault delete handler (re-add handleFileDeleted call if missing)
- [ ] Check `main.ts` `refreshOpenViews()` (re-add DN calls if missing)
- [ ] Check `main.ts` `onunload()` (re-add DN destroy call if missing)
- [ ] Check `main.ts` bootstrap — re-add `setFieldTemplates()` calls on all three managers after `fieldTemplates.load()`
- [ ] Check `services/SceneManager.ts` — `handleFileChange()` must return `boolean`
- [ ] Check `settings.ts` interface/defaults (re-add DN fields if missing, ensure `dnInspectorWidth` is NOT present)
- [ ] Check `settings.ts` interface/defaults — re-add `mirroredFields: Record<string, string[]>` if missing
- [ ] Check `settings.ts` settings tab UI (re-add DN section if missing)
- [ ] Check `styles.css` (re-add `dn-*` section if overwritten)
- [ ] Check `styles.css` — re-add `.field-mirror-btn*` styles + `.character-universal-label-wrap` + `.codex-universal-label-wrap` mirror button rules if overwritten
- [ ] Check `components/ViewSwitcher.ts` — re-add DN entry + import if missing
- [ ] Check `dynamic-narrative/components/DNInspector.ts` — re-add `codex-detail-action-btn` class on open/delete buttons
- [ ] Check view modify handlers in `DetailsView.ts`, `NotesView.ts`, `SceneInspectorView.ts`, `SynopsisView.ts` for System folder guards
- [ ] Check `services/CodexManager.ts` — re-add `MirroredSection` + `ParsedMirrorSection` exports, `MIRROR_SEPARATOR`, `_isSaving`/`isSelfWrite()`, `setFieldTemplates()`, `buildMirroredBody()`, `parseMirroredBody()`, `resolveMirrorKey()`, mirrored param in `saveEntry()`, mirrored body parsing in `parseEntry()`
- [ ] Check `services/CharacterManager.ts` — re-add `_isSaving`/`isSelfWrite()`, `setFieldTemplates()`, `resolveMirrorKey()`, `MirroredSection`/`ParsedMirrorSection` imports, mirrored param in `saveCharacter()`, mirrored body parsing in `parseCharacterContent()`
- [ ] Check `services/LocationManager.ts` — re-add `_isSaving`/`isSelfWrite()`, `setFieldTemplates()`, module-level helpers, `MirroredSection`/`ParsedMirrorSection` imports, mirrored param in `saveWorld()`/`saveLocation()`/`saveItem()`, mirrored body parsing in `parseAndStoreContent()`
- [ ] Check `main.ts` vault modify handler — re-add codex, character, and location file detection and refresh triggers
- [ ] Check `views/CodexView.ts` — re-add `MirroredSection` import, mirror toggles (with force-save) in `renderField()`/`renderUniversalField()`, `resolveMirroredSectionInfo()`, `executeSave()` mirrored section building, mirror callbacks (with force-save) in `buildCustomSectionsHost()`
- [ ] Check `views/CharacterView.ts` — re-add `MirroredSection`/`CUSTOM_SECTION_KEY_SEP` imports, mirror toggle (with force-save) in `renderField()` multiline, `categoryId` param + mirror toggle (with force-save) in `renderUniversalField()`, `resolveMirroredSectionInfo()`, mirrored section building in `scheduleSave()`/`flushPendingSave()`, mirror callbacks (with force-save) in `buildCustomSectionsHost()`, `renderView()` in toggle re-render
- [ ] Check `views/LocationView.ts` — re-add `MirroredSection`/`CUSTOM_SECTION_KEY_SEP` imports, mirror toggle (with force-save) in `renderField()` multiline, `categoryId` param + mirror toggle (with force-save) in `renderUniversalField()`, `resolveMirroredSectionInfo()`, mirrored section building in `scheduleSave()`/`flushPendingSave()`, mirror callbacks (with force-save) in `buildCustomSectionsHost()`, `renderView()` in toggle re-render
- [ ] Check `components/CustomSectionsRenderer.ts` — re-add `isFieldMirrored`/`toggleFieldMirror` in `CustomSectionsHost` interface, mirror toggle in textarea case
- [ ] Check `models/Scene.ts` — re-add `SceneCategoryDef` interface, `SceneCategory` type, `category` field on `Scene`, `'category'` in `ColorCodingMode`, `registerSceneCategories()`, `getSceneCategoryConfig()`, `getSceneCategoryOrder()`, `resolveSceneCategoryCfg()`
- [ ] Check `settings.ts` interface/defaults — re-add `sceneCategoriesEnabled`, `sceneCategories`, `defaultSceneCategory`
- [ ] Check `settings.ts` settings tab — re-add Scene Categories section (toggle, default dropdown, inline rows, add button)
- [ ] Check `settings.ts` color coding dropdown — re-add "By Category" option
- [ ] Check `services/MetadataParser.ts` — re-add `category` in `parseContent()`, `generateSceneContent()`, and cleanup in `updateFrontmatter()`
- [ ] Check `components/SceneCard.ts` — re-add `resolveSceneCategoryCfg` import, category-based icon rendering, `'category'` case in `getCardColor()`
- [ ] Check `components/Inspector.ts` — re-add `onCategoryChange` callback, category dropdown rendering in flex row
- [ ] Check `main.ts` — re-add `registerSceneCategories` import and registration calls in `onload()` and `saveSettings()`
- [ ] Check `styles.css` — re-add `.inspector-dropdown-wrap`
- [ ] Check view files — re-add `onCategoryChange` in `BoardView.ts` (both instances), `DetailsView.ts`, `PlotgridView.ts` (both instances), `SceneInspectorView.ts`, `TimelineView.ts`

---

## Body Mirroring (detailed reference)

### Overview
Textarea-type fields in codex entries, characters, locations, and worlds can be mirrored into the markdown note body using H1/H2 formatting. The note body acts as the source of truth — edits in the plugin editor are reflected in both the frontmatter and body, while edits made in Obsidian's native editor are parsed back into the frontmatter.

### Body Format
A single `<!-- sl-mirror -->` HTML comment separates user notes from mirrored H1/H2 sections:

```
User's notes content here...

<!-- sl-mirror -->

# Relationships
## Key Allies
Mirrored field content...

# Appearance
## Physical Description
More mirrored content...
```

- Everything before `<!-- sl-mirror -->` is preserved user notes.
- Everything after is parsed as structured H1/H2 sections — each `# Section` followed by `## Field` headers and their content.
- During parsing, `sectionTitle` + `fieldLabel` are resolved to field keys by matching against category definitions and universal field templates (via `setFieldTemplates()`).

### Key Interfaces

| Interface | Fields | Purpose |
|---|---|---|
| `MirroredSection` | `sectionTitle`, `fieldKey`, `fieldLabel`, `value` | Input to `buildMirroredBody()` / `saveEntry()` |
| `ParsedMirrorSection` | `sectionTitle`, `fieldLabel`, `value` | Output from `parseMirroredBody()` — no field key yet |

### Settings
- **`settings.ts`**: Added `mirroredFields: Record<string, string[]>` — per-category list of field keys whose content is synced to the md body
- **Toggle UI**: Mirror toggle (`file-text` icon) appears after the hide/unhide toggle (eye icon), only for textarea/multiline fields
- **Keys**: Codex uses `catDef.id` / `draft.type`; characters use `'character'`; locations/worlds share `'location'`

### Toggle Behavior
- **Activating mirror**: Immediately force-saves the entity with the new mirrored sections in the body
- **Deactivating mirror**: Immediately force-saves the entity, stripping the mirrored sections from the body
- **Pending debounced saves are cleared** on toggle to prevent stale writes
- **Managers guard against feedback**: `_isSaving` flag prevents vault `modify` event from triggering a re-parse during plugin-initiated writes

### Data Flow
1. **Plugin editor → file**: User types in textarea → `scheduleSave()` / `executeSave()` → builds `MirroredSection[]` → manager's save method strips old mirrored sections, rebuilds body with `buildMirroredBody(notes, mirrored)`. `_isSaving` flag prevents feedback loop.
2. **Obsidian editor → frontmatter**: User edits body → vault `modify` event → handler detects entity file (codex/character/location) + not self-write → `debouncedRefresh()` → reload + `parseMirroredBody()` → `resolveMirrorKey()` resolves section/label to field key → body values override frontmatter → view refreshes.
3. **Mirror toggle on**: Toggle click → update `settings.mirroredFields` → `resolveMirroredSectionInfo()` builds `MirroredSection[]` → manager saves entity immediately → clear pending debounce → save settings → re-render.
