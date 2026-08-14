/* eslint-disable @typescript-eslint/no-unsafe-return -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; matching enable at end of file */
/**
 * Issue #71 — top-level YAML mirror for entity-template custom fields.
 *
 * Custom-section fields (`System/entity-templates.json`) may opt in via
 * `CustomFieldDef.topLevelKey`; their values are then also written as
 * top-level frontmatter keys so Obsidian Properties, Bases and Dataview can
 * read them. This module is the counterpart of the old
 * `mirrorUniversalFieldsToTopLevel` / `hydrateUniversalFieldsFromTopLevel`
 * helpers that used to live in FieldTemplateService (deleted in Phase 3).
 *
 * Value encoding follows the editor conventions from CustomSectionsRenderer:
 *   - multi-select values are stored comma-joined (`"a, b"`)
 *   - checkbox values are stored as `"true"` / `"false"`
 * When mirroring to YAML these are rehydrated to native types (array /
 * boolean) so the properties look right in Obsidian UI.
 *
 * Folder-sourced fields (dropdown / multi-select with `folderSource`) are
 * wrapped in `[[wikilinks]]` on the way out and stripped on the way back,
 * matching the old universal-field behaviour.
 */
import type { EntityTemplateService } from './EntityTemplateService';
import { CUSTOM_SECTION_KEY_SEP, CustomFieldDef, normalizeField } from '../components/CustomSectionsRenderer';

/** Module-level entity-template provider, wired by the plugin in onload(). */
let _provider: (() => EntityTemplateService) | null = null;
let _mirrorEnabled = true;

/** Wire the entity-template service that backs mirroring (main.ts). */
export function setCustomTopLevelMirrorProvider(fn: () => EntityTemplateService): void {
    _provider = fn;
}

/** Enable / disable top-level YAML writes (settings toggle). */
export function setCustomTopLevelMirrorEnabled(on: boolean): void {
    _mirrorEnabled = !!on;
}

/**
 * Reserved frontmatter keys that custom-field `topLevelKey` values must
 * never collide with. Editing these from a custom field would corrupt
 * core StoryLine data.
 */
export const RESERVED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
    'type', 'name', 'title', 'created', 'modified',
    'act', 'chapter', 'sequence', 'chronologicalOrder', 'chronological_order',
    'pov', 'characters', 'location', 'tags', 'status',
    'storyDate', 'story_date', 'storyTime', 'story_time', 'timeline',
    'conflict', 'emotion', 'intensity', 'wordcount', 'target_wordcount',
    'setup_scenes', 'payoff_scenes', 'codexLinks', 'beatsheet',
    'corkboardNote', 'corkboardNoteColor', 'corkboardNoteImage',
    'corkboardNoteCaption', 'plotgridOrigin', 'subtitle', 'color',
    'timeline_mode', 'timeline_strand',
    'image', 'gallery', 'tagline', 'role', 'occupation', 'residency',
    'family', 'appearance', 'personality', 'goal', 'belief', 'misbelief',
    'fears', 'flaws', 'strengths', 'relations', 'books',
    'world', 'parent', 'description', 'geography', 'culture', 'politics',
    'magicTechnology', 'beliefs', 'economy', 'history', 'locationType',
    'atmosphere', 'significance', 'inhabitants', 'connectedLocations',
    'mapNotes',
    'custom', 'universalFields', 'notes',
]);

/** True if a top-level key is safe to use (not reserved). */
export function isReservedTopLevelKey(key: string): boolean {
    return RESERVED_TOP_LEVEL_KEYS.has(String(key || '').trim());
}

/**
 * All custom-field defs for an (entity type, subcategory) pair, resolved
 * through the active EntityTemplateService, with their composite keys.
 */
function getFieldDefs(
    entityType: string,
    subcategory?: string,
): { compositeKey: string; field: CustomFieldDef }[] {
    const et = _provider?.();
    if (!et) return [];
    const out: { compositeKey: string; field: CustomFieldDef }[] = [];
    for (const sec of et.getCustomSections(entityType, subcategory)) {
        for (const entry of sec.fields) {
            const field = normalizeField(entry);
            if (!field.name) continue;
            out.push({
                compositeKey: `${sec.title}${CUSTOM_SECTION_KEY_SEP}${field.name}`,
                field,
            });
        }
    }
    return out;
}

/** Strip Obsidian wikilink brackets / pipe aliases off a value. */
function stripWikilinks(value: unknown): unknown {
    const strip = (s: string): string => {
        const m = s.match(/^\[\[([^\]]+)\]\]$/);
        if (!m) return s;
        const inner = m[1];
        const pipeIdx = inner.indexOf('|');
        return (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
    };
    if (Array.isArray(value)) {
        return value.map(v => (typeof v === 'string' ? strip(v) : v));
    }
    if (typeof value === 'string') return strip(value);
    return value;
}

/** Wrap a folder-sourced value as Obsidian wikilink(s) for top-level YAML. */
function wrapAsWikilinks(value: unknown): unknown {
    const wrap = (s: string): string => {
        const trimmed = s.trim();
        if (!trimmed) return s;
        if (/^\[\[[^\]]+\]\]$/.test(trimmed)) return trimmed;
        return `[[${trimmed}]]`;
    };
    if (Array.isArray(value)) {
        return value.map(v => (typeof v === 'string' && v.trim() ? wrap(v) : v));
    }
    if (typeof value === 'string') return wrap(value);
    return value;
}

function isFolderSourced(field: CustomFieldDef): boolean {
    return !!field.folderSource && (field.type === 'dropdown' || field.type === 'multi-select');
}

/**
 * Convert a raw `custom[compositeKey]` string into the native YAML value
 * that should be written to the top-level key. Returns undefined for
 * empty values (caller deletes the key instead).
 */
function decodeForYaml(field: CustomFieldDef, raw: string): unknown {
    if (raw === undefined || raw === null || raw === '' || !String(raw).trim()) return undefined;
    const s = String(raw);
    if (field.type === 'multi-select') {
        const arr = s.split(',').map(v => v.trim()).filter(Boolean);
        return isFolderSourced(field) ? wrapAsWikilinks(arr) : arr;
    }
    if (field.type === 'checkbox') {
        return s === 'true' || s === 'yes' || s === '1';
    }
    return isFolderSourced(field) ? wrapAsWikilinks(s) : s;
}

/**
 * Convert a native top-level YAML value into the storage string used in
 * `custom[compositeKey]` (inverse of {@link decodeForYaml}). Returns
 * undefined for empty values.
 */
function encodeForStorage(field: CustomFieldDef, value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) {
        const arr = value.filter(v => v !== undefined && v !== null && v !== '').map(String);
        if (arr.length === 0) return undefined;
        const plain = isFolderSourced(field) ? stripWikilinks(arr) as unknown[] : arr;
        return plain.map(String).join(', ');
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return undefined;
        return isFolderSourced(field) ? String(stripWikilinks(s)) : s;
    }
    // numbers are safe to stringify; objects/arrays-with-non-strings are not
    if (typeof value === 'number') return String(value);
    return undefined;
}

/**
 * Mirror custom-field values to top-level YAML keys for fields that opt in
 * via `topLevelKey`. Mutates `fm` in place. Removes the top-level key when
 * the value is empty so the YAML stays clean. Issue #71.
 */
export function mirrorCustomToTopLevel(
    fm: Record<string, unknown>,
    custom: Record<string, string> | undefined,
    entityType: string,
    subcategory?: string,
): void {
    if (!_mirrorEnabled) return;
    const defs = getFieldDefs(entityType, subcategory);
    if (defs.length === 0) return;
    for (const { compositeKey, field } of defs) {
        const k = field.topLevelKey;
        if (!k || isReservedTopLevelKey(k)) continue;
        const raw = custom ? custom[compositeKey] : undefined;
        const decoded = raw !== undefined && raw !== null ? decodeForYaml(field, raw) : undefined;
        if (decoded === undefined) {
            delete fm[k];
        } else {
            fm[k] = decoded;
        }
    }
}

/**
 * Hydrate `custom[compositeKey]` values from matching top-level YAML keys.
 * A top-level value only fills the slot when the custom field is currently
 * missing/empty, so a hand-edited top-level key never clobbers a value the
 * editor already saved. Issue #71.
 */
export function hydrateCustomFromTopLevel(
    fm: Record<string, unknown>,
    custom: Record<string, string> | undefined,
    entityType: string,
    subcategory?: string,
): Record<string, string> | undefined {
    const defs = getFieldDefs(entityType, subcategory);
    if (defs.length === 0) return custom;
    let result = custom ? { ...custom } : undefined;
    let changed = false;
    for (const { compositeKey, field } of defs) {
        const k = field.topLevelKey;
        if (!k || isReservedTopLevelKey(k)) continue;
        const top = fm[k];
        if (top === undefined || top === null || top === '') continue;
        if (result && result[compositeKey] !== undefined && result[compositeKey] !== '') continue;
        const stored = encodeForStorage(field, top);
        if (stored === undefined) continue;
        if (!result) result = {};
        result[compositeKey] = stored;
        changed = true;
    }
    return changed ? result : custom;
}
/* eslint-enable @typescript-eslint/no-unsafe-return -- end of file-wide suppression block opened at line 1 */
