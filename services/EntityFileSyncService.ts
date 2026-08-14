/**
 * EntityFileSyncService — silent body → frontmatter reconciler.
 *
 * When the user edits the body of an entity note (character, location, world,
 * codex entry) directly in Obsidian's editor, the body's mirrored custom-field
 * sections (every custom field of type Text or Text block, per the unified
 * mirroring rule of Issue #228 phase 2) become the source of truth. This
 * service watches `vault.on('modify')` for entity files and, after a short
 * debounce, rewrites the frontmatter so the YAML stays in sync with the body.
 *
 * Loop protection:
 *   - The character / location / codex managers each expose `isSelfWrite()`
 *     during their own `vault.modify` calls. We bail out while any of them
 *     is mid-write.
 *   - We also track the file paths we ourselves are about to save in
 *     `selfPaths` and skip those for a short grace window.
 *   - Before saving we diff the body's mirrored values against the
 *     frontmatter; only diverging files are rewritten, so the second pass
 *     triggered by our own save sees nothing to do and terminates the loop.
 */
import { App, TAbstractFile, TFile } from 'obsidian';
import { MirroredSection, parseMirroredBody } from './CodexManager';
import { MetadataParser } from './MetadataParser';
import {
    ENTITY_TYPE_CHARACTER,
    ENTITY_TYPE_LOCATION,
    ENTITY_TYPE_WORLD,
    entityTypeForCodex,
} from '../models/EntityTemplate';

/** Manager surfaces the service needs. Defined here to avoid a circular
 *  runtime import of main.ts — the plugin implements this duck-typed. */
export interface EntityFileSyncHost {
    app: App;
    /** True when the path is a per-project System/ JSON file (skip reconcile). */
    isSystemFile(filePath: string): boolean;
    /** Reload every entity manager from disk so in-memory state matches the
     *  freshly-written body (body wins). After this returns, the individual
     *  managers expose the up-to-date entities via getCharacter/getWorld/
     *  getLocation/getEntry. */
    loadActiveProjectEntities(): Promise<void>;
    /** Resolved entity folder getters (return undefined when no project active). */
    characterManager: EntityFileSyncManagers['characterManager'];
    locationManager: EntityFileSyncManagers['locationManager'];
    codexManager: EntityFileSyncManagers['codexManager'];
    sceneManager: EntityFileSyncManagers['sceneManager'];
    entityTemplates: EntityFileSyncManagers['entityTemplates'];
}

interface EntityFileSyncManagers {
    characterManager: {
        isSelfWrite(): boolean;
        getCharacter(filePath: string): { templateSubcategory?: string; custom?: Record<string, string>; filePath: string } | undefined;
        saveCharacter(character: unknown, mirrored?: MirroredSection[]): Promise<void>;
    };
    locationManager: {
        isSelfWrite(): boolean;
        getWorld(filePath: string): { templateSubcategory?: string; custom?: Record<string, string>; filePath: string } | undefined;
        getLocation(filePath: string): { templateSubcategory?: string; custom?: Record<string, string>; filePath: string } | undefined;
        saveWorld(world: unknown, mirrored?: MirroredSection[]): Promise<void>;
        saveLocation(loc: unknown, mirrored?: MirroredSection[]): Promise<void>;
    };
    codexManager: {
        isSelfWrite(): boolean;
        getEntry(filePath: string): { type: string; templateSubcategory?: string; custom?: Record<string, string>; filePath: string } | undefined;
        saveEntry(entry: unknown, mirrored?: MirroredSection[]): Promise<void>;
    };
    sceneManager: {
        getCharacterFolder(): string | undefined;
        getLocationFolder(): string | undefined;
        getCodexFolder(): string | undefined;
    };
    entityTemplates: {
        getMirroredFieldKeys(entityType: string, subcategory?: string): string[];
        findFieldByCompositeKey(
            entityType: string,
            compositeKey: string,
            subcategory?: string,
        ): { section: { title: string }; field: { name: string } } | null;
        buildAutoMirroredSections(
            entityType: string,
            subcategory: string | undefined,
            custom: Record<string, string> | undefined,
        ): MirroredSection[];
    };
}

type EntityKind = 'character' | 'locationOrWorld' | 'codex';

const RECONCILE_DEBOUNCE_MS = 800;
const SELF_PATH_GRACE_MS = 1500;

export class EntityFileSyncService {
    private app: App;
    private plugin: EntityFileSyncHost;
    /** Per-path debounce timers for the reconcile pass. */
    private timers = new Map<string, number>();
    /** Paths we are currently saving — modify events for these are skipped. */
    private selfPaths = new Set<string>();

    constructor(app: App, plugin: EntityFileSyncHost) {
        this.app = app;
        this.plugin = plugin;
    }

    /** Register the vault modify listener. Call once from plugin onload. */
    attach(): void {
        if (typeof (this.plugin as unknown as { registerEvent?: (e: unknown) => void }).registerEvent === 'function') {
            (this.plugin as unknown as { registerEvent: (e: unknown) => void }).registerEvent(
                this.app.vault.on('modify', (file: TAbstractFile) => this.onModify(file)),
            );
        } else {
            // Fallback for unit-test hosts: attach via the vault directly.
            this.app.vault.on('modify', (file: TAbstractFile) => this.onModify(file));
        }
    }

    // ── Event handling ────────────────────────────────

    private onModify(file: TAbstractFile): void {
        if (!(file instanceof TFile)) return;
        if (file.extension !== 'md') return;
        const path = file.path;

        if (this.selfPaths.has(path)) return;
        try {
            if (this.plugin.isSystemFile(path)) return;
        } catch { /* project not set yet */ }

        // Loop-guard: skip while a manager is mid self-write (its own save
        // triggered this modify event).
        if (this.plugin.characterManager.isSelfWrite()) return;
        if (this.plugin.locationManager.isSelfWrite()) return;
        if (this.plugin.codexManager.isSelfWrite()) return;

        const kind = this.classify(path);
        if (!kind) return;

        const existing = this.timers.get(path);
        if (existing) window.clearTimeout(existing);
        const t = window.setTimeout(() => {
            this.timers.delete(path);
            void this.reconcile(path, kind);
        }, RECONCILE_DEBOUNCE_MS);
        this.timers.set(path, t);
    }

    /** Resolve which entity kind a file path belongs to (or null). */
    private classify(path: string): EntityKind | null {
        const sm = this.plugin.sceneManager;
        let charFolder: string | undefined;
        let locFolder: string | undefined;
        let codexFolder: string | undefined;
        try { charFolder = sm.getCharacterFolder(); } catch { /* ignore */ }
        try { locFolder = sm.getLocationFolder(); } catch { /* ignore */ }
        try { codexFolder = sm.getCodexFolder(); } catch { /* ignore */ }
        // Codex first — codex folder is the most specific.
        if (codexFolder && path.startsWith(codexFolder + '/')) return 'codex';
        if (charFolder && path.startsWith(charFolder + '/')) return 'character';
        if (locFolder && path.startsWith(locFolder + '/')) return 'locationOrWorld';
        return null;
    }

    // ── Reconcile ────────────────────────────────────

    private async reconcile(path: string, kind: EntityKind): Promise<void> {
        try {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) return;
            const content = await this.app.vault.read(file);

            const fm = MetadataParser.extractFrontmatter(content);
            if (!fm) return;
            const body = this.extractBody(content);
            const { sections } = parseMirroredBody(body);
            if (sections.length === 0) return; // no mirrored sections to reconcile

            const entityType = this.entityTypeFor(kind, fm);
            if (!entityType) return;
            const subcategory = typeof fm.templateSubcategory === 'string' ? fm.templateSubcategory : undefined;

            // Composite keys for every custom Text / Text-block field on this
            // entity type. Bodies may contain other H1/H2 sections (e.g. notes)
            // — we only reconcile keys the template actually defines.
            const mirrorKeys = this.plugin.entityTemplates.getMirroredFieldKeys(entityType, subcategory);
            if (mirrorKeys.length === 0) return;

            const byTitle = new Map<string, string>();
            for (const key of mirrorKeys) {
                const found = this.plugin.entityTemplates.findFieldByCompositeKey(entityType, key, subcategory);
                if (found) byTitle.set(`${found.section.title}::${found.field.name}`, key);
            }

            const fmCustomRaw = fm.custom;
            const fmCustom = (fmCustomRaw && typeof fmCustomRaw === 'object')
                ? (fmCustomRaw as Record<string, string>)
                : {};

            // Detect any divergence between the body's mirrored values and FM.
            let changed = false;
            for (const sec of sections) {
                const compositeKey = byTitle.get(`${sec.sectionTitle}::${sec.fieldLabel}`);
                if (!compositeKey) continue; // not a known mirrored field
                const fmValue = fmCustom[compositeKey];
                if (fmValue !== sec.value) {
                    changed = true;
                    break;
                }
            }
            if (!changed) return;

            // Reconcile: reload managers so in-memory entity reflects body-wins,
            // then save back via the appropriate manager. The save rewrites FM
            // from the in-memory entity (which carries body values) and
            // regenerates the body from the same custom fields — net effect:
            // FM becomes consistent with body, body stays identical.
            this.selfPaths.add(path);
            try {
                await this.plugin.loadActiveProjectEntities();
                await this.resaveEntity(path, kind, entityType);
            } finally {
                // Hold the self-path flag briefly so the modify event from
                // our save is observed and skipped.
                window.setTimeout(() => this.selfPaths.delete(path), SELF_PATH_GRACE_MS);
            }
        } catch (e) {
            console.error('[StoryLine] EntityFileSyncService.reconcile:', e);
        }
    }

    private async resaveEntity(path: string, kind: EntityKind, entityType: string): Promise<void> {
        const et = this.plugin.entityTemplates;
        if (kind === 'character') {
            const entity = this.plugin.characterManager.getCharacter(path);
            if (!entity) return;
            const mirrored = et.buildAutoMirroredSections(entityType, entity.templateSubcategory, entity.custom);
            await this.plugin.characterManager.saveCharacter(entity, mirrored);
            return;
        }
        if (kind === 'locationOrWorld') {
            const world = this.plugin.locationManager.getWorld(path);
            if (world) {
                const mirrored = et.buildAutoMirroredSections(entityType, world.templateSubcategory, world.custom);
                await this.plugin.locationManager.saveWorld(world, mirrored);
                return;
            }
            const loc = this.plugin.locationManager.getLocation(path);
            if (loc) {
                const mirrored = et.buildAutoMirroredSections(entityType, loc.templateSubcategory, loc.custom);
                await this.plugin.locationManager.saveLocation(loc, mirrored);
            }
            return;
        }
        // codex
        const entry = this.plugin.codexManager.getEntry(path);
        if (!entry) return;
        const mirrored = et.buildAutoMirroredSections(entityType, entry.templateSubcategory, entry.custom);
        await this.plugin.codexManager.saveEntry(entry, mirrored);
    }

    private entityTypeFor(kind: EntityKind, fm: Record<string, unknown>): string | null {
        if (kind === 'character') return ENTITY_TYPE_CHARACTER;
        if (kind === 'codex') {
            const t = typeof fm.type === 'string' ? fm.type : '';
            return t ? entityTypeForCodex(t) : null;
        }
        // locationOrWorld — resolve by frontmatter discriminator.
        if (fm.type === 'world') return ENTITY_TYPE_WORLD;
        if (fm.type === 'location') return ENTITY_TYPE_LOCATION;
        return null;
    }

    /** Body extraction mirroring the managers' private helpers (BOM-strip +
     *  frontmatter split). Defers to MetadataParser when available. */
    private extractBody(content: string): string {
        const clean = content.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
        const match = clean.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        return match ? match[1].trim() : clean.trim();
    }
}