# Overview
The goal is to modify this fork of the storyline plugin to support the dynamic narrative entities we use in our videogame. 

**Goals**
- A separate board called Dynamic Narrative, used to create, edit, and view new entities: Scenarios, Objectives, Arcs, and several minor entities contained in arcs (Goals, Limits, Events, etc)
- All these entities are managed hierarchically. Scenarios can only contain objectives, Objectives can only contain Arcs, Arcs contain all minor narrative entities
- All these entities must exist as md files, with some of the technical data written in the YAML frontmatter (references to other notes or entities, numerical data, conditions, etc). Unlike the source plugin, we need YAML references to be in the frontmatter The body will contain written text like descripitions.
- The code must be kept separated from the bulk of the plugin as much as possible, so that when the main repository is update it is easier to integrate changes in the fork
- The core functionalities of the plugin must not be changed. The board view used in the plugin, more suited to traditional narrative, will still be used alongside the new board

---

# Details

## Hierarchy
1. **Scenarios**
2. **Objectives**
3. **Arcs**
4. **Quests**: Goals, Limits, Events, Modifiers

There are some fundamental rules when it comes to supporting this hierarchy:
- Scenarios can only contain objectives, Objectives can only contain Arcs, Arcs can only contain all minor narrative entities. An Arc can never be referenced in a Scenario.
- All entities, excluding scenarios, can be referenced by multiple different parents, since they are modular in nature and can be instanced in different contexts
- Parent entities reference their children, never the opposite. All objectives contained inside a Scenarios will be referenced in the scenario but these Objective will never directly reference any Scenario. Objectives will reference arcs, but these arcs will never reference their parent objectives
- Each type of entity has a unique structure, detailed below. We will need separate views in the Dynamic Narrative board to handle the different types of entities.


## Templates Structure
This is a breakdown of the data structure of all Entities

### Scenarios
#### JSON
- All the generic data the plugin needs
- A text field for a description
- A list of connected Acts in which the scenario can appear. These acts are the ones used in the main board
- A category. Default categories are: Main Plot, Core, Minor, Dynamic.
- A list of linked locations
- A list of linked characters
- A list of scenario phases, each of them containing the following data:
	- Name
	- Description
	- Phase Start Conditions
	- Phase Start Commands
	- Phase End COnditions
	- Phase End COmmands
	- A list of linked Objectives
		- A link to an objective entity
		- A boolean to define if this objective is primary, default true
		- a boolean defining if this objective is mandatory or not. Default is false

#### Frontmatter
This data is unique to the frontmatter:
- The tag `storyline-scenario`
- `short-desc` for a description in the metadata

This data is the same that is also in the json and must be updated accordingly
- `scenario-category`
- A list of numbers called `scenario-acts`
- A list of `scenario-phases`, each of them containing the following data:
	- `phase-name` text field 
	- `phase-description` text field 
	- `phase-start-conditions` text field 
	- `phase-end-conditions`  text field 
	- `phase-start-commands` text field 
	- `phase-end-commands` text field 
	- `linked-objectives` a list of linked objectives
		- `objective-id` direct obsidian link (like [[objective.md]])
		- `is-primary` boolean
		- `mandatory` boolean

#### Body
- H1 called `Overview`
- H1 called `Game Details`
	- H2 called `Main Purpose`
	- H2 called `Integration Analysis`

---

### Objectives
#### JSON 
- All the generic data the plugin needs
- A text field for a description
- A category. Default categories are: Structured, Dynamic, Procedural 
- A list of linked locations
- A list of linked characters
- A list of objective phases, each of them containing the following data:
	- Name
	- Description
	- Phase Start Conditions
	- Phase Start Commands
	- Phase End Conditions
	- Phase End Commands
	- A list of linked Arcs
		- A link to an Arc entity
		- A boolean to define if this arc is primary, default true
		- a boolean defining if this arc is mandatory or not. Default is false

The following phases always exists as defaults and cannot be removed: QuestSleeping, QuestAvailable, QuestStarted, QuestCompleted, QuestFailed
#### Frontmatter
This data is unique to the frontmatter:
- The tag `storyline-objective`
- `short-desc` for a description in the metadata

This data is the same that is also in the json and must be updated accordingly
- `objective-category`
- A list of `objective-phases`, each of them containing the following data:
	- `phase-name` text field
	- `phase-description` text field
	- `phase-start-conditions` text field 
	- `phase-start-commands` text field 
	- `phase-end-conditions`  text field 
	- `phase-end-commands` text field
	- `linked-arcs` a list of linked arcs with their objective-related data
		- `arc-id` direct obsidian link (like [[arc.md]]) 
		- `is-primary` boolean
		- `mandatory` boolean

#### Body
- H1 called `Overview`
- H1 called `Game Details`
	- H2 called `Main Purpose`
	- H2 called `Integration Analysis`

---

### Arc
#### JSON 
- All the generic data the plugin needs
- A text field for a description
- A category. Default categories are: Primary, Secondary.
- A list of linked locations
- A boolean to define if it works with dynamic locations or not
- A list of arc phases, each of them containing the following data:
	- Name
	- Description
	- Phase Start Conditions
	- Phase Start Commands
	- Phase End Conditions
	- Phase End Commands
	- A list of linked Goals
	- A list of Linked Limits
	- A list of linked Events
	- A list of linked Modifiers


The following phases always exists as defaults and cannot be removed: QuestSleeping, QuestAvailable, QuestStarted, QuestCompleted, QuestFailed
#### Frontmatter
This data is unique to the frontmatter:
- The tag `storyline-arc`
- `short-desc` for a description in the metadata

This data is the same that is also in the json and must be updated accordingly
- `arc-category`
- A list of `arc-phases`, each of them containing the following data:
	- `phase-name` text field
	- `phase-description` text field
	- `phase-start-conditions` text field 
	- `phase-start-commands` text field 
	- `phase-end-conditions`  text field 
	- `phase-end-commands` text field
	- `linked-goals` direct obsidian links in a list
	- `linked-limits` direct obsidian links in a list
	- `linked-events` direct obsidian links in a list
	- `linked-modifiers` direct obsidian links in a list

#### Body
- H1 called `Overview`
- H1 called `Game Details`
	- H2 called `Main Purpose`
	- H2 called `Integration Analysis`




---

### Quests
#### JSON 
- All the generic data the plugin needs
- A text field for a description
- A category. Default categories are: Goal, Limit, Event, Modifier
- A type. Types can be written as text
- A list of phases, each of them containing the following data:
	- Name
	- Description
	- Phase Start Conditions
	- Phase Start Commands
	- Phase End Conditions
	- Phase End Commands

The following phases always exists as defaults and cannot be removed: QuestSleeping, QuestAvailable, QuestStarted, QuestCompleted, QuestFailed
#### Frontmatter
This data is unique to the frontmatter:
- The tag `storyline-quest`
- `short-desc` for a description in the metadata

This data is the same that is also in the json and must be updated accordingly
- `quest-category`
- `quest-type`
- A list of `quest-phases`, each of them containing the following data:
	- `phase-name` text field
	- `phase-description` text field
	- `phase-start-conditions` text field 
	- `phase-start-commands` text field 
	- `phase-end-conditions`  text field 
	- `phase-end-commands` text field

#### Body
- H1 called `Overview`
- H1 called `Game Details`
	- H2 called `Main Purpose`
	- H2 called `Integration Analysis`

---

# UI and UX
We will need a dedicated UI to edit these entities, something similar to the editor used in this plugin to handle scenes. Since these entities are modular and can have multiple possible parents, we won't need a hierarchical view.

The inspector used in the standard board view must be used here too, but it must become resizable horizontally and its size must be saved locally to prevent it from resetting when changing window or restarting obsidian

All core UI and UX choices made for the basic plugin must be adopted in this case too, like the general UI design or UX functionalities like sorting, filtering, etc. When in doubt, ask a question.

Items in the kanban view can be reordered freely. We can use the same concept used in the core board for the sequence.

- In the Dynamic Narrative board, the user must select one of the following views: Overview, Scenarios, Objectives, Arcs, Quests
- In the Overview view, the user has separated lists for all entities and can sort or filter these lists. Entities can be clicked and edited using the inspector.
- The Scenarios view uses vertically stacked phase panels, with a three-column layout for Conditions, Commands, and linked Objective Variants. Each panel shows its phase name, description, and create/link actions. Clicking on an Objective Variant opens an inspector to edit its data.
- The Objective Variants view uses the same vertical phase-panel layout, showing only Variant overrides for phase content and linked Arc Variants split into Primary and Secondary groups. Clicking on an Arc Variant opens an inspector to edit its data.
- The Arc Variants view uses the same vertical phase-panel layout, showing only Variant overrides and linked Quests grouped as Goals, Limits, Events, and Modifiers. Clicking on a Quest opens an inspector to edit its data.
- Quests do not need a kanban. They must have a view similar to codex entities, with a grid list with all the quests that can be filtered or sorted. When clicking on a quest, the view switches to the editor view similar to the one used for the codex, with a list of quests on the left. In the right sidebar, we can show usage data, for example how many Scenarios, Objective, and Arcs are directly or indirecly connected to this quest. 
	- We don't need images for Quests, so the UI must be copied from the codex and adjusted accordingly. The Grid view too should not use images.
