# Fork Changes Tracker

Tracks all modifications to the shared obsidian-storyline codebase for the Dynamic Narrative feature. Use this when rebasing/merging upstream changes.

## Last Updated
2026-06-27 (completed)

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

### settings.ts
- Interface: Added `dnScenarioCategories`, `dnObjectiveCategories`, `dnArcCategories`, `dnQuestCategories`, `dnInspectorWidth`, `dnKanbanShowFullHeader`
- `DEFAULT_SETTINGS`: Added defaults for all DN fields
- Settings tab UI: Added "Dynamic Narrative" section with category management, inspector width, and kanban header toggle

### styles.css
- End of file: Added all `dn-*` prefixed styles (~600 lines covering view layout, tabs, inspector, overview, kanban, quest grid, cards, modals, phases, fields, empty states)

## New Files

### dynamic-narrative/models/
- `types.ts` — Shared types (DNBase, DNPhase, DNLinkedChild, DNEntity, DNEntityType, DEFAULT_DN_PHASES, helpers, type guards, deepClone, debounce, resolveWikilinkPath)
- `Scenario.ts` — Scenario interface and ScenarioPhase (no default phases)
- `Objective.ts` — Objective interface and ObjectivePhase (5 default phases)
- `Arc.ts` — Arc interface and ArcPhase (5 default phases, dynamicLocations)
- `Quest.ts` — Quest interface and QuestPhase (5 default phases)

### dynamic-narrative/services/
- `DynamicNarrativeManager.ts` — Full CRUD, file I/O with error handling, frontmatter round-tripping with body section preservation, hierarchy queries, auto-linking, phase management, cascade rename, category management, save queue mutex, vault event handlers, destroy cleanup

### dynamic-narrative/views/
- `DynamicNarrativeView.ts` — Single ItemView with 5 tabs (Overview, Scenarios, Objectives, Arcs, Quests), resizable inspector with mouse + touch support, hidden inspector on open, proper listener cleanup on close

### dynamic-narrative/components/
- `DNOverview.ts` — Overview tab with debounced sortable/filterable entity lists, DNCreateModal for creation
- `DNKanban.ts` — Reusable kanban board with debounced sidebar search, phase columns, drag-and-drop, create modal, context menu
- `DNQuestGrid.ts` — Quest grid/list + editor + usage sidebar with debounced search
- `DNInspector.ts` — Resizable entity inspector with phase accordion, auto-save (600ms debounce), DNPhaseModal integration
- `DNCreateModal.ts` — Entity creation modal (name, category, description)
- `DNPhaseModal.ts` — Phase add/edit modal (name read-only for default phases)
- `DNCategoryModal.ts` — Category management modal (add/remove custom categories)

## Integration Boundaries
- DN touches exactly 4 existing files: `constants.ts`, `main.ts`, `settings.ts`, `styles.css`
- All DN logic is in `dynamic-narrative/` directory
- DN manager operates independently alongside other services
- File events handled by existing debounced refresh pipeline
- Undo/redo uses existing `UndoManager` with deep-cloned snapshots
- Save operations use a promise-chain mutex to prevent race conditions
- Cascade rename and file delete handlers are wired into vault event listeners

## Upstream Merge Checklist
- [ ] Check `constants.ts` for new view types (re-add DN if missing)
- [ ] Check `main.ts` imports (re-add DN imports if missing)
- [ ] Check `main.ts` `onload()` for new registrations (re-add DN if missing)
- [ ] Check `main.ts` `slViewTypes` array (re-add DN if missing)
- [ ] Check `main.ts` vault rename handler (re-add cascadeRename call if missing)
- [ ] Check `main.ts` vault delete handler (re-add handleFileDeleted call if missing)
- [ ] Check `main.ts` `refreshOpenViews()` (re-add DN calls if missing)
- [ ] Check `main.ts` `onunload()` (re-add DN destroy call if missing)
- [ ] Check `settings.ts` interface/defaults (re-add DN fields if missing)
- [ ] Check `settings.ts` settings tab UI (re-add DN section if missing)
- [ ] Check `styles.css` (re-add `dn-*` section if overwritten)
