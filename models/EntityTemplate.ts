/**
 * Unified entity template model.
 *
 * Replaces the three legacy template systems (universal field templates,
 * per-view custom sections, hardcoded field categories) with a single
 * per-project template file (`System/entity-templates.json`) that drives
 * every entity editor:
 *
 *   - Scene, Character, World, Location and Codex categories (built-in + custom)
 *   - optional 1-level subcategory axes (e.g. "importance" for characters)
 *
 * A template describes ONLY the user-defined additions: custom sections and
 * custom fields. The default sections/fields (name, role, status, …) live in
 * code (`models/defaults/*`) and are immutable, always visible, and never
 * mirrored to the note body.
 */
import type { CustomFieldDef, CustomSection } from '../components/CustomSectionsRenderer';

/** Reserved entity types that have their own specialised models/views. */
export const ENTITY_TYPE_SCENE = 'scene';
export const ENTITY_TYPE_CHARACTER = 'character';
export const ENTITY_TYPE_WORLD = 'world';
export const ENTITY_TYPE_LOCATION = 'location';
/** Prefix used for Codex category entity types (e.g. `codex:items`). */
export const ENTITY_TYPE_CODEX_PREFIX = 'codex:';

/** Any entity type id — a reserved type or a `codex:<categoryId>` id. */
export type EntityTypeId = string;

/** Template key used when the entity type has no subcategory axis. */
export const BASE_SUBCATEGORY = '';

/**
 * A 1-level subcategory axis (e.g. characters → "importance" with options
 * minor / secondary / main / companion). When an axis is present, every
 * option gets its own (initially empty) template entry; entities store the
 * chosen option in their `templateSubcategory` frontmatter field.
 */
export interface SubcategoryAxis {
    id: string;
    label: string;
    options: string[];
}

/** User-defined additions for a single (entity type, subcategory) pair. */
export interface EntityTemplateEntry {
    customSections: CustomSection[];
}

export interface EntityTypeDef {
    subcategoryAxis?: SubcategoryAxis;
    /** Keyed by subcategory option; `''` is the base (no subcategory) template. */
    templates: Record<string, EntityTemplateEntry>;
}

/** Shape of `System/entity-templates.json`. */
export interface EntityTemplateFile {
    version: number;
    entityTypes: Record<EntityTypeId, EntityTypeDef>;
}

export const ENTITY_TEMPLATE_FILE_NAME = 'entity-templates.json';

/** Namespace a codex category id into an entity type id. */
export function entityTypeForCodex(categoryId: string): string {
    return `${ENTITY_TYPE_CODEX_PREFIX}${categoryId}`;
}

/** Inverse of {@link entityTypeForCodex}; returns undefined for non-codex types. */
export function codexIdFromEntityType(entityType: string): string | undefined {
    if (!entityType.startsWith(ENTITY_TYPE_CODEX_PREFIX)) return undefined;
    return entityType.slice(ENTITY_TYPE_CODEX_PREFIX.length);
}

// ── Default catalog (code-defined, immutable) ──────────

/**
 * A locked default field. Defaults can never be renamed, removed, hidden,
 * reordered or mirrored to the note body. `special` marks fields rendered by
 * dedicated widgets in the view (e.g. Act/Chapter/Sequence, tag pills) that
 * cannot be represented as plain inputs.
 */
export interface DefaultFieldDef {
    /** Frontmatter key on the entity model. */
    key: string;
    /** Label shown in the editor. */
    label: string;
    /** Placeholder / hint text. */
    placeholder: string;
    /** Multi-line input. */
    multiline?: boolean;
    /** On/off checkbox (stored as boolean). */
    toggle?: boolean;
    /** Rendered by a dedicated widget in the view — never a plain input. */
    special?: boolean;
}

/** A locked default section. Never renamable, movable, hidden or removed. */
export interface DefaultSectionDef {
    title: string;
    icon: string;
    fields: DefaultFieldDef[];
}

/** Stronger alias for host code that keeps using the renderer types. */
export type TemplateCustomFieldDef = CustomFieldDef;
export type TemplateCustomSection = CustomSection;
