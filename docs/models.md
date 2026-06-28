# Models Reference

All data models are TypeScript interfaces stored as Markdown files with YAML frontmatter. Each model file lives in the `models/` directory.

## Scene (`models/Scene.ts`)

The core data type representing a scene card. Stored as a `.md` file in `{project}/Scenes/`.

### Key Fields

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | Vault-relative path |
| `type` | `'scene'` | Type identifier |
| `title` | `string` | Scene title |
| `act` | `number \| string` | Act number or name |
| `chapter` | `number \| string` | Chapter number or name |
| `sequence` | `number` | Reading order position |
| `chronologicalOrder` | `number` | Story-time order (for non-linear narratives) |
| `pov` | `string` | Point of view character |
| `characters` | `string[]` | Characters present (wikilinks) |
| `location` | `string` | Scene location (wikilink) |
| `storyDate` | `string` | Date in story time |
| `storyTime` | `string` | Time in story |
| `status` | `SceneStatus` | Completion status |
| `conflict` | `string` | Main conflict |
| `emotion` | `string` | Emotional tone |
| `intensity` | `number` | Character arc intensity (-10 to +10) |
| `wordcount` | `number` | Actual word count |
| `charcount` | `number` | Character count |
| `target_wordcount` | `number` | Target word count |
| `tags` | `string[]` | Plotlines, themes, etc. |
| `setup_scenes` | `string[]` | Scenes that set up this scene |
| `payoff_scenes` | `string[]` | Scenes that pay off from this scene |
| `notes` | `string` | Editorial notes |
| `synopsis` | `string` | Brief scene synopsis |
| `body` | `string` | Body content (without frontmatter) |
| `timeline_mode` | `TimelineMode` | Temporal handling mode |
| `timeline_strand` | `string` | Named strand for parallel/frame narratives |
| `subtitle` | `string` | Optional subtitle |
| `color` | `string` | Custom card color (hex) |
| `codexLinks` | `Record<string, string[]>` | Linked codex entries per category |
| `universalFields` | `Record<string, string \| string[]>` | Custom universal field values |
| `beatsheet` | `string` | Beat sheet template name |
| `inactive` | `boolean` | Parked/out of manuscript flow |
| `arcAnchor` | `boolean` | Key turning point marker |

### Status Pipeline

Six built-in statuses with optional user-defined custom statuses:

```
idea -> outlined -> draft -> written -> revised -> final
```

Type: `BuiltinSceneStatus = 'idea' | 'outlined' | 'draft' | 'written' | 'revised' | 'final'`

Custom statuses are defined in settings with `id`, `label`, `color`, `icon`, and optional `countsAsWritten`.

### Timeline Modes

Ten modes for non-linear narratives:

| Mode | Label | Behavior |
|---|---|---|
| `linear` | Linear | Enforce continuity checks |
| `flashback` | Flashback | Past event, suppress date-order warnings |
| `flash_forward` | Flash-forward | Future event appearing early |
| `parallel` | Parallel timeline | Alternate timeline strand |
| `frame` | Frame narrative | Outer/inner frame layer |
| `simultaneous` | Simultaneous | Same moment, different POV |
| `timeskip` | Time skip | Intentional gap, suppress gap warnings |
| `dream` | Dream / Vision | Ignore all continuity checks |
| `mythic` | Mythic / Legend | Floating outside measurable story-time |
| `circular` | Circular | Intentional echo (loop-back) |

### Supporting Types

- **`SceneFilter`** -- filter by status, act, chapter, POV, characters, locations, tags, search text, custom fields, arc anchor, active state.
- **`FilterPreset`** -- named saved filter configuration.
- **`SortConfig`** -- sort by `sequence`, `chronologicalOrder`, `storyDate`, `title`, `status`, `act`, `chapter`, `wordcount`, `modified` (asc/desc).
- **`BoardColumn`** -- column in board view with id, title, and scenes.
- **`ColorCodingMode`** -- `'pov' | 'status' | 'emotion' | 'act' | 'tag'`

---

## Character (`models/Character.ts`)

Rich character profile stored in `{project}/Codex/Characters/`.

### Field Categories

| Category | Fields |
|---|---|
| **Basic Info** | `name`, `tagline`, `image`, `gallery`, `nickname`, `age`, `role`, `roles` (structured), `occupation`, `residency`, `locations`, `family` |
| **Physical** | `appearance`, `distinguishingFeatures`, `style`, `quirks` |
| **Personality** | `personality`, `internalMotivation`, `externalMotivation`, `strengths`, `flaws`, `fears`, `belief`, `misbelief` |
| **Backstory** | `formativeMemories`, `accomplishments`, `secrets` |
| **Relationships** | Typed arrays: `allies`, `enemies`, `romantic`, `mentors`, `siblings`, `parents`, `children`, `spouses`, `friends`, `rivals`, `colleagues`, etc. (40+ relationship types) |
| **Character Arc** | `arcSummary`, `arcStages`, `want`, `need`, `ghost`, `lie`, `truth` |
| **Custom Fields** | `custom` (Record), `universalFields` (Record) |

### Structured Roles

`RoleEntry` interface supports role history with optional scene anchor, plotline, and book label:
```typescript
interface RoleEntry {
    role: string;
    scene?: string;
    plotline?: string;
    book?: string;
}
```

### Structured Relations

`CharacterRelation` interface for typed relationship rows:
```typescript
interface CharacterRelation {
    category: string;
    type: string;
    target: string;
}
```

---

## Location (`models/Location.ts`)

Two frontmatter types share the `Locations/` folder:

### StoryWorld (`type: world`)

Top-level worldbuilding container.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | World name |
| `description` | `string` | General description |
| `geography` | `string` | Terrain, climate |
| `culture` | `string` | Norms, traditions |
| `politics` | `string` | Power structures |
| `magicTechnology` | `string` | Magic/tech rules |
| `beliefs` | `string` | Myths, religion |
| `economy` | `string` | Trade systems |
| `history` | `string` | Key events |

### StoryLocation (`type: location`)

Specific place, optionally nested under a world and/or parent location.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Location name |
| `locationType` | `LocationType \| string` | Kind of place (city, building, etc.) |
| `world` | `string` | Parent world name |
| `parent` | `string` | Parent location name |
| `description` | `string` | Sights, sounds, smells |
| `atmosphere` | `string` | Mood |
| `significance` | `string` | Story significance |
| `inhabitants` | `string` | Key inhabitants |
| `connectedLocations` | `string` | Nearby locations |
| `mapNotes` | `string` | Spatial info |

Built-in location types: `city`, `town`, `village`, `neighborhood`, `building`, `room`, `wilderness`, `forest`, `mountain`, `river`, `lake`, `sea`, `island`, `harbour`, `road`, `vehicle`, `region`, `country`, `other`. Users can add custom types.

---

## Codex (`models/Codex.ts`)

Generic entries for user-defined categories. Characters and Locations retain their specialized models; Codex covers everything else.

### CodexEntry

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | Vault-relative path |
| `type` | `string` | Category id (e.g. `'item'`, `'creature'`) |
| `name` | `string` | Display name |
| `image` | `string` | Portrait image path |
| `gallery` | `Array` | Image gallery (max 10) |
| `notes` | `string` | Markdown body |
| `custom` | `Record<string, string>` | User-defined custom fields |
| `universalFields` | `Record<string, string \| string[]>` | Universal field template values |
| `books` | `string[]` | Series book membership |

### Built-in Categories

- **Items** -- `name`, `itemType`, `description`, `origin`, `history`, `owner`, `previousOwners`, `properties`, `limitations`, `significance`
- **Creatures** -- `name`, `creatureType`, `description`, `habitat`, `diet`, `behavior`, `abilities`, `weaknesses`, `ecology`

Users can add unlimited custom categories (Props, Factions, Magic Systems, etc.) via settings.

### CodexCategoryDef

Defines a category's structure:
```typescript
interface CodexCategoryDef {
    id: string;           // folder name + frontmatter type
    label: string;        // display name
    icon: string;         // Lucide icon
    folder: string;       // folder inside Codex/
    categories: CodexFieldCategory[];
    fieldKeys: string[];
    builtIn?: boolean;
    showInSidebar?: boolean;
}
```

---

## PlotGridData (`models/PlotGridData.ts`)

Spreadsheet-style grid data for the Plotgrid view. Stored in `System/plotgrid.json`.

### Interfaces

| Type | Fields |
|---|---|
| `CellData` | `id`, `content`, `bgColor`, `textColor`, `bold`, `italic`, `align`, `linkedSceneId?`, `manualContent?` |
| `ColumnMeta` | `id`, `label`, `width`, `bgColor`, `textColor?`, `bold?`, `italic?`, `headerBgColor?`, `sourceType?`, `sourceId?`, `sourceKind?` |
| `RowMeta` | `id`, `label`, `height`, `bgColor`, `textColor?`, `bold?`, `italic?`, `headerBgColor?`, `sourceType?`, `sourceId?` |
| `PlotGridData` | `rows: RowMeta[]`, `columns: ColumnMeta[]`, `cells: Record<string, CellData>`, `zoom: number`, `stickyHeaders?: boolean` |

---

## Research (`models/Research.ts`)

Research posts stored in `{project}/Research/`.

### ResearchPost

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | Vault-relative path |
| `title` | `string` | Post title |
| `researchType` | `ResearchType` | `'note' \| 'webclip' \| 'image' \| 'question'` |
| `tags` | `string[]` | Free-form tags |
| `body` | `string` | Markdown content |
| `sourceUrl` | `string` | Source URL (webclips) |
| `resolved` | `boolean` | Question resolved flag |
| `isLinked` | `boolean` | Linked vault note (not in Research/) |
| `subfolder` | `string` | Sub-folder within Research/ |

---

## Dynamic Narrative (`dynamic-narrative/models/`)

Game narrative entities for branching quest systems. Stored as Markdown files with YAML frontmatter in `{project}/DynamicNarrative/`.

### Shared Types (`dynamic-narrative/models/types.ts`)

| Type | Description |
|---|---|
| `DNEntityType` | `'scenario' \| 'objective' \| 'arc' \| 'quest'` |
| `DNEntity` | Union type: `Scenario \| Objective \| Arc \| Quest` |
| `DNBase` | `filePath`, `title`, `description`, `created`, `modified` |
| `DNPhase` | `name`, `description`, `startConditions`, `endConditions`, `startCommands`, `endCommands`, `isDefault` |
| `DNLinkedChild` | `id` (wikilink), `isPrimary`, `mandatory` |

**Constants:** `DEFAULT_DN_PHASES` (5 phases), per-type category defaults.

**Utilities:** `createDefaultPhase`, `createDefaultPhases`, `getOrderedPhases`, `deriveShortDesc`, `isDefaultPhase`, `resolveWikilinkPath`, `deepClone`, `debounce`, type guards (`isScenario`, `isObjective`, `isArc`, `isQuest`).

### Scenario (`dynamic-narrative/models/Scenario.ts`)

Top-level container. No default phases. Fields: `type`, `category`, `linkedActs`, `linkedLocations`, `linkedCharacters`, `phases` (`ScenarioPhase[]`). Creator: `createEmptyScenario(title)`.

### Objective (`dynamic-narrative/models/Objective.ts`)

Mid-level goal. 5 default phases. Fields: `type`, `category`, `linkedLocations`, `linkedCharacters`, `phases` (`ObjectivePhase[]`). Creator: `createEmptyObjective(title)`.

### Arc (`dynamic-narrative/models/Arc.ts`)

Quest thread. 5 default phases. Fields: `type`, `category`, `linkedLocations`, `dynamicLocations`, `phases` (`ArcPhase[]`). ArcPhase adds `linkedGoals/limitations/events/modifiers`. Creator: `createEmptyArc(title)`.

### Quest (`dynamic-narrative/models/Quest.ts`)

Leaf quest. 5 default phases. Fields: `type`, `category`, `questType`, `phases` (`QuestPhase[]` -- alias for `DNPhase`). Creator: `createEmptyQuest(title)`.

### Hierarchy

`Scenario → Objective → Arc → Quest`. Linked via phase arrays: `ScenarioPhase.linkedObjectives`, `ObjectivePhase.linkedArcs`, `ArcPhase.linkedGoals/Limits/Events/Modifiers`.

### System JSON (`System/dynamic-narrative.json`)

In-memory cache persisted to disk. Shape: `{ scenarios, objectives, arcs, quests: Record<path, entity>; layout: { inspectorWidth }; version }`.

---

## StoryLineProject (`models/StoryLineProject.ts`)

Project manifest stored as a `.md` file in the StoryLine root folder.

### Key Fields

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | Vault-relative path |
| `title` | `string` | Project title |
| `locale` | `string` | BCP-47 language tag |
| `sceneFolder` | `string` | Derived Scenes/ path |
| `characterFolder` | `string` | Derived Characters/ path |
| `locationFolder` | `string` | Derived Locations/ path |
| `codexFolder` | `string` | Derived Codex/ path |
| `notesFolder` | `string` | Derived Notes/ path |
| `archiveFolder` | `string` | Derived Archive/ path |
| `researchFolder` | `string` | Derived Research/ path |
| `definedActs` | `number[]` | Act numbers |
| `definedChapters` | `number[]` | Chapter numbers |
| `actLabels` | `Record<number, string>` | Act display labels |
| `chapterLabels` | `Record<number, string>` | Chapter display labels |
| `filterPresets` | `FilterPreset[]` | Saved filter presets |
| `corkboardPositions` | `Record<string, {x,y,z?,h?}>` | Corkboard layout |
| `seriesId` | `string` | Series membership |
| `coverImage` | `string` | Cover image path |
| `activeBeatSheet` | `string` | Last applied beat sheet |

### SeriesMetadata

```typescript
interface SeriesMetadata {
    name: string;
    bookOrder: string[];
    created: string;
}
```

Stored as `series.json` in the series parent folder.

### Folder Derivation

Two functions handle path derivation:
- `deriveProjectFolders(rootFolder, title)` -- from StoryLine root + title
- `deriveProjectFoldersFromFilePath(filePath)` -- from the project `.md` file's actual location (supports projects anywhere in the vault)
