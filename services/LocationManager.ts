/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { App, TFile, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { coerceString } from '../utils/narrow';
import {
    StoryWorld, StoryLocation, WorldOrLocation,
    WORLD_FIELD_KEYS, LOCATION_FIELD_KEYS,
    WORLD_CATEGORIES, LOCATION_CATEGORIES,
} from '../models/Location';
import { hydrateCustomFromTopLevel, mirrorCustomToTopLevel } from './customTopLevelMirror';
import { ENTITY_TYPE_WORLD, ENTITY_TYPE_LOCATION } from '../models/EntityTemplate';
import { MirroredSection, buildMirroredBody, parseMirroredBody, ParsedMirrorSection } from './CodexManager';

/**
 * Manages world & location .md files — loading, saving, creating, deleting.
 *
 * Both types live in the project's Locations/ folder.
 * Worlds are top-level .md files; locations can live at top-level or
 * inside a subfolder named after their world.
 */
export class LocationManager {
    private app: App;
    private worlds: Map<string, StoryWorld> = new Map();
    private locations: Map<string, StoryLocation> = new Map();
    private _isSaving = false;

    constructor(app: App) {
        this.app = app;
    }

    /** Whether the manager is currently writing a file (prevents modify-loop). */
    isSelfWrite(): boolean {
        return this._isSaving;
    }

    // ── Loading ────────────────────────────────────────

    /**
     * Recursively scan the Locations folder for world and location files.
     * Uses the vault adapter (filesystem) for reliable discovery of
     * externally-created or synced files.
     */
    async loadAll(folderPath: string): Promise<void> {
        this.worlds.clear();
        this.locations.clear();
        await this.scanFolderAdapter(folderPath);
    }

    /**
     * Add a single file from an external folder scan.
     * Returns true if the file was recognised as a world or location.
     */
    addFile(content: string, filePath: string): boolean {
        const fm = this.extractFrontmatter(content);
        if (!fm) return false;
        if (fm.type === 'world' || fm.type === 'location') {
            this.parseAndStoreContent(content, filePath);
            return true;
        }
        return false;
    }

    private async scanFolderAdapter(folderPath: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        if (!await adapter.exists(folderPath)) return;

        const listing = await adapter.list(folderPath);
        // Folder-based fallback (issue #74): files inside the Locations folder
        // are accepted even if `type:` is missing or has been overwritten by
        // a template. Default missing types to 'location' so the entry doesn't
        // disappear from the Codex.
        for (const f of listing.files) {
            if (f.endsWith('.md')) {
                try {
                    const filePath = normalizePath(f);
                    const content = await adapter.read(filePath);
                    this.parseAndStoreContent(content, filePath, /*folderFallback*/ true);
                } catch { /* file unreadable — skip */ }
            }
        }
        for (const sub of listing.folders) {
            await this.scanFolderAdapter(normalizePath(sub));
        }
    }

    private parseAndStoreContent(content: string, filePath: string, folderFallback = false): void {
        const fm = this.extractFrontmatter(content);
        if (!fm && !folderFallback) return;
        const safeFm = (fm ?? {}) as Partial<StoryWorld> & Partial<StoryLocation> & Record<string, unknown>;

        // Resolve effective type — explicit `type:` wins; otherwise fall back
        // to 'location' for Codex/Locations residents (issue #74).
        let effectiveType: 'world' | 'location' = 'location';
        if (safeFm.type === 'world' || safeFm.type === 'location') {
            effectiveType = safeFm.type as 'world' | 'location';
        } else if (!folderFallback) {
            return;
        }
        const fmEff = safeFm;

        const body = this.extractBody(content);

        // Parse mirrored sections from body (body wins over frontmatter)
        const { notes: plainNotes, sections } = parseMirroredBody(body);

        const basename = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath;

        if (effectiveType === 'world') {
            const world: StoryWorld = {
                filePath,
                type: 'world',
                name: fmEff.name || basename,
                image: fmEff.image,
                gallery: this.parseGallery(fmEff.gallery),
                description: fmEff.description,
                geography: fmEff.geography,
                culture: fmEff.culture,
                politics: fmEff.politics,
                magicTechnology: fmEff.magicTechnology,
                beliefs: fmEff.beliefs,
                economy: fmEff.economy,
                history: fmEff.history,
                books: this.parseStringList(fmEff.books),
                entryType: typeof fmEff.entryType === 'string' ? fmEff.entryType : undefined,
                aliases: typeof fmEff.aliases === 'string' ? fmEff.aliases : undefined,
                caseSensitive: fmEff.caseSensitive === true,
                excludeTerms: typeof fmEff.excludeTerms === 'string' ? fmEff.excludeTerms : undefined,
                custom: hydrateCustomFromTopLevel(
                    fmEff,
                    fmEff.custom && typeof fmEff.custom === 'object'
                        ? (fmEff.custom as Record<string, string>)
                        : undefined,
                    ENTITY_TYPE_WORLD,
                    typeof fmEff.templateSubcategory === 'string' ? fmEff.templateSubcategory : undefined,
                ),
                templateSubcategory: typeof fmEff.templateSubcategory === 'string' ? fmEff.templateSubcategory : undefined,
                created: fmEff.created,
                modified: fmEff.modified,
                notes: plainNotes || undefined,
            };

            // Apply mirrored body values — body is source of truth for mirrored fields
            if (sections.length > 0) {
                applySectionsToWorld(sections, world);
            }

            this.worlds.set(filePath, world);
        } else if (effectiveType === 'location') {
            const loc: StoryLocation = {
                filePath,
                type: 'location',
                name: fmEff.name || basename,
                image: fmEff.image,
                gallery: this.parseGallery(fmEff.gallery),
                locationType: fmEff.locationType,
                world: fmEff.world,
                parent: fmEff.parent,
                description: fmEff.description,
                atmosphere: fmEff.atmosphere,
                significance: fmEff.significance,
                inhabitants: fmEff.inhabitants,
                connectedLocations: fmEff.connectedLocations,
                mapNotes: fmEff.mapNotes,
                books: this.parseStringList(fmEff.books),
                entryType: typeof fmEff.entryType === 'string' ? fmEff.entryType : undefined,
                aliases: typeof fmEff.aliases === 'string' ? fmEff.aliases : undefined,
                caseSensitive: fmEff.caseSensitive === true,
                excludeTerms: typeof fmEff.excludeTerms === 'string' ? fmEff.excludeTerms : undefined,
                custom: hydrateCustomFromTopLevel(
                    fmEff,
                    fmEff.custom && typeof fmEff.custom === 'object'
                        ? (fmEff.custom as Record<string, string>)
                        : undefined,
                    ENTITY_TYPE_LOCATION,
                    typeof fmEff.templateSubcategory === 'string' ? fmEff.templateSubcategory : undefined,
                ),
                templateSubcategory: typeof fmEff.templateSubcategory === 'string' ? fmEff.templateSubcategory : undefined,
                created: fmEff.created,
                modified: fmEff.modified,
                notes: plainNotes || undefined,
            };

            // Apply mirrored body values — body is source of truth for mirrored fields
            if (sections.length > 0) {
                applySectionsToLocation(sections, loc);
            }

            this.locations.set(filePath, loc);
        }
    }

    // ── Getters ────────────────────────────────────────

    getAllWorlds(): StoryWorld[] {
        return Array.from(this.worlds.values()).sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        );
    }

    getAllLocations(): StoryLocation[] {
        return Array.from(this.locations.values()).sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        );
    }

    getWorld(filePath: string): StoryWorld | undefined {
        return this.worlds.get(filePath);
    }

    getLocation(filePath: string): StoryLocation | undefined {
        return this.locations.get(filePath);
    }

    getItem(filePath: string): WorldOrLocation | undefined {
        return this.worlds.get(filePath) ?? this.locations.get(filePath);
    }

    /** Get locations that belong to a specific world */
    getLocationsForWorld(worldName: string): StoryLocation[] {
        const lower = worldName.toLowerCase();
        return this.getAllLocations().filter(l => l.world?.toLowerCase() === lower);
    }

    /** Get child locations of a parent location */
    getChildLocations(parentName: string): StoryLocation[] {
        const lower = parentName.toLowerCase();
        return this.getAllLocations().filter(l => l.parent?.toLowerCase() === lower);
    }

    /** Get locations that do not belong to any world */
    getOrphanLocations(): StoryLocation[] {
        return this.getAllLocations().filter(l => !l.world);
    }

    /** Get top-level locations for a world (have world but no parent) */
    getTopLevelLocations(worldName: string): StoryLocation[] {
        const lower = worldName.toLowerCase();
        return this.getAllLocations().filter(
            l => l.world?.toLowerCase() === lower && !l.parent
        );
    }

    /**
     * Build a display-name map: plain location name → full ancestry label
     * (e.g. "Forest > Old House > Scary Room"). Walks the full parent chain
     * so deeply nested locations are distinguishable in dropdowns, which is
     * critical when sibling locations share a name under different parents.
     */
    getDisplayNameMap(): Map<string, string> {
        const map = new Map<string, string>();
        // Index locations by lowercase name for parent lookups.
        const byNameLower = new Map<string, StoryLocation>();
        for (const loc of this.getAllLocations()) {
            byNameLower.set(loc.name.toLowerCase(), loc);
        }

        const buildAncestry = (loc: StoryLocation): string => {
            const parts: string[] = [loc.name];
            let current = loc.parent;
            const seen = new Set<string>([loc.name.toLowerCase()]);
            let guard = 0;
            while (current && guard < 32) {
                guard++;
                const parentLower = current.toLowerCase();
                if (seen.has(parentLower)) break; // cycle guard
                seen.add(parentLower);
                parts.unshift(current);
                const parentLoc = byNameLower.get(parentLower);
                if (!parentLoc) break;
                current = parentLoc.parent;
            }
            return parts.join(' > ');
        };

        for (const loc of this.getAllLocations()) {
            if (loc.parent) {
                map.set(loc.name, buildAncestry(loc));
            } else {
                map.set(loc.name, loc.name);
            }
        }
        return map;
    }

    // ── Create ─────────────────────────────────────────

    async createWorld(folderPath: string, name: string): Promise<StoryWorld> {
        await this.ensureFolder(folderPath);
        const safeName = name.replace(/[\\/:*?"<>|]/g, '-');
        const filePath = normalizePath(`${folderPath}/${safeName}.md`);

        if (this.app.vault.getAbstractFileByPath(filePath)) {
            throw new Error(`World file already exists: ${filePath}`);
        }

        const now = new Date().toISOString().split('T')[0];
        const fm: Record<string, unknown> = { type: 'world', name, created: now, modified: now };
        await this.app.vault.create(filePath, `---\n${stringifyYaml(fm)}---\n`);

        // Also create a subfolder for locations in this world
        await this.ensureFolder(normalizePath(`${folderPath}/${safeName}`));

        const world: StoryWorld = { filePath, type: 'world', name, created: now, modified: now };
        this.worlds.set(filePath, world);
        return world;
    }

    async createLocation(folderPath: string, name: string, worldName?: string, parentName?: string): Promise<StoryLocation> {
        // If the location has a world, place it inside the world's subfolder
        let targetFolder = folderPath;
        if (worldName) {
            const safeName = worldName.replace(/[\\/:*?"<>|]/g, '-');
            targetFolder = normalizePath(`${folderPath}/${safeName}`);
        }
        await this.ensureFolder(targetFolder);

        const safeLocName = name.replace(/[\\/:*?"<>|]/g, '-');
        const filePath = normalizePath(`${targetFolder}/${safeLocName}.md`);

        if (this.app.vault.getAbstractFileByPath(filePath)) {
            throw new Error(`Location file already exists: ${filePath}`);
        }

        const now = new Date().toISOString().split('T')[0];
        const fm: Record<string, unknown> = { type: 'location', name, created: now, modified: now };
        if (worldName) fm.world = worldName;
        if (parentName) fm.parent = parentName;
        await this.app.vault.create(filePath, `---\n${stringifyYaml(fm)}---\n`);

        const loc: StoryLocation = { filePath, type: 'location', name, world: worldName, parent: parentName, created: now, modified: now };
        this.locations.set(filePath, loc);
        return loc;
    }

    // ── Save ───────────────────────────────────────────

    async saveWorld(world: StoryWorld, mirrored?: MirroredSection[]): Promise<void> {
        const normalizedFilePath = normalizePath(world.filePath);
        await this.saveItem({ ...world, filePath: normalizedFilePath }, WORLD_FIELD_KEYS as string[], mirrored);
        this.worlds.set(normalizedFilePath, { ...world, filePath: normalizedFilePath });
    }

    async saveLocation(location: StoryLocation, mirrored?: MirroredSection[]): Promise<void> {
        const normalizedFilePath = normalizePath(location.filePath);
        await this.saveItem({ ...location, filePath: normalizedFilePath }, LOCATION_FIELD_KEYS as string[], mirrored);
        this.locations.set(normalizedFilePath, { ...location, filePath: normalizedFilePath });
    }

    private async saveItem(item: WorldOrLocation, fieldKeys: string[], mirrored?: MirroredSection[]): Promise<void> {
        const normalizedFilePath = normalizePath(item.filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedFilePath);
        if (!(file instanceof TFile)) {
            throw new Error(`File not found: ${normalizedFilePath}`);
        }

        const content = await this.app.vault.read(file);
        const existingFm = this.extractFrontmatter(content) || {};
        const body = this.extractBody(content);

        const fm: Record<string, unknown> = { ...existingFm };
        fm.type = item.type;
        fm.name = item.name;
        fm.modified = new Date().toISOString().split('T')[0];
        if (item.created) fm.created = item.created;

        // Drop the legacy `nickname` field on save — replaced by `aliases`
        // (Issue #228). Existing frontmatter is migrated away on next save.
        delete fm['nickname'];

        for (const key of fieldKeys) {
            if (key === 'name') continue;
            const val = (item as unknown as Record<string, unknown>)[key];
            if (val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0)) {
                fm[key] = val;
            } else {
                delete fm[key];
            }
        }

        if (item.custom && Object.keys(item.custom).length > 0) {
            fm.custom = item.custom;
        } else {
            delete fm.custom;
        }

        // Issue #71 — mirror custom-field values to top-level YAML keys
        mirrorCustomToTopLevel(
            fm,
            item.custom,
            item.type === 'world' ? ENTITY_TYPE_WORLD : ENTITY_TYPE_LOCATION,
            item.templateSubcategory,
        );

        // Build body: strip old mirrored sections, then rebuild with notes + current mirrored fields
        const { notes: existingNotes } = parseMirroredBody(body);
        const notesContent = item.notes ?? (existingNotes || '');
        const finalBody = buildMirroredBody(notesContent, mirrored ?? []);

        const newContent = `---\n${stringifyYaml(fm)}---\n${finalBody ? '\n' + finalBody : ''}`;
        this._isSaving = true;
        try {
            await this.app.vault.modify(file, newContent);
        } finally {
            this._isSaving = false;
        }
    }

    // ── Delete ─────────────────────────────────────────

    async deleteItem(filePath: string): Promise<void> {
        const normalizedFilePath = normalizePath(filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedFilePath);
        if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file);
        }
        this.worlds.delete(normalizedFilePath);
        this.locations.delete(normalizedFilePath);
    }
    // ── Move ───────────────────────────────

    /**
     * Move a world or location file to a different folder. Used by the
     * Promote / Demote actions to shuttle entries between the per-project
     * Codex/Locations folder and the series-level shared folder.
     *
     * Wikilinks in scenes / characters reference locations by NAME (not
     * file path), so no link cascade is needed — only the file location
     * changes.
     */
    async moveItem(item: WorldOrLocation, targetFolderPath: string): Promise<WorldOrLocation> {
        const oldPath = normalizePath(item.filePath);
        await this.ensureFolder(targetFolderPath);
        const basename = oldPath.split('/').pop() ?? `${item.name}.md`;
        const newPath = normalizePath(`${targetFolderPath}/${basename}`);
        if (newPath === oldPath) return item;

        if (this.app.vault.getAbstractFileByPath(newPath)) {
            throw new Error(`A file already exists at: ${newPath}`);
        }

        const file = this.app.vault.getAbstractFileByPath(oldPath);
        if (file instanceof TFile) {
            await this.app.fileManager.renameFile(file, newPath);
        }

        this.worlds.delete(oldPath);
        this.locations.delete(oldPath);
        const updated = { ...item, filePath: newPath } as WorldOrLocation;
        if (updated.type === 'world') this.worlds.set(newPath, updated);
        else this.locations.set(newPath, updated);
        return updated;
    }
    // ── Helpers ────────────────────────────────────────

    private extractFrontmatter(content: string): Record<string, unknown> | null {
        // Strip BOM + invisible zero-width characters before matching
        const clean = content.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
        const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match) return null;
        try {
            return parseYaml(match[1]);
        } catch { return null; }
    }

    private extractBody(content: string): string {
        const clean = content.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
        const match = clean.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        return match ? match[1].trim() : '';
    }

    private parseGallery(value: unknown): Array<{ path: string; caption: string }> | undefined {
        if (!Array.isArray(value)) return undefined;
        const parsed: Array<{ path: string; caption: string }> = [];
        for (const item of value) {
            if (!item || typeof item !== 'object') continue;
            const path = typeof item.path === 'string' ? item.path : '';
            const caption = typeof item.caption === 'string' ? item.caption : '';
            if (!path) continue;
            parsed.push({ path, caption });
        }
        return parsed.length ? parsed : undefined;
    }

    private parseStringList(value: unknown): string[] | undefined {
        if (Array.isArray(value)) {
            const parsed = value.map(v => coerceString(v).trim()).filter(Boolean);
            return parsed.length ? parsed : undefined;
        }
        if (value == null || value === '') return undefined;
        const str = coerceString(value);
        if (!str) return undefined;
        const parsed = str.split(',').map(s => s.trim()).filter(Boolean);
        return parsed.length ? parsed : undefined;
    }

    private async ensureFolder(folderPath: string): Promise<void> {
        // Issue #227 — use the vault adapter (filesystem) as the source of
        // truth rather than getAbstractFileByPath(), whose in-memory cache
        // can lag behind the filesystem (especially on Linux). When the
        // cache misses, createFolder() throws "Folder already exists".
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(folderPath)) return;
        try {
            await this.app.vault.createFolder(folderPath);
        } catch (e) {
            if (await adapter.exists(folderPath)) return;
            throw e;
        }
    }
}


function applySectionsToWorld(
    sections: ParsedMirrorSection[],
    world: StoryWorld,
): void {
    for (const sec of sections) {
        const key = resolveLocationMirrorKey(sec.sectionTitle, sec.fieldLabel, WORLD_CATEGORIES);
        if (!key) continue;
        applyMirrorValue(world, key, sec.value);
    }
}

function applySectionsToLocation(
    sections: ParsedMirrorSection[],
    loc: StoryLocation,
): void {
    for (const sec of sections) {
        const key = resolveLocationMirrorKey(sec.sectionTitle, sec.fieldLabel, LOCATION_CATEGORIES);
        if (!key) continue;
        applyMirrorValue(loc, key, sec.value);
    }
}

function resolveLocationMirrorKey(
    sectionTitle: string,
    fieldLabel: string,
    categories: ReadonlyArray<{ title: string; fields: ReadonlyArray<{ key: string; label: string }> }>,
): string | null {
    for (const cat of categories) {
        if (cat.title !== sectionTitle) continue;
        const field = cat.fields.find(f => f.label === fieldLabel);
        if (field) return field.key;
    }

    return `${sectionTitle} :: ${fieldLabel}`;
}

function applyMirrorValue<T extends { custom?: Record<string, string> }>(
    obj: T,
    key: string,
    value: string,
): void {
    if (key.includes(' :: ')) {
        if (!obj.custom) obj.custom = {};
        obj.custom[key] = value;
    } else {
        (obj as unknown as Record<string, unknown>)[key] = value;
    }
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion -- end of file-wide suppression block opened at line 1 */
