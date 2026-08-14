/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
/**
 * Unified entity template service.
 *
 * Owns `System/entity-templates.json` (per-project) and provides:
 *   - the code-defined default catalogs for every entity type
 *   - the user-defined custom sections for every (entity type, subcategory)
 *   - subcategory axis management (added in Phase 2; the storage and accessors
 *     already exist so the settings UI can build on them)
 *
 * The old template systems (universal field templates, per-view custom
 * section settings) are superseded by this service. Existing data files are
 * left untouched and ignored — no migration.
 */
import { App, normalizePath } from 'obsidian';
import {
    BASE_SUBCATEGORY,
    ENTITY_TEMPLATE_FILE_NAME,
    EntityTemplateFile,
    EntityTemplateEntry,
    EntityTypeDef,
    SubcategoryAxis,
    codexIdFromEntityType,
    entityTypeForCodex,
} from '../models/EntityTemplate';
import { DEFAULT_CHARACTER_CATEGORIES } from '../models/defaults/character';
import { DEFAULT_WORLD_CATEGORIES } from '../models/defaults/world';
import { DEFAULT_LOCATION_CATEGORIES } from '../models/defaults/location';
import { DEFAULT_CODEX_CATEGORIES } from '../models/defaults/codex';
import { DEFAULT_SCENE_SECTIONS } from '../models/defaults/scene';
import { CUSTOM_SECTION_KEY_SEP, CustomFieldDef, CustomFieldType, CustomSection } from '../components/CustomSectionsRenderer';
import type { MirroredSection } from './CodexManager';
import type { CharacterFieldCategory } from '../models/Character';
import type { CodexFieldCategory } from '../models/Codex';
import type { LocationFieldCategory } from '../models/Location';
import type { DefaultSectionDef } from '../models/EntityTemplate';

/** Change hook — called after any persisted mutation (template / axis change). */
export type EntityTemplateChange = 'sections' | 'axis';

/**
 * Resolve the entity type id for a codex category id.
 */
export function entityTypeForCodexCategory(categoryId: string): string {
    return entityTypeForCodex(categoryId);
}

export class EntityTemplateService {
    private app: App;
    /** Resolver set by the plugin so we don't depend on main.ts directly. */
    private getSystemFolder: () => string;
    private file: EntityTemplateFile = { version: 1, entityTypes: {} };
    private onChangeCbs: ((change: EntityTemplateChange, entityType: string) => void | Promise<void>)[] = [];

    constructor(app: App, getSystemFolder: () => string) {
        this.app = app;
        this.getSystemFolder = getSystemFolder;
    }

    /** Register a callback to run after any template mutation. */
    setOnChange(fn: (change: EntityTemplateChange, entityType: string) => void | Promise<void>): void {
        this.onChangeCbs.push(fn);
    }

    private async notify(change: EntityTemplateChange, entityType: string): Promise<void> {
        for (const cb of this.onChangeCbs) {
            try {
                await cb(change, entityType);
            } catch (e) {
                console.error('[StoryLine] EntityTemplate onChange:', e);
            }
        }
    }

    // ── Persistence ──────────────────────────────────

    /** Load templates from System/entity-templates.json. */
    async load(): Promise<void> {
        try {
            const adapter = this.app.vault.adapter;
            const filePath = normalizePath(`${this.getSystemFolder()}/${ENTITY_TEMPLATE_FILE_NAME}`);
            if (!await adapter.exists(filePath)) {
                this.file = { version: 1, entityTypes: {} };
                return;
            }
            const txt = await adapter.read(filePath);
            const data = JSON.parse(txt) as Partial<EntityTemplateFile>;
            const entityTypes: Record<string, EntityTypeDef> = {};
            if (data.entityTypes && typeof data.entityTypes === 'object') {
                for (const [et, def] of Object.entries(data.entityTypes)) {
                    if (!def || typeof def !== 'object') continue;
                    entityTypes[et] = this.normalizeEntityTypeDef(def);
                }
            }
            this.file = { version: 1, entityTypes };
        } catch (e) {
            console.error('[StoryLine] EntityTemplateService.load():', e);
            this.file = { version: 1, entityTypes: {} };
        }
    }

    /** Save templates to System/entity-templates.json. */
    async save(): Promise<void> {
        try {
            const adapter = this.app.vault.adapter;
            const systemFolder = normalizePath(this.getSystemFolder());
            if (!await adapter.exists(systemFolder)) {
                await this.app.vault.createFolder(systemFolder);
            }
            await adapter.write(
                normalizePath(`${systemFolder}/${ENTITY_TEMPLATE_FILE_NAME}`),
                JSON.stringify(this.file, null, 2),
            );
        } catch (e) {
            console.error('[StoryLine] EntityTemplateService.save():', e);
        }
    }

    private normalizeEntityTypeDef(def: Partial<EntityTypeDef>): EntityTypeDef {
        const out: EntityTypeDef = { templates: {} };
        if (def.subcategoryAxis && typeof def.subcategoryAxis === 'object') {
            const axis = def.subcategoryAxis;
            const options = Array.isArray(axis.options)
                ? axis.options.map(o => String(o).trim()).filter(Boolean)
                : [];
            if (options.length > 0 && typeof axis.label === 'string') {
                out.subcategoryAxis = {
                    id: String(axis.id || 'subcategory').trim() || 'subcategory',
                    label: axis.label,
                    options,
                };
            }
        }
        if (def.templates && typeof def.templates === 'object') {
            for (const [key, entry] of Object.entries(def.templates)) {
                if (!entry || typeof entry !== 'object') continue;
                const sections = Array.isArray(entry.customSections)
                    ? entry.customSections
                        .filter((s): s is CustomSection => !!s && typeof s === 'object' && typeof s.title === 'string')
                        .map(s => this.normalizeSection(s))
                    : [];
                out.templates[key] = { customSections: sections };
            }
        }
        if (!out.templates[BASE_SUBCATEGORY]) {
            out.templates[BASE_SUBCATEGORY] = { customSections: [] };
        }
        return out;
    }

    private normalizeSection(sec: CustomSection): CustomSection {
        const fields: CustomFieldDef[] = [];
        for (const entry of Array.isArray(sec.fields) ? sec.fields : []) {
            const def = typeof entry === 'string' ? { name: entry } : entry;
            if (!def || typeof def.name !== 'string' || !def.name.trim()) continue;
            fields.push({
                name: def.name.trim(),
                type: def.type ?? 'text',
                placeholder: typeof def.placeholder === 'string' ? def.placeholder : undefined,
                options: Array.isArray(def.options) ? def.options.map(String).filter(Boolean) : undefined,
                folderSource: typeof def.folderSource === 'string' ? def.folderSource : undefined,
                topLevelKey: typeof def.topLevelKey === 'string' && def.topLevelKey.trim() ? def.topLevelKey.trim() : undefined,
            });
        }
        const pos = typeof sec.position === 'number' && !isNaN(sec.position) ? sec.position : undefined;
        const linkId = typeof sec.linkId === 'string' && sec.linkId.trim() ? sec.linkId.trim() : undefined;
        return { title: sec.title, fields, ...(pos !== undefined ? { position: pos } : {}), ...(linkId !== undefined ? { linkId } : {}) };
    }

    // ── Default catalogs (code-defined, immutable) ────

    /** Default (locked) sections for an entity type. */
    getDefaultSections(entityType: string): DefaultSectionDef[] {
        switch (entityType) {
            case 'scene':
                return DEFAULT_SCENE_SECTIONS;
            case 'character':
                return DEFAULT_CHARACTER_CATEGORIES as unknown as DefaultSectionDef[];
            case 'world':
                return DEFAULT_WORLD_CATEGORIES as unknown as DefaultSectionDef[];
            case 'location':
                return DEFAULT_LOCATION_CATEGORIES as unknown as DefaultSectionDef[];
            default:
                if (codexIdFromEntityType(entityType) !== undefined) {
                    return DEFAULT_CODEX_CATEGORIES as unknown as DefaultSectionDef[];
                }
                return [];
        }
    }

    /** Default categories in their native view types (convenience helpers). */
    getCharacterDefaultSections(): CharacterFieldCategory[] {
        return DEFAULT_CHARACTER_CATEGORIES;
    }

    getLocationDefaultSections(isWorld: boolean): LocationFieldCategory[] {
        return isWorld ? DEFAULT_WORLD_CATEGORIES : DEFAULT_LOCATION_CATEGORIES;
    }

    getCodexDefaultSections(): CodexFieldCategory[] {
        return DEFAULT_CODEX_CATEGORIES;
    }

    /** Titles of the default (locked) sections for an entity type. */
    getDefaultSectionTitles(entityType: string): string[] {
        return this.getDefaultSections(entityType).map(s => s.title);
    }

    // ── Entity type entries ───────────────────────────

    private ensureEntityType(entityType: string): EntityTypeDef {
        let def = this.file.entityTypes[entityType];
        if (!def) {
            def = { templates: { [BASE_SUBCATEGORY]: { customSections: [] } } };
            this.file.entityTypes[entityType] = def;
        }
        if (!def.templates[BASE_SUBCATEGORY]) {
            def.templates[BASE_SUBCATEGORY] = { customSections: [] };
        }
        return def;
    }

    /** Template entry for an (entity type, subcategory) pair. Falls back to
     *  the base template when the subcategory has no dedicated entry. */
    getTemplateEntry(entityType: string, subcategory?: string): EntityTemplateEntry {
        const def = this.ensureEntityType(entityType);
        const key = subcategory && subcategory.trim() ? subcategory.trim() : BASE_SUBCATEGORY;
        if (!def.templates[key]) {
            def.templates[key] = { customSections: [] };
        }
        return def.templates[key];
    }

    /** User-defined custom sections for an (entity type, subcategory) pair. */
    getCustomSections(entityType: string, subcategory?: string): CustomSection[] {
        return this.getTemplateEntry(entityType, subcategory).customSections;
    }

    /** Replace the custom sections for an (entity type, subcategory) pair. */
    async setCustomSections(entityType: string, subcategory: string | undefined, sections: CustomSection[]): Promise<void> {
        const entry = this.getTemplateEntry(entityType, subcategory);
        entry.customSections = sections;
        await this.save();
        await this.notify('sections', entityType);
    }

    // ── Subcategory axes ──────────────────────────────

    /** The subcategory axis for an entity type, if any. */
    getAxis(entityType: string): SubcategoryAxis | undefined {
        return this.file.entityTypes[entityType]?.subcategoryAxis;
    }

    /**
     * Set (or clear, with `undefined`) the subcategory axis for an entity
     * type. When setting, ensures every option has its own (empty) template
     * entry. Existing entries for removed options are kept for safety.
     */
    async setAxis(entityType: string, axis: SubcategoryAxis | undefined): Promise<void> {
        const def = this.ensureEntityType(entityType);
        if (!axis || !axis.label || axis.options.length === 0) {
            delete def.subcategoryAxis;
        } else {
            def.subcategoryAxis = {
                id: axis.id.trim() || 'subcategory',
                label: axis.label,
                options: [...axis.options],
            };
            for (const opt of def.subcategoryAxis.options) {
                if (!def.templates[opt]) def.templates[opt] = { customSections: [] };
            }
        }
        await this.save();
        await this.notify('axis', entityType);
    }

    // ── Section linkage (multi-subcategory scoping) ───

    /** Assign a linkId to a section that lacks one and persist it. Returns the
     *  (possibly newly generated) linkId. */
    async ensureSectionLinkId(entityType: string, subcategory: string | undefined, section: CustomSection): Promise<string> {
        if (section.linkId) return section.linkId;
        section.linkId = this.newLinkId();
        await this.save();
        await this.notify('sections', entityType);
        return section.linkId;
    }

    /** Subcategory axis options in which a section with this linkId currently
     *  appears. */
    getLinkedSubcategories(entityType: string, linkId: string): string[] {
        const def = this.file.entityTypes[entityType];
        if (!def) return [];
        const out: string[] = [];
        for (const [key, entry] of Object.entries(def.templates)) {
            if (key === BASE_SUBCATEGORY) continue;
            if (entry.customSections.some(s => s.linkId === linkId)) out.push(key);
        }
        return out;
    }

    /** Scope a linked section to a set of axis options. With an empty set the
     *  section lives only in the base template. Replicates the authoritative
     *  `section` into each chosen template and removes it from the rest. */
    async setSectionScope(entityType: string, linkId: string, section: CustomSection, subcategories: string[]): Promise<void> {
        const def = this.ensureEntityType(entityType);
        const wanted = new Set(subcategories.map(s => s.trim()).filter(Boolean));
        for (const key of Object.keys(def.templates)) {
            const entry = def.templates[key];
            for (let i = entry.customSections.length - 1; i >= 0; i--) {
                if (entry.customSections[i].linkId === linkId) entry.customSections.splice(i, 1);
            }
        }
        const targets = wanted.size > 0 ? [...wanted] : [BASE_SUBCATEGORY];
        for (const key of targets) {
            const entry = this.getTemplateEntry(entityType, key === BASE_SUBCATEGORY ? undefined : key);
            entry.customSections.push(this.cloneSection(section, linkId));
        }
        await this.save();
        await this.notify('sections', entityType);
    }

    /** Overwrite every other subcategory template's copy of a linked section
     *  with the authoritative copy (title / fields / position). Used to keep a
     *  live two-way link after a structural edit in one subcategory. */
    async syncLinkedSection(entityType: string, linkId: string, sourceSubcategory: string | undefined, section: CustomSection): Promise<void> {
        const def = this.file.entityTypes[entityType];
        if (!def) return;
        let changed = false;
        for (const [key, entry] of Object.entries(def.templates)) {
            const normKey = key === BASE_SUBCATEGORY ? undefined : key;
            if (normKey === sourceSubcategory) continue;
            for (const s of entry.customSections) {
                if (s.linkId !== linkId) continue;
                s.title = section.title;
                s.fields = this.cloneFields(section.fields);
                if (section.position !== undefined) s.position = section.position;
                else delete s.position;
                changed = true;
            }
        }
        if (changed) {
            await this.save();
            await this.notify('sections', entityType);
        }
    }

    /** Remove a linked section from every template (base + all subcategories). */
    async removeLinkedSection(entityType: string, linkId: string): Promise<void> {
        const def = this.file.entityTypes[entityType];
        if (!def) return;
        let removed = false;
        for (const key of Object.keys(def.templates)) {
            const entry = def.templates[key];
            for (let i = entry.customSections.length - 1; i >= 0; i--) {
                if (entry.customSections[i].linkId === linkId) {
                    entry.customSections.splice(i, 1);
                    removed = true;
                }
            }
        }
        if (removed) {
            await this.save();
            await this.notify('sections', entityType);
        }
    }

    private newLinkId(): string {
        return 'sec_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    }

    private cloneSection(section: CustomSection, linkId: string): CustomSection {
        const out: CustomSection = {
            title: section.title,
            fields: this.cloneFields(section.fields),
            linkId,
        };
        if (section.position !== undefined) out.position = section.position;
        return out;
    }

    private cloneFields(fields: CustomSection['fields']): CustomSection['fields'] {
        return fields.map(entry => {
            if (typeof entry === 'string') return entry;
            const copy: CustomFieldDef = { ...entry };
            if (entry.options) copy.options = [...entry.options];
            return copy;
        });
    }

    // ── Mirroring helpers ─────────────────────────────

    /** A custom field def together with its composite key and section. */
    getCustomFields(entityType: string, subcategory?: string): { compositeKey: string; section: CustomSection; field: CustomFieldDef }[] {
        const out: { compositeKey: string; section: CustomSection; field: CustomFieldDef }[] = [];
        for (const sec of this.getCustomSections(entityType, subcategory)) {
            for (const entry of sec.fields) {
                const def = typeof entry === 'string' ? { name: entry } : entry;
                if (!def || !def.name) continue;
                out.push({
                    compositeKey: `${sec.title}${CUSTOM_SECTION_KEY_SEP}${def.name}`,
                    section: sec,
                    field: def,
                });
            }
        }
        return out;
    }

    /** Custom fields filtered to a set of input types (e.g. dropdown / multi-select). */
    getCustomFieldsByType(
        entityType: string,
        types: readonly CustomFieldType[],
        subcategory?: string,
    ): { compositeKey: string; section: CustomSection; field: CustomFieldDef }[] {
        return this.getCustomFields(entityType, subcategory)
            .filter(({ field }) => types.includes((field.type ?? 'text') as CustomFieldType));
    }

    /** Custom fields across the base template AND every subcategory-option
     *  template (deduped by composite key). Board grouping / filters / card
     *  badges use this so fields defined only on a subcategory axis still
     *  show up. */
    getAllCustomFields(entityType: string): { compositeKey: string; section: CustomSection; field: CustomFieldDef }[] {
        const subs: (string | undefined)[] = [undefined];
        const axis = this.getAxis(entityType);
        if (axis) for (const opt of axis.options) subs.push(opt);
        const seen = new Set<string>();
        const out: { compositeKey: string; section: CustomSection; field: CustomFieldDef }[] = [];
        for (const sub of subs) {
            for (const f of this.getCustomFields(entityType, sub)) {
                if (seen.has(f.compositeKey)) continue;
                seen.add(f.compositeKey);
                out.push(f);
            }
        }
        return out;
    }

    /** {@link getAllCustomFields} filtered to a set of input types. */
    getAllCustomFieldsByType(
        entityType: string,
        types: readonly CustomFieldType[],
    ): { compositeKey: string; section: CustomSection; field: CustomFieldDef }[] {
        return this.getAllCustomFields(entityType)
            .filter(({ field }) => types.includes((field.type ?? 'text') as CustomFieldType));
    }

    /**
     * Composite keys of custom fields that are mirrored to the note body.
     *
     * Per the unified mirroring rule (Issue #228 phase 2), every custom field
     * of type `text` or `textarea` is mirrored automatically — there is no
     * longer a per-field toggle. Legacy string entries are treated as `text`.
     */
    getMirroredFieldKeys(entityType: string, subcategory?: string): string[] {
        const keys: string[] = [];
        for (const sec of this.getCustomSections(entityType, subcategory)) {
            for (const entry of sec.fields) {
                const def = typeof entry === 'string' ? { name: entry } : entry;
                if (!def) continue;
                const type = (def.type ?? 'text') as CustomFieldType;
                if (type === 'text' || type === 'textarea') {
                    keys.push(`${sec.title}${CUSTOM_SECTION_KEY_SEP}${def.name}`);
                }
            }
        }
        return keys;
    }

    /**
     * Build the {@link MirroredSection} list for an entity's custom text /
     * textarea fields. Returns an array (never undefined) suitable to pass
     * straight to a manager `saveXxx` method. Empty-string values are kept so
     * that cleared fields still drop out of the body via `buildMirroredBody`.
     */
    buildAutoMirroredSections(
        entityType: string,
        subcategory: string | undefined,
        custom: Record<string, string> | undefined,
    ): MirroredSection[] {
        const keys = this.getMirroredFieldKeys(entityType, subcategory);
        if (keys.length === 0) return [];
        const sections: MirroredSection[] = [];
        for (const key of keys) {
            const found = this.findFieldByCompositeKey(entityType, key, subcategory);
            if (!found) continue;
            sections.push({
                sectionTitle: found.section.title,
                fieldKey: key,
                fieldLabel: found.field.name,
                value: custom?.[key] ?? '',
            });
        }
        return sections;
    }

    /** Find a custom field def by its composite key (section :: field). */
    findFieldByCompositeKey(
        entityType: string,
        compositeKey: string,
        subcategory?: string,
    ): { section: CustomSection; field: CustomFieldDef } | null {
        const sep = CUSTOM_SECTION_KEY_SEP;
        const idx = compositeKey.indexOf(sep);
        if (idx < 0) return null;
        const sectionTitle = compositeKey.slice(0, idx);
        const fieldName = compositeKey.slice(idx + sep.length);
        for (const sec of this.getCustomSections(entityType, subcategory)) {
            if (sec.title !== sectionTitle) continue;
            for (const entry of sec.fields) {
                const def = typeof entry === 'string' ? { name: entry } : entry;
                if (def && def.name === fieldName) return { section: sec, field: def };
            }
        }
        return null;
    }
}
/* eslint-enable @typescript-eslint/no-unnecessary-type-assertion -- end of file-wide suppression block opened at line 1 */
