# Views Reference

All 17 views extend Obsidian's `ItemView` class and are registered in `main.ts` `onload()`. View type constants are defined in `constants.ts`.

## View Registry

| View Type Constant | String ID | Class | File |
|---|---|---|---|
| `BOARD_VIEW_TYPE` | `story-line-board` | `BoardView` | `views/BoardView.ts` |
| `TIMELINE_VIEW_TYPE` | `story-line-timeline` | `TimelineView` | `views/TimelineView.ts` |
| `PLOTGRID_VIEW_TYPE` | `story-line-plotgrid` | `PlotgridView` | `views/PlotgridView.ts` |
| `STORYLINE_VIEW_TYPE` | `story-line-storyline` | `StorylineView` | `views/StorylineView.ts` |
| `CHARACTER_VIEW_TYPE` | `story-line-character` | `CharacterView` | `views/CharacterView.ts` |
| `STATS_VIEW_TYPE` | `story-line-stats` | `StatsView` | `views/StatsView.ts` |
| `LOCATION_VIEW_TYPE` | `story-line-location` | `LocationView` | `views/LocationView.ts` |
| `CODEX_VIEW_TYPE` | `story-line-codex` | `CodexView` | `views/CodexView.ts` |
| `MANUSCRIPT_VIEW_TYPE` | `story-line-manuscript` | `ManuscriptView` | `views/ManuscriptView.ts` |
| `NAVIGATOR_VIEW_TYPE` | `story-line-navigator` | `NavigatorView` | `views/NavigatorView.ts` |
| `SCENE_INSPECTOR_VIEW_TYPE` | `story-line-scene-inspector` | `SceneInspectorView` | `views/SceneInspectorView.ts` |
| `RESEARCH_VIEW_TYPE` | `story-line-research` | `ResearchView` | `views/ResearchView.ts` |
| `NOTES_VIEW_TYPE` | `story-line-notes` | `NotesView` | `views/NotesView.ts` |
| `SYNOPSIS_VIEW_TYPE` | `story-line-synopsis` | `SynopsisView` | `views/SynopsisView.ts` |
| `DETAILS_VIEW_TYPE` | `story-line-scene-details` | `DetailsView` | `views/DetailsView.ts` |
| `HELP_VIEW_TYPE` | `story-line-help` | `HelpView` | `views/HelpView.ts` |
| `DYNAMIC_NARRATIVE_VIEW_TYPE` | `story-line-dynamic-narrative` | `DynamicNarrativeView` | `dynamic-narrative/views/DynamicNarrativeView.ts` |

## View Details

### BoardView
Kanban-style scene card board with two modes: standard Kanban columns and corkboard freeform spatial canvas. Columns can be grouped by act, chapter, status, or custom fields. Supports drag-and-drop, multi-select, color coding, and sticky notes. Corkboard positions are saved per project in `System/board.json`.

**Constructor:** `BoardView(leaf, plugin, sceneManager)`

### TimelineView
Chronological scene timeline with visual markers for intensity, status, and duration. Supports swimlane grouping by POV, character, location, or plotline. Ten non-linear narrative modes (flashback, parallel, dream, etc.).

**Constructor:** `TimelineView(leaf, plugin, sceneManager)`

### PlotgridView
Spreadsheet-style grid mapping scenes against plotlines, themes, or story threads. Cells support free text, formatting, colors, and linked scene cards. Sticky headers, act/chapter divider bands, and auto-note creation. Data stored in `System/plotgrid.json`.

**Constructor:** `PlotgridView(leaf, plugin?)`

### StorylineView
Plotline tracking with two display modes: transit-style subway map (SVG with gradient connectors) and classic list view. Per-tag color assignment. Drag-to-pan for large stories.

**Constructor:** `StorylineView(leaf, plugin, sceneManager)`

### CharacterView
Rich character profiles with collapsible sections, portrait images, image galleries, force-directed relationship map, and story graph visualization. Three display modes: grid, map, story-graph.

**Constructor:** `CharacterView(leaf, plugin, sceneManager, characterManager)`

### StatsView
Statistics dashboard with eight collapsible sections: project overview, writing sprint, writing history, progress breakdown, character coverage heatmap, setup/payoff map, pacing analysis, prose analysis, and plot hole warnings.

**Constructor:** `StatsView(leaf, plugin, sceneManager)`

### LocationView
Hierarchical world/location browser with inline editing. Worlds as top-level containers, locations nested underneath. Portrait images, image galleries, and detail editor.

**Constructor:** `LocationView(leaf, plugin, sceneManager, locationManager)`

### CodexView
Central hub for all codex categories (Characters, Locations, Items, Creatures, custom). Grid of entry cards with detail panels. Two-way change detection flags scenes referencing modified entries.

**Constructor:** `CodexView(leaf, plugin, sceneManager)`

### ManuscriptView
Scrivenings-style continuous document view. Every scene rendered as an embedded Live Preview editor, ordered by act, chapter, sequence. Plain Text and Lock Links toggles for distraction-free writing. Focus Mode with configurable dim/darken/blur.

**Constructor:** `ManuscriptView(leaf, plugin, sceneManager)`

### NavigatorView
Compact sidebar panel for quick scene navigation. Search, sort (5 modes), plotline filtering with color-coded dots, act grouping, pinned scenes, progress bar. Auto-opens on project load.

**Constructor:** `NavigatorView(leaf, plugin, sceneManager)`

### SceneInspectorView
Standalone sidebar for lightweight scene planning. Shows synopsis, POV, status, characters, location, tags, and other metadata. Follows the active editor file.

**Constructor:** `SceneInspectorView(leaf, plugin, sceneManager)`

### ResearchView
Right-sidebar panel for research notes, web clips, images, and open questions. Search, tag filter, type filter, and auto-suggest mode based on active scene metadata.

**Constructor:** `ResearchView(leaf, plugin, manager: ResearchManager)`

### NotesView
Standalone sidebar mirroring a scene's `notes` field with native Live Preview editing. Follows the active editor file.

**Constructor:** `NotesView(leaf, plugin, sceneManager)`

### SynopsisView
Standalone sidebar mirroring a scene's `synopsis` field for lightweight editing. Follows the active editor file.

**Constructor:** `SynopsisView(leaf, plugin, sceneManager)`

### DetailsView
Standalone pane hosting the full `InspectorComponent` for comprehensive scene metadata editing. Follows the active editor file.

**Constructor:** `DetailsView(leaf, plugin, sceneManager)`

### HelpView
Displays the bundled `HELP.md` documentation in a dedicated pane.

**Constructor:** `HelpView(leaf, plugin)`

### DynamicNarrativeView

Single view with 5 internal tabs for game narrative entities. Includes a resizable inspector sidebar (mouse + touch support, session-only width), kanban boards for Scenarios/Objectives/Arcs, a quest grid for Quests, and a unified Overview. Uses `DNKanban`, `DNQuestGrid`, `DNInspector`, and `DNOverview` components. Features the standard plugin header toolbar with view switcher for cross-view navigation. The inspector panel is hidden when viewing the Quests tab.

**Tabs:**
| Tab | Component | Description |
|---|---|---|
| Overview | `DNOverview` | Collapsible lists for all 4 entity types with search, sort, and filter |
| Scenarios | `DNKanban` | Kanban view for Scenarios with sidebar entity selector, phase columns, drag-and-drop |
| Objectives | `DNKanban` | Kanban view for Objectives |
| Arcs | `DNKanban` | Kanban view for Arcs |
| Quests | `DNQuestGrid` | Quest list + editor + usage stats sidebar |

**Constructor:** `DynamicNarrativeView(leaf: WorkspaceLeaf, plugin: SceneCardsPlugin)`

**Key methods:**
- `openInInspector(path)` -- single-click opens entity in inspector (skipped for quests)
- `navigateToKanban(path, entityType)` -- double-click navigates to kanban tab
- `refresh()` -- reload data and refresh current tab, hides inspector on quests tab

**Components used:**
- `DNOverview` -- debounced search (200ms), sort, category filter, DNCreateModal for entity creation
- `DNKanban` -- phase columns, sidebar with search, drag-and-drop cards, right-click context menu (Edit/Unlink), create child entities from column header
- `DNQuestGrid` -- list panel, editor panel (category, type, description, phases), usage panel (transitive connection counts)
- `DNInspector` -- entity fields, category selector, phase accordions with DNPhaseModal for custom phases, auto-save (600ms debounce). Features suggestor-based tag-pill inputs for Linked Locations, Linked Characters, and arc phase quest links (Goals/Limits/Events/Modifiers). Header includes file-open and delete buttons with confirmation dialog. Custom phase names use single-line inputs.

**Mobile:** Inspector resize supports touch events. Touchstart/touchmove/touchend handlers registered alongside mouse events, properly cleaned up on view close.

---

## Shared Patterns

### View Lifecycle
All views follow the Obsidian `ItemView` lifecycle:
1. `onOpen()` -- build DOM, attach event listeners, render initial content
2. `onClose()` -- clean up DOM, remove listeners
3. `getViewType()` -- return the string constant from `constants.ts`
4. `getDisplayText()` -- return human-readable name
5. `getIcon()` -- return Lucide icon name

### Refresh Pattern
Views are refreshed via `plugin.refreshOpenViews()` which is debounced (500ms) after vault file events. Each view's `renderView()` or equivalent method rebuilds its DOM content.

### Shared Filters
Board, Timeline, Plotgrid, and Manuscript views share the same `Filters` component (`components/Filters.ts`) for consistent filtering across views.

### Inspector Component
The `Inspector` component (`components/Inspector.ts`) is reused across BoardView, SceneInspectorView, DetailsView, and PlotgridView for scene metadata editing.

### View Tab Toolbar
All views use a shared tab-based toolbar for switching between views. Tab labels auto-hide when the toolbar is narrow (configurable via `autoHideViewLabels` setting).

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+1` | Board view |
| `Ctrl+Shift+2` | Timeline view |
| `Ctrl+Shift+3` | Plotgrid view |
| `Ctrl+Shift+4` | Plotlines view |
| `Ctrl+Shift+5` | Character view |
| `Ctrl+Shift+6` | Stats view |
| `Ctrl+Shift+7` | Location view |
| `Ctrl+Shift+N` | Quick-add new scene |
| `Ctrl+Shift+E` | Export project |
| `Ctrl+Z` | Undo (when StoryLine view is active and not in text input) |
| `Ctrl+Shift+Z` | Redo |

### Command Palette

| Command | Action |
|---|---|
| `StoryLine: Open Dynamic Narrative` | Opens the Dynamic Narrative view |
