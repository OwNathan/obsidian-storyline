# Services Reference

Business logic managers and utilities in the `services/` directory. All services are instantiated in `main.ts` `onload()` and stored on the plugin instance.

## SceneManager (`services/SceneManager.ts`)

Central service managing CRUD operations, indexing, and project management for scenes. Implements `ISceneStore` for read-only access by `SceneQueryService`.

**Constructor:** `SceneManager(app: App, plugin: SceneCardsPlugin)`

**Key responsibilities:**
- Scene CRUD (create, read, update, delete)
- Project management (create, switch, fork, delete)
- Scene indexing with tag-based secondary index
- File change handling (`handleFileChange`, `handleFileDelete`, `handleFileRename`)
- Corkboard position management
- Project system data persistence

**Key public members:**
- `undoManager: UndoManager` -- undo/redo stack
- `queryService: SceneQueryService` -- read-only query service
- `activeProject: StoryLineProject | null` -- current project
- `cacheVersion: number` -- monotonically increasing version, bumped on mutations
- `initialize()` -- scan vault and build scene index
- `getAllScenes(): Scene[]`
- `getScene(filePath: string): Scene | undefined`
- `getScenesByTag(tag: string): Scene[]`
- `setActiveProject(project: StoryLineProject)`
- `getProjects(): StoryLineProject[]`

---

## SceneQueryService (`services/SceneQueryService.ts`)

Read-only querying, filtering, sorting, aggregation, and statistics over scene data. Has no vault write access.

**Constructor:** `SceneQueryService(sceneStore: ISceneStore)`

**Key methods:**
- `getFilteredScenes(filter?: SceneFilter, sort?: SortConfig): Scene[]`
- `getScenesByStatus(status: SceneStatus): Scene[]`
- `getScenesByPov(pov: string): Scene[]`
- `getScenesByLocation(location: string): Scene[]`
- `getStatistics()` -- word counts, status breakdown, act/chapter distribution

---

## CharacterManager (`services/CharacterManager.ts`)

Manages character `.md` files in the project's `Characters/` folder.

**Constructor:** `CharacterManager(app: App)`

**Key methods:**
- `loadCharacters(folderPath: string): Promise<Character[]>`
- `getAllCharacters(): Character[]`
- `parseCharacterContent(content, filePath, folderFallback?): Character | undefined`
- `createCharacterFile(name, folderPath): Promise<TFile | null>`
- `buildAliasMap(aliases?: Record<string, string>): Map<string, string>`

---

## LocationManager (`services/LocationManager.ts`)

Manages world and location `.md` files. Both types live in `Locations/`.

**Constructor:** `LocationManager(app: App)`

**Key methods:**
- `loadAll(folderPath: string): Promise<void>`
- `getAllWorlds(): StoryWorld[]`
- `getAllLocations(): StoryLocation[]`
- `getWorld(filePath: string): StoryWorld | undefined`
- `getLocation(filePath: string): StoryLocation | undefined`

---

## CodexManager (`services/CodexManager.ts`)

Manages generic Codex entries for any user-defined category (Items, Creatures, custom).

**Constructor:** `CodexManager(app: App)`

**Key methods:**
- `initCategories(enabledIds: string[], customDefs?: CodexCategoryDef[]): void`
- `getCategories(): CodexCategoryDef[]`
- `loadEntries(folderPath: string): Promise<void>`
- `getEntriesByCategory(categoryId: string): CodexEntry[]`
- `getAllEntries(): CodexEntry[]`

---

## LinkScanner (`services/LinkScanner.ts`)

Extracts `[[wikilinks]]` and plain-text character/location/codex mentions from scene body text and classifies them.

**Constructor:** `LinkScanner(characterManager, locationManager)`

**Key methods:**
- `setCodexManager(codexManager: CodexManager)`
- `rebuildLookups(manualAliases?: Record<string, string>)`
- `scanAll(scenes: Scene[])`
- `scanText(text: string): { characters: string[], locations: string[], tags: string[], other: string[] }`
- `computeCodexDigests(): Record<string, string>`
- `buildEntityIndex()` -- maps entity names to their references

**Key types:**
- `DetectedLink` -- `{ name, type: 'character' | 'location' | 'codex' | 'other' }`
- `LinkScanResult` -- classified links per scene
- `EntityReference` -- `{ name, type, filePath, codexCategory? }`

---

## ExportService (`services/ExportService.ts`)

Generates exports in six formats: Markdown, JSON, CSV, HTML, DOCX, PDF.

**Constructor:** `ExportService(app, sceneManager, characterManager, locationManager)`

**Key methods:**
- `setDocxSettings(settings: SLDocxSettings)`
- `setPdfSettings(settings: SLPdfSettings)`
- `setExportOptions(options: ExportOptions)`
- Export scope: `'manuscript'` or `'outline'`
- Export formats: `'md' | 'json' | 'html' | 'csv' | 'docx' | 'pdf'`

**ExportOptions:**
- `includeSceneTitles` (default true)
- `numberScenesOnExport` (default false)
- `includeCorkboardNotes` (default false)
- `includeInactiveScenes` (default false)

---

## SeriesManager (`services/SeriesManager.ts`)

Manages series -- groups of book projects sharing a common codex.

**Constructor:** `SeriesManager(app: App, plugin: SceneCardsPlugin)`

**Key methods:**
- `loadSeriesMetadata(seriesFolder: string): Promise<SeriesMetadata | null>`
- `saveSeriesMetadata(seriesFolder: string, meta: SeriesMetadata)`
- `getActiveSeriesFolder(): string | null`
- `getActiveSeriesMetadata(): Promise<SeriesMetadata | null>`
- Create/add/remove projects from series
- Handles codex migration between local and shared series codex

---

## UndoManager (`services/UndoManager.ts`)

50-action undo/redo stack for scene, character, and location operations.

**Constructor:** `UndoManager(app: App)`

**Key methods:**
- `recordUpdate(filePath, oldSnap, newUpdates, label?, domain?)` -- before an update
- `recordDelete(filePath, fileContent, label)` -- before a delete
- `recordCreate(filePath, fileContent, label)` -- after a create
- `undo(): Promise<void>`
- `redo(): Promise<void>`

**Domains:** `'scene' | 'character' | 'location'`
**Action types:** `'update' | 'create' | 'delete'`

---

## CascadeRenameService (`services/CascadeRenameService.ts`)

Handles cascading renames across the project. When an entity name changes, all references in scenes, other characters, and child locations are updated.

**Constructor:** `CascadeRenameService(app, sceneManager, characterManager, locationManager)`

**Key methods:**
- `previewCharacterRename(oldName, newName): RenamePreview`
- `previewWorldRename(oldName, newName): RenamePreview`
- `previewLocationRename(oldName, newName): RenamePreview`
- `executeCharacterRename(oldName, newName)`
- `executeWorldRename(oldName, newName)`
- `executeLocationRename(oldName, newName)`

---

## WritingTracker (`services/WritingTracker.ts`)

Tracks session word counts, daily writing velocity, and writing sprints.

**Key methods:**
- `startSession(baselineWords: number)`
- `flushSession(currentWords: number)`
- `getSessionWords(): number`
- `getDailyHistory(): Record<string, number>`
- `startSprint(durationMs?)`
- `stopSprint(currentWords): SprintLogEntry | null`
- `isSprintRunning(): boolean`

Persists to `System/stats.json`.

---

## SnapshotManager (`services/SnapshotManager.ts`)

Saves, lists, compares, and restores named snapshots of individual scene files.

**Constructor:** `SnapshotManager(app: App, getLocale: () => StoryLineLocale)`

**Key methods:**
- `saveSnapshot(sceneFilePath, label): Promise<SceneSnapshot>`
- `listSnapshots(sceneFilePath): Promise<SceneSnapshot[]>`
- `restoreSnapshot(sceneFilePath, snapshotFilePath)`
- `deleteSnapshot(snapshotFilePath)`

---

## ViewSnapshotService (`services/ViewSnapshotService.ts`)

Manages snapshots of view states (board layout, plot grid data, scene ordering).

**Constructor:** `ViewSnapshotService(plugin: SceneCardsPlugin)`

**Key methods:**
- `saveSnapshot(name, description?): Promise<ViewSnapshotMeta>`
- `listSnapshots(): Promise<ViewSnapshotMeta[]>`
- `restoreSnapshot(id: number)`
- `setActiveSnapshot(id: number | null)`
- `loadActiveState()` -- restore active snapshot on startup

Stored in `System/Snapshots/`.

---

## FieldTemplateService (`services/FieldTemplateService.ts`)

Manages universal field template definitions for characters, locations, scenes, and codex entries.

**Key interfaces:**
- `UniversalFieldTemplate` -- defines a reusable field with type, input mode, and optional top-level YAML mirroring
- `FieldTemplateChange` -- describes a template modification

**Key functions:**
- `setActiveTemplatesProvider(provider: () => UniversalFieldTemplate[])`
- `setTopLevelMirrorEnabled(enabled: boolean)`
- `mirrorUniversalFieldsToTopLevel(content: string): string`
- `hydrateUniversalFieldsFromTopLevel(content: string): string`
- `isReservedTopLevelKey(key: string): boolean`

Stored in `System/field-templates.json`.

---

## ResearchManager (`services/ResearchManager.ts`)

CRUD, indexing, and search for research posts.

**Constructor:** `ResearchManager(app: App, plugin: SceneCardsPlugin)`

**Key methods:**
- `scan(): Promise<void>`
- `getAllPosts(): ResearchPost[]`
- `getPost(filePath: string): ResearchPost | undefined`
- `createPost(name, content): Promise<TFile>`
- `updatePost(filePath, content)`
- `deletePost(filePath)`

---

## Validator (`services/Validator.ts`)

Static validation for story consistency and plot hole detection.

**Key methods:**
- `static validate(scenes: Scene[]): PlotWarning[]`
- `static checkTimeline(scenes, warnings)` -- date order, continuity
- `static checkCharacters(scenes, warnings)` -- character continuity
- `static checkPlotlines(scenes, warnings)` -- plotline balance
- `static checkSetupPayoff(scenes, warnings)` -- unresolved setups

---

## DynamicNarrativeManager (`dynamic-narrative/services/DynamicNarrativeManager.ts`)

Manages the Dynamic Narrative entity hierarchy (Scenarios, Objectives, Arcs, Quests). Operates on per-project data stored in `System/dynamic-narrative.json` and `DynamicNarrative/` folder.

**Constructor:** `DynamicNarrativeManager(app: App, plugin: SceneCardsPlugin)`

**Key methods:**

*Initialization*
- `initialize(projectFolder: string): Promise<void>` -- ensure folders, load system JSON, scan entity files
- `loadAll(): Promise<void>` -- reload all entities from markdown files and system JSON
- `saveSystemJson(): Promise<void>` -- persist in-memory maps (promise-chain mutex for serialized writes)

*CRUD*
- `createScenario/Objective/Arc/Quest(data): Promise<entity>` -- create file + system JSON entry
- `updateScenario/Objective/Arc/Quest(filePath, updates): Promise<void>` -- update with undo recording (deep-cloned snapshots)
- `deleteScenario/Objective/Arc/Quest(filePath): Promise<void>` -- delete file + remove from maps

*Hierarchy & Linking*
- `createAndLinkObjective(scenarioPath, phaseName, data): Promise<Objective>` -- create objective and link to scenario phase
- `createAndLinkArc(objectivePath, phaseName, data): Promise<Arc>` -- create arc and link to objective phase
- `createAndLinkQuest(arcPath, phaseName, category, data): Promise<Quest>` -- create quest and link to arc phase by category
- `getLinkedObjectives(scenarioPath, phaseName?): DNLinkedChild[]`
- `getLinkedArcs(objectivePath, phaseName?): DNLinkedChild[]`
- `getLinkedQuests(arcPath, phaseName?): string[]`
- `getConnectionsForQuest(questPath): { scenarios, objectives, arcs }` -- transitive usage count

*Phase Management*
- `addCustomPhase(entity, phase): void`
- `removeCustomPhase(entity, phaseName): void`
- `renameCustomPhase(entity, oldName, newName): void`
- `reorderCustomPhases(entity, fromIndex, toIndex): void`
- `updatePhaseFields(entity, phaseName, updates): void`
- `getOrderedPhasesForEntity(entity): DNPhase[]` -- ordered columns (default → custom → completed/failed)
- `reassignPhase(parentPath, childPath, fromPhase, toPhase): Promise<void>` -- drag between columns

*Category Management*
- `getCategories(entityType): string[]` -- settings or defaults
- `addCategory(entityType, name): void`
- `removeCategory(entityType, name): void`

*Vault Events*
- `cascadeRename(oldPath, newPath): Promise<void>` -- update all wikilinks when a DN file is renamed
- `handleFileDeleted(filePath): void` -- remove entity from maps on vault delete
- `isDNEntityPath(filePath): boolean` -- check if a vault path belongs to the DN folder

*Utility*
- `getAllScenarios/Objectives/Arcs/Quests(): entity[]`
- `getEntity(filePath): DNEntity | undefined`
- `getEntityType(filePath): DNEntityType | null`
- `getInspectorWidth(): number` / `setInspectorWidth(width): void`
- `getInitialized(): boolean`
- `destroy(): void` -- clear all maps and state

**System JSON format:**
```typescript
interface DynamicNarrativeSystemData {
    scenarios: Record<string, Scenario>;
    objectives: Record<string, Objective>;
    arcs: Record<string, Arc>;
    quests: Record<string, Quest>;
    layout: { inspectorWidth: number }; // stored for backward compat, no longer actively used (inspector width is session-only)
    version: number;
}
```

**File structure:**
```
{project}/DynamicNarrative/
    Scenarios/    <- .md files, frontmatter tag: storyline-scenario
    Objectives/   <- .md files, frontmatter tag: storyline-objective
    Arcs/         <- .md files, frontmatter tag: storyline-arc
    Quests/       <- .md files, frontmatter tag: storyline-quest
```

---

Utility module for parsing and serializing scene YAML frontmatter. Handles wikilink conversion and word count settings.

**Key exports:**
- `MetadataParser` class -- parse/stringify scene frontmatter
- `toWikilink(name): string | undefined`
- `setWriteSceneFieldsAsWikilinks(on: boolean)`
- `setWordcountExclusions(opts: { comments?, checklists? })`
- `setWordcountLocale(locale: StoryLineLocale)`

---

## DocxConverter (`services/DocxConverter.ts`)

Converts Markdown to DOCX format. Desktop and mobile compatible.

**Key exports:**
- `SLDocxSettings` interface -- page size, margins, font settings
- `SL_DEFAULT_DOCX_SETTINGS` -- defaults
- `convertToDocx(content, settings?): Promise<Uint8Array>`

---

## PdfConverter (`services/PdfConverter.ts`)

Converts Markdown to PDF using `pdf-lib`. No DOM/Electron/canvas dependencies.

**Key exports:**
- `SLPdfSettings` interface
- `SL_DEFAULT_PDF_SETTINGS` -- defaults
- `convertToPdf(content, settings?): Promise<Uint8Array>`

---

## ScrivenerImporter (`services/ScrivenerImporter.ts`)

Imports `.scriv` projects (Scrivener 2 & 3) as StoryLine projects. Desktop only.

**Key methods:**
- `static isAvailable(): boolean` -- checks for desktop platform
- `import(scrivPath: string): Promise<ImportResult>`

---

## SceneProvider (`services/SceneProvider.ts`)

Read-only abstraction over scene sources for future "Series Arc View" support.

**Key interfaces:**
- `SceneProvider` -- `isMultiBook()`, `getAll()`, `getBooks()`
- `ScopedScene` -- scene with book context
- `BookContext` -- book metadata for multi-book views
