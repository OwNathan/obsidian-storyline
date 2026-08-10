# Configuration Reference

## Plugin Settings

Settings are stored in Obsidian's `data.json` via `Plugin.loadData()` / `Plugin.saveData()`. The settings interface and defaults are defined in `settings.ts`.

### Core Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `storyLineRoot` | `string` | `'StoryLine'` | Root folder for all StoryLine projects |
| `defaultProjectLanguage` | `string` | `'en'` | Default BCP-47 locale for new projects |
| `hideFrontmatter` | `boolean` | `false` | Hide YAML frontmatter in StoryLine files |
| `hideToolbarTitle` | `boolean` | `false` | Hide the "StoryLine" title row in toolbars |
| `autoHideViewLabels` | `boolean` | `true` | Auto-collapse view tab labels when toolbar is narrow |
| `showFormattingToolbar` | `boolean` | `false` | Inject formatting toolbar into scene editors |
| `writeFieldsAsWikilinks` | `boolean` | `true` | Write character/location fields as `[[wikilinks]]` |
| `countUnit` | `'words' \| 'chars'` | `'words'` | Unit for scene length display |
| `excludeCommentsFromWordcount` | `boolean` | `true` | Exclude `%%comments%%` from word counts |
| `excludeChecklistFromWordcount` | `boolean` | `false` | Exclude checklist items from word counts |

### Color Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `colorScheme` | `ColorScheme` | `'latte'` | Active color palette |
| `plotlineHue` | `number` | `0` | HSL hue for plotline colors |
| `plotlineSaturation` | `number` | `0` | HSL saturation adjustment |
| `plotlineLightness` | `number` | `0` | HSL lightness adjustment |
| `stickyNoteTheme` | `string` | `'classic'` | Sticky note color theme |
| `stickyNoteHue` | `number` | `0` | HSL hue for sticky notes |
| `stickyNoteSaturation` | `number` | `0` | HSL saturation for sticky notes |
| `stickyNoteLightness` | `number` | `0` | HSL lightness for sticky notes |
| `stickyNoteOverrides` | `Record<string, string>` | `{}` | Per-note color overrides |
| `useProjectColors` | `boolean` | `false` | Save color scheme per project |

### Available Color Schemes

**Catppuccin:** `latte`, `frappe`, `macchiato`, `mocha`

**Mood-based:** `spring`, `morning`, `summer`, `dusk`, `midnight`, `autumn`, `ocean`, `forest`, `sunset`, `arctic`, `vintage`, `neon`

**Manual:** `custom`

### Image Sizing Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `characterCardPortraitSize` | `number` | `64` | Character card portrait size (px) |
| `characterDetailPortraitSize` | `number` | `96` | Character detail portrait size (px) |
| `locationTreeThumbSize` | `number` | `48` | Location tree thumbnail size (px) |
| `locationDetailPortraitWidth` | `number` | `200` | Location detail portrait width (px) |
| `locationDetailPortraitHeight` | `number` | `150` | Location detail portrait height (px) |

### Focus Mode Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `focusDimAmount` | `number` | `0.7` | Dim amount for focus mode |
| `focusDarkenAmount` | `number` | `0.3` | Darken amount for focus mode |
| `focusBlurAmount` | `number` | `5` | Blur amount (px) for focus mode |

### Advanced Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `customStatuses` | `CustomStatusDef[]` | `[]` | User-defined scene statuses |
| `characterAliases` | `Record<string, string>` | `{}` | Character name aliases for link scanning |
| `ignoredCharacters` | `string[]` | `[]` | Characters to ignore in detection |
| `extraFolders` | `string[]` | `[]` | Additional vault folders to scan |
| `universalFieldsMirrorTopLevel` | `boolean` | `true` | Mirror universal fields to top-level YAML |
| `customLocationTypes` | `string[]` | `[]` | User-defined location types |

### Dynamic Narrative Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `dnScenarioCategories` | `string[]` | `['Main Plot', 'Core', 'Minor', 'Dynamic']` | Available categories for Scenarios |
| `dnObjectiveCategories` | `string[]` | `['Structured', 'Dynamic', 'Procedural']` | Available categories for Objectives |
| `dnQuestCategories` | `string[]` | `['Goal', 'Limit', 'Event', 'Modifier']` | Available categories for Quests |
| `dnKanbanShowFullHeader` | `boolean` | `true` | Show name + description + category in the Dynamic Narrative phase-board header (name only when disabled) |

Categories can be managed via the settings tab or per-project through the `DNCategoryModal` in the Dynamic Narrative view. Arc Types and Arc Variants do not have categories; their type is shown when an Arc Variant is linked from an Objective Variant.

## Per-Project System Data

Stored as JSON files in `{project}/System/`, not in `data.json`:

| File | Contents |
|---|---|
| `tag-colors.json` | Per-tag color overrides |
| `aliases.json` | Character name aliases |
| `filter-presets.json` | Saved filter presets |
| `stats.json` | Writing tracker data (daily history, sprint logs) |
| `board.json` | Corkboard positions |
| `field-templates.json` | Universal field template definitions |
| `codex-digests.json` | Content digests for codex change detection |
| `plotgrid.json` | Plot grid data (rows, columns, cells) |
| `dynamic-narrative.json` | Dynamic Narrative entity cache (scenarios, objectives, arcs, quests, layout) |
| `Snapshots/` | View snapshot files |

## Constants (`constants.ts`)

View type string identifiers:

```typescript
BOARD_VIEW_TYPE           = 'story-line-board'
TIMELINE_VIEW_TYPE        = 'story-line-timeline'
STORYLINE_VIEW_TYPE       = 'story-line-storyline'
CHARACTER_VIEW_TYPE       = 'story-line-character'
STATS_VIEW_TYPE           = 'story-line-stats'
PLOTGRID_VIEW_TYPE        = 'story-line-plotgrid'
LOCATION_VIEW_TYPE        = 'story-line-location'
HELP_VIEW_TYPE            = 'story-line-help'
NAVIGATOR_VIEW_TYPE       = 'story-line-navigator'
CODEX_VIEW_TYPE           = 'story-line-codex'
SCENE_INSPECTOR_VIEW_TYPE = 'story-line-scene-inspector'
MANUSCRIPT_VIEW_TYPE      = 'story-line-manuscript'
RESEARCH_VIEW_TYPE        = 'story-line-research'
NOTES_VIEW_TYPE           = 'story-line-notes'
SYNOPSIS_VIEW_TYPE        = 'story-line-synopsis'
DETAILS_VIEW_TYPE         = 'story-line-scene-details'
DYNAMIC_NARRATIVE_VIEW_TYPE = 'story-line-dynamic-narrative'
```

## Manifest (`manifest.json`)

| Field | Value |
|---|---|
| `id` | `storyline` |
| `name` | `StoryLine` |
| `minAppVersion` | `1.12.7` |
| `isDesktopOnly` | `false` |

## CSS Variables

Set dynamically via `applyImageSizingVariables()` in `main.ts`:

| Variable | Source Setting |
|---|---|
| `--sl-character-card-portrait-size` | `characterCardPortraitSize` |
| `--sl-character-detail-portrait-size` | `characterDetailPortraitSize` |
| `--sl-location-tree-thumb-size` | `locationTreeThumbSize` |
| `--sl-location-detail-portrait-width` | `locationDetailPortraitWidth` |
| `--sl-location-detail-portrait-height` | `locationDetailPortraitHeight` |

## CSS Classes (Body-Level Toggles)

Applied to `document.body` for global UI toggles:

| Class | Setting |
|---|---|
| `sl-hide-frontmatter-global` | `hideFrontmatter` |
| `sl-hide-toolbar-title` | `hideToolbarTitle` |
| `sl-auto-hide-tab-labels` | `autoHideViewLabels` |
| `sl-hide-frontmatter` | Per-leaf, scoped to StoryLine files |
