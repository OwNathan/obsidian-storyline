/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { hydrateCustomFromTopLevel, mirrorCustomToTopLevel } from './customTopLevelMirror';
import { entityTypeForCodex } from '../models/EntityTemplate';
import { App, TFile, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { CODEX_DEFAULT_FIELD_KEYS, CodexCategoryDef, CodexEntry, getBuiltinCodexCategory } from '../models/Codex';
import { DEFAULT_CODEX_CATEGORIES } from '../models/defaults/codex';

/**
 * Manages generic Codex entries — loading, saving, creating, and deleting
 * .md files for any Codex category (Items, Creatures, Lore, Organizations,
 * Culture, Systems, and user-defined custom categories).
 *
 * Characters and Locations retain their specialised managers;
 * CodexManager handles everything else inside the project's Codex/ folder.
 */
/** Info needed to write a single mirrored field section into the md body. */
export interface MirroredSection {
    sectionTitle: string;
    fieldKey: string;
    fieldLabel: string;
    value: string;
}

/** A parsed mirrored section extracted from the markdown body (no markers — H1/H2 only). */
export interface ParsedMirrorSection {
    sectionTitle: string;
    fieldLabel: string;
    value: string;
}

/** Single separator between notes and mirrored H1/H2 sections. */
export const MIRROR_SEPARATOR = '<!-- sl-mirror -->';

export class CodexManager {
    private app: App;

    /**  category-id → Map<filePath, CodexEntry> */
    private entriesByCategory: Map<string, Map<string, CodexEntry>> = new Map();

    /** Resolved category definitions (built-in + custom) */
    private categoryDefs: Map<string, CodexCategoryDef> = new Map();

    /** Guard flag set during plugin-initiated saves to prevent feedback loops */
    private _isSaving = false;

    constructor(app: App) {
        this.app = app;
    }

    /** Whether the manager is currently writing a file (prevents modify-loop). */
    isSelfWrite(): boolean {
        return this._isSaving;
    }

    // ── Category management ────────────────────────────

    /**
     * Initialise category definitions from enabled ids and any custom defs.
     * Called once on project load / settings change.
     *
     * @param enabledIds   e.g. ['items', 'creatures', 'my-custom']
     * @param customDefs   User-created category definitions (from settings)
     */
    initCategories(
        enabledIds: string[],
        customDefs: CodexCategoryDef[] = [],
    ): void {
        this.categoryDefs.clear();
        for (const id of enabledIds) {
            const builtin = getBuiltinCodexCategory(id);
            if (builtin) {
                // Entity-template system: every category (built-in or custom)
                // exposes the same locked default catalog (Overview: name/kind,
                // Linking & Matching: entryType/aliases/caseSensitive/excludeTerms)
                // plus the unified field-key list that drives serialization.
                this.categoryDefs.set(id, this.withUnifiedDefaults(builtin));
            } else {
                const custom = customDefs.find(c => c.id === id);
                if (custom) this.categoryDefs.set(id, this.withUnifiedDefaults(custom));
            }
        }
    }

    /**
     * Replace a category's per-type field catalog with the unified
     * entity-template defaults. Folder/label/icon/tab metadata is kept.
     */
    private withUnifiedDefaults(cat: CodexCategoryDef): CodexCategoryDef {
        return {
            ...cat,
            categories: DEFAULT_CODEX_CATEGORIES,
            fieldKeys: [...CODEX_DEFAULT_FIELD_KEYS],
        };
    }

    /** All resolved category definitions (respects current enabled list). */
    getCategories(): CodexCategoryDef[] {
        return Array.from(this.categoryDefs.values());
    }

    /** Lookup a single category definition. */
    getCategoryDef(id: string): CodexCategoryDef | undefined {
        return this.categoryDefs.get(id);
    }

    // ── Load ───────────────────────────────────────────

    /**
     * Load all entries for every enabled category from the Codex folder.
     * Expects structure:  `codexFolder/<CategoryFolder>/entry.md`
     */
    async loadAll(codexFolder: string): Promise<void> {
        this.entriesByCategory.clear();
        const adapter = this.app.vault.adapter;

        // Auto-create the Codex folder for existing projects that don't have one yet
        if (!await adapter.exists(codexFolder)) {
            await this.ensureFolder(codexFolder);
        }

        for (const [catId, catDef] of this.categoryDefs) {
            const catMap = new Map<string, CodexEntry>();
            const catFolder = normalizePath(`${codexFolder}/${catDef.folder}`);
            if (await adapter.exists(catFolder)) {
                await this.scanFolder(catFolder, catDef, catMap);
            }
            this.entriesByCategory.set(catId, catMap);
        }
    }

    /**
     * Load entries for a single category.
     */
    async loadCategory(codexFolder: string, categoryId: string): Promise<void> {
        const catDef = this.categoryDefs.get(categoryId);
        if (!catDef) return;

        const catMap = new Map<string, CodexEntry>();
        const catFolder = normalizePath(`${codexFolder}/${catDef.folder}`);
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(catFolder)) {
            await this.scanFolder(catFolder, catDef, catMap);
        }
        this.entriesByCategory.set(categoryId, catMap);
    }

    private async scanFolder(
        folderPath: string,
        catDef: CodexCategoryDef,
        catMap: Map<string, CodexEntry>,
    ): Promise<void> {
        const adapter = this.app.vault.adapter;
        const listing = await adapter.list(folderPath);
        for (const f of listing.files) {
            if (f.endsWith('.md')) {
                try {
                    const fp = normalizePath(f);
                    const content = await adapter.read(fp);
                    // Folder-based fallback: if the file lives under the category
                    // folder, accept it even if `type:` is missing/wrong (issue #74).
                    const entry = this.parseEntry(content, fp, catDef, /*folderFallback*/ true);
                    if (entry) catMap.set(fp, entry);
                } catch { /* skip unreadable */ }
            }
        }
        // Recurse into subfolders (for nested entries)
        for (const sub of listing.folders) {
            await this.scanFolder(normalizePath(sub), catDef, catMap);
        }
    }

    // ── External file ingestion ────────────────────────

    /**
     * Try to add a single file from an external folder scan.
     * Tests against all enabled codex categories.
     * Returns true if the file matched any category.
     */
    addFile(content: string, filePath: string): boolean {
        for (const [catId, catDef] of this.categoryDefs) {
            const entry = this.parseEntry(content, filePath, catDef);
            if (entry) {
                let catMap = this.entriesByCategory.get(catId);
                if (!catMap) {
                    catMap = new Map();
                    this.entriesByCategory.set(catId, catMap);
                }
                if (!catMap.has(filePath)) {
                    catMap.set(filePath, entry);
                    return true;
                }
            }
        }
        return false;
    }

    // ── Query ──────────────────────────────────────────

    /** All entries for a category, sorted by name. */
    getEntries(categoryId: string): CodexEntry[] {
        const catMap = this.entriesByCategory.get(categoryId);
        if (!catMap) return [];
        return Array.from(catMap.values()).sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );
    }

    /** Get a single entry by file path. */
    getEntry(filePath: string): CodexEntry | undefined {
        for (const catMap of this.entriesByCategory.values()) {
            const entry = catMap.get(filePath);
            if (entry) return entry;
        }
        return undefined;
    }

    /** Find entry by name within a category (case-insensitive). */
    findByName(categoryId: string, name: string): CodexEntry | undefined {
        const lower = name.toLowerCase();
        const entries = this.getEntries(categoryId);
        return entries.find(e => e.name.toLowerCase() === lower);
    }

    /** All entries across every category. */
    getAllEntries(): CodexEntry[] {
        const all: CodexEntry[] = [];
        for (const catMap of this.entriesByCategory.values()) {
            for (const entry of catMap.values()) all.push(entry);
        }
        return all.sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );
    }

    /** Total entry count across all categories. */
    get totalCount(): number {
        let count = 0;
        for (const catMap of this.entriesByCategory.values()) count += catMap.size;
        return count;
    }

    // ── Create ─────────────────────────────────────────

    /**
     * Create a new entry .md file.
     */
    async createEntry(
        codexFolder: string,
        categoryId: string,
        name: string,
    ): Promise<CodexEntry> {
        const catDef = this.categoryDefs.get(categoryId);
        if (!catDef) throw new Error(`Unknown codex category: ${categoryId}`);

        const catFolder = normalizePath(`${codexFolder}/${catDef.folder}`);
        await this.ensureFolder(catFolder);

        const safeName = name.replace(/[\\/:*?"<>|]/g, '-');
        const filePath = normalizePath(`${catFolder}/${safeName}.md`);

        if (this.app.vault.getAbstractFileByPath(filePath)) {
            throw new Error(`Entry already exists: ${filePath}`);
        }

        const now = new Date().toISOString().split('T')[0];
        const fm: Record<string, unknown> = {
            type: catDef.id,
            name,
            created: now,
            modified: now,
        };

        await this.app.vault.create(filePath, `---\n${stringifyYaml(fm)}---\n`);

        const entry: CodexEntry = { filePath, type: catDef.id, name, created: now, modified: now };
        let catMap = this.entriesByCategory.get(categoryId);
        if (!catMap) {
            catMap = new Map();
            this.entriesByCategory.set(categoryId, catMap);
        }
        catMap.set(filePath, entry);
        return entry;
    }

    // ── Save ───────────────────────────────────────────

    /**
     * Save an entry back to its .md file.
     *
     * @param mirrored  Optional list of fields whose content should be
     *                  mirrored to the file body as H1/H2 sections.
     */
    async saveEntry(entry: CodexEntry, mirrored?: MirroredSection[]): Promise<void> {
        const normalizedPath = normalizePath(entry.filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!(file instanceof TFile)) {
            throw new Error(`Codex entry file not found: ${normalizedPath}`);
        }

        const catDef = this.categoryDefs.get(entry.type);
        const fieldKeys = catDef?.fieldKeys ?? [];

        const content = await this.app.vault.read(file);
        const existingFm = this.extractFrontmatter(content) || {};

        const fm: Record<string, unknown> = { ...existingFm };
        fm.type = entry.type;
        fm.name = entry.name;
        fm.modified = new Date().toISOString().split('T')[0];
        if (entry.created) fm.created = entry.created;

        // Standard fields for this category
        for (const key of fieldKeys) {
            if (key === 'name') continue;
            const val = entry[key];
            if (val !== undefined && val !== null && val !== '' &&
                !(Array.isArray(val) && val.length === 0)) {
                fm[key] = val;
            } else {
                delete fm[key];
            }
        }

        // Series-ready: books list
        if (entry.books && entry.books.length > 0) {
            fm.books = entry.books;
        } else {
            delete fm.books;
        }

        // Custom fields
        if (entry.custom && Object.keys(entry.custom).length > 0) {
            fm.custom = entry.custom;
        } else {
            delete fm.custom;
        }

        // Issue #71 — mirror custom-field values to top-level YAML keys
        mirrorCustomToTopLevel(fm, entry.custom, entityTypeForCodex(entry.type), entry.templateSubcategory);

        // Build body: strip old mirrored sections, then rebuild with current mirrored fields
        const finalBody = buildMirroredBody('', mirrored ?? []);

        const newContent = `---\n${stringifyYaml(fm)}---\n${finalBody ? '\n' + finalBody : ''}`;

        // Guard against self-triggered vault modify event
        this._isSaving = true;
        try {
            await this.app.vault.modify(file, newContent);
        } finally {
            this._isSaving = false;
        }

        // Update in-memory cache
        for (const catMap of this.entriesByCategory.values()) {
            if (catMap.has(normalizedPath)) {
                catMap.set(normalizedPath, { ...entry, filePath: normalizedPath });
                break;
            }
        }
    }

    // ── Delete ─────────────────────────────────────────

    async deleteEntry(filePath: string): Promise<void> {
        const normalizedPath = normalizePath(filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file);
        }
        for (const catMap of this.entriesByCategory.values()) {
            catMap.delete(normalizedPath);
        }
    }

    // ── Rename ─────────────────────────────────────────

    async renameEntry(
        entry: CodexEntry,
        newName: string,
        codexFolder: string,
    ): Promise<CodexEntry> {
        const catDef = this.categoryDefs.get(entry.type);
        if (!catDef) throw new Error(`Unknown category: ${entry.type}`);

        const catFolder = normalizePath(`${codexFolder}/${catDef.folder}`);
        const safeName = newName.replace(/[\\/:*?"<>|]/g, '-');
        const newPath = normalizePath(`${catFolder}/${safeName}.md`);
        const oldPath = normalizePath(entry.filePath);

        const file = this.app.vault.getAbstractFileByPath(oldPath);
        if (file instanceof TFile && newPath !== oldPath) {
            await this.app.fileManager.renameFile(file, newPath);
        }

        // Update cache
        for (const catMap of this.entriesByCategory.values()) {
            if (catMap.has(oldPath)) {
                catMap.delete(oldPath);
                break;
            }
        }

        const updated: CodexEntry = { ...entry, filePath: newPath, name: newName };
        let catMap = this.entriesByCategory.get(entry.type);
        if (!catMap) {
            catMap = new Map();
            this.entriesByCategory.set(entry.type, catMap);
        }
        catMap.set(newPath, updated);
        await this.saveEntry(updated);
        return updated;
    }

    // ── Body mirroring utilities ───────────────────────

    // ── Parsing helpers (continued) ────────────────────

    private parseEntry(
        content: string,
        filePath: string,
        catDef: CodexCategoryDef,
        folderFallback = false,
    ): CodexEntry | null {
        const fm = this.extractFrontmatter(content);
        // If frontmatter is missing entirely, only accept when folder-based
        // fallback applies (file lives inside the category folder — issue #74).
        const safeFm = (fm ?? {}) as Partial<CodexEntry> & Record<string, unknown>;
        if (!fm && !folderFallback) return null;

        // Accept entries whose type matches the category id.
        // Folder-based fallback (issue #74): when the file already lives in
        // the category folder (e.g. user inserted a template that wiped
        // `type:`), still recognise it so it doesn't vanish from the Codex.
        if (safeFm.type !== catDef.id && !folderFallback) return null;

        const body = this.extractBody(content);

        // Parse mirrored sections from body (body wins over frontmatter)
        const { sections } = parseMirroredBody(body);

        const basename = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath;

        const entry: CodexEntry = {
            filePath,
            type: catDef.id,
            name: String(safeFm.name || basename),
            image: safeFm.image,
            gallery: this.parseGallery(safeFm.gallery),
            created: safeFm.created,
            modified: safeFm.modified,
            custom: hydrateCustomFromTopLevel(
                safeFm,
                safeFm.custom && typeof safeFm.custom === 'object' ? safeFm.custom as Record<string, string> : undefined,
                entityTypeForCodex(catDef.id),
                typeof safeFm.templateSubcategory === 'string' ? safeFm.templateSubcategory : undefined,
            ),
            templateSubcategory: typeof safeFm.templateSubcategory === 'string' ? safeFm.templateSubcategory : undefined,
            books: Array.isArray(safeFm.books) ? safeFm.books.map(String) : undefined,
        };

        // Load all standard field values
        for (const key of catDef.fieldKeys) {
            if (key === 'name' || key === 'image' || key === 'gallery') continue;
            if (safeFm[key] !== undefined && safeFm[key] !== null) {
                entry[key] = safeFm[key];
            }
        }

        // Apply mirrored body values — body is source of truth for mirrored fields
        if (sections.length > 0) {
            for (const sec of sections) {
                const key = this.resolveMirrorKey(sec.sectionTitle, sec.fieldLabel, catDef);
                if (!key) continue;
                if (key.includes(' :: ')) {
                    if (!entry.custom) entry.custom = {};
                    entry.custom[key] = sec.value;
                } else {
                    entry[key] = sec.value;
                }
            }
        }

        return entry;
    }

    /**
     * Resolve a sectionTitle + fieldLabel pair to a field key.
     * Checks: custom-section composite keys, built-in fields.
     */
    private resolveMirrorKey(sectionTitle: string, fieldLabel: string, catDef: CodexCategoryDef): string | null {
        // Built-in field — scan category sections
        for (const cat of catDef.categories) {
            if (cat.title !== sectionTitle) continue;
            const field = cat.fields.find(f => f.label === fieldLabel);
            if (field) return field.key;
        }

        // Fallback: custom-section composite key
        return `${sectionTitle} :: ${fieldLabel}`;
    }

    private extractFrontmatter(content: string): Record<string, unknown> | null {
        // Strip BOM + invisible zero-width characters before matching
        const clean = content.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
        const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match) return null;
        try {
            return parseYaml(match[1]);
        } catch {
            return null;
        }
    }

    private extractBody(content: string): string {
        const clean = content.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
        const match = clean.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        if (match) return match[1].trim();
        // No frontmatter delimiter — the entire file is body content.
        // Returning '' here would wipe notes when saving entries that were
        // moved into a category folder without frontmatter (issue #221).
        return clean.trim();
    }

    private parseGallery(
        value: unknown,
    ): Array<{ path: string; caption: string }> | undefined {
        if (!Array.isArray(value)) return undefined;
        const parsed: Array<{ path: string; caption: string }> = [];
        for (const item of value) {
            if (!item || typeof item !== 'object') continue;
            const p = typeof item.path === 'string' ? item.path : '';
            const c = typeof item.caption === 'string' ? item.caption : '';
            if (!p) continue;
            parsed.push({ path: p, caption: c });
        }
        return parsed.length ? parsed : undefined;
    }

    private async ensureFolder(folderPath: string): Promise<void> {
        const normalized = normalizePath(folderPath);
        if (this.app.vault.getAbstractFileByPath(normalized)) return;
        await this.app.vault.createFolder(normalized);
    }
}
/**
 * Build the markdown body by appending mirrored field sections after notes content
 * using a single separator and H1/H2 structure.
 * Format: notes\n\n<!-- sl-mirror -->\n\n# Section\n## Field\nvalue\n\n...
 */
export function buildMirroredBody(notes: string, mirrored: MirroredSection[]): string {
    let body = notes.trimEnd();
    if (mirrored.length === 0) return body;

    const sectionMap = new Map<string, string[]>();
    for (const ms of mirrored) {
        const fields = sectionMap.get(ms.sectionTitle);
        if (fields) {
            fields.push(`## ${ms.fieldLabel}\n${ms.value || ''}`);
        } else {
            sectionMap.set(ms.sectionTitle, [`## ${ms.fieldLabel}\n${ms.value || ''}`]);
        }
    }

    const sectionBlocks: string[] = [];
    for (const [sectionTitle, fields] of sectionMap) {
        sectionBlocks.push(`# ${sectionTitle}\n${fields.join('\n')}`);
    }

    const sections = sectionBlocks.join('\n\n');
    return body
        ? `${body}\n\n${MIRROR_SEPARATOR}\n\n${sections}`
        : `${MIRROR_SEPARATOR}\n\n${sections}`;
}

/**
 * Split a markdown body into notes and an array of parsed H1/H2 mirrored sections.
 * Splits on the <!-- sl-mirror --> separator. Notes = everything before it.
 * Mirrored sections = H1/H2 headings after it.
 */
export function parseMirroredBody(body: string): {
    notes: string;
    sections: ParsedMirrorSection[];
} {
    if (!body) return { notes: '', sections: [] };

    const clean = body.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');

    const sepIdx = clean.indexOf(MIRROR_SEPARATOR);
    if (sepIdx === -1) return { notes: clean.trim(), sections: [] };

    const notes = clean.substring(0, sepIdx).trim();
    const mirrorBlock = clean.substring(sepIdx + MIRROR_SEPARATOR.length);

    const sections: ParsedMirrorSection[] = [];
    let currentSection: string | null = null;
    let currentField: string | null = null;
    let currentValue = '';

    const lines = mirrorBlock.split('\n');
    for (const line of lines) {
        const h2Match = line.match(/^## (.+)/);
        const h1Match = line.match(/^# (.+)/);

        if (h2Match && currentSection) {
            if (currentField) {
                sections.push({
                    sectionTitle: currentSection,
                    fieldLabel: currentField,
                    value: currentValue.trim(),
                });
            }
            currentField = h2Match[1].trim();
            currentValue = '';
        } else if (h1Match) {
            if (currentSection && currentField) {
                sections.push({
                    sectionTitle: currentSection,
                    fieldLabel: currentField,
                    value: currentValue.trim(),
                });
            }
            currentSection = h1Match[1].trim();
            currentField = null;
            currentValue = '';
        } else if (currentField) {
            currentValue += (currentValue ? '\n' : '') + line;
        }
    }

    if (currentSection && currentField) {
        sections.push({
            sectionTitle: currentSection,
            fieldLabel: currentField,
            value: currentValue.trim(),
        });
    }

    return { notes, sections };
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion -- end of file-wide suppression block opened at line 1 */
