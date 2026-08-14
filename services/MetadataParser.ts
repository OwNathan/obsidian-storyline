/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { hydrateCustomFromTopLevel, mirrorCustomToTopLevel } from './customTopLevelMirror';
import { App, TFile, parseYaml, stringifyYaml } from 'obsidian';
import { Scene, SceneStatus } from '../models/Scene';
import { coerceString } from '../utils/narrow';
import { DEFAULT_STORYLINE_LOCALE, type StoryLineLocale } from '../utils/locale';
import { MirroredSection, buildMirroredBody, parseMirroredBody, MIRROR_SEPARATOR } from './CodexManager';
import { ENTITY_TYPE_SCENE } from '../models/EntityTemplate';
import type { EntityTemplateService } from './EntityTemplateService';

/**
 * Issue #73 — frontmatter scene fields that point at other entities (characters,
 * locations, scenarios) and should ideally be written as `[[wikilinks]]` so
 * Obsidian keeps them in sync on rename. Readers strip wikilink syntax in
 * either case, so flipping this on/off is non-destructive.
 */
const SCENE_LINK_FIELDS_ARRAY = ['characters', 'locations', 'scenarios'] as const;

/** Wrap a plain entity name in `[[Name]]`, idempotent. */
export function toWikilink(name: string | undefined | null): string | undefined {
    if (name === undefined || name === null) return undefined;
    const s = String(name).trim();
    if (!s) return undefined;
    if (/^\[\[.+\]\]$/.test(s)) return s; // already a wikilink
    return `[[${s}]]`;
}

/**
 * Module-level toggle controlling whether `MetadataParser` writes scene
 * link-fields as wikilinks. Set from main.ts when settings load.
 */
let _writeSceneFieldsAsWikilinks = true;
export function setWriteSceneFieldsAsWikilinks(on: boolean): void {
    _writeSceneFieldsAsWikilinks = !!on;
}

/**
 * Provider for the entity template service, set from main.ts (same pattern as
 * the universal-field templates provider). Used when writing scene files to
 * rebuild the body's mirrored custom-field sections from the file's own
 * frontmatter, so every scene write (updates, undo, settings) stays consistent.
 */
let _entityTemplatesProvider: () => EntityTemplateService | undefined = () => undefined;
export function setEntityTemplatesProvider(fn: () => EntityTemplateService | undefined): void {
    _entityTemplatesProvider = fn;
}

/** Resolve the active entity template service (best-effort). */
export function getEntityTemplatesProvider(): EntityTemplateService | undefined {
    try { return _entityTemplatesProvider(); } catch { return undefined; }
}

/**
 * Build the {@link MirroredSection} list for a scene from its frontmatter.
 *
 * Per the unified mirroring rule (Issue #228 phase 2), every custom field of
 * type Text or Text block is mirrored to the scene's note body automatically.
 * Values are taken from `frontmatter.custom`; empty values are skipped so
 * cleared fields drop out of the mirrored body.
 */
function buildSceneMirroredSections(frontmatter: Record<string, unknown>): MirroredSection[] {
    const et = getEntityTemplatesProvider();
    if (!et) return [];
    const custom = frontmatter.custom;
    if (!custom || typeof custom !== 'object') return [];
    const sub = typeof frontmatter.templateSubcategory === 'string' ? frontmatter.templateSubcategory : undefined;
    const keys = et.getMirroredFieldKeys(ENTITY_TYPE_SCENE, sub);
    if (keys.length === 0) return [];
    const sections: MirroredSection[] = [];
    for (const key of keys) {
        const found = et.findFieldByCompositeKey(ENTITY_TYPE_SCENE, key, sub);
        if (!found) continue;
        const value = (custom as Record<string, unknown>)[key];
        if (typeof value !== 'string' || !value) continue;
        sections.push({
            sectionTitle: found.section.title,
            fieldKey: key,
            fieldLabel: found.field.name,
            value,
        });
    }
    return sections;
}

/**
 * Issue #212 — Map from scene title to file-stem (filename without path/extension)
 * used by `wrapArray` to emit `[[stem|title]]` aliased wikilinks for setup/payoff
 * fields. Obsidian resolves the link by file stem; StoryLine reads back the alias
 * (title) via `cleanWikilink`, so both link resolution and internal matching work.
 * Set by SceneManager before writing setup/payoff updates.
 */
let _sceneTitleToStem: Map<string, string> = new Map();
export function setSceneTitleToStemMap(map: Map<string, string>): void {
    _sceneTitleToStem = map;
}

/**
 * Issue #78 — module-level toggles controlling what countWords skips:
 *  - %%…%% Obsidian comment blocks (default on)
 *  - markdown task lines like `- [ ]` / `- [x]` (default off)
 * Set from main.ts when settings load/save.
 */
let _excludeCommentsFromWordcount = true;
let _excludeChecklistFromWordcount = false;
export function setWordcountExclusions(opts: { comments?: boolean; checklists?: boolean }): void {
    if (typeof opts.comments === 'boolean') _excludeCommentsFromWordcount = opts.comments;
    if (typeof opts.checklists === 'boolean') _excludeChecklistFromWordcount = opts.checklists;
}

/**
 * Module-level active locale (BCP-47) used by `countWords`. Set from
 * `SceneManager` whenever the active project changes so word counts respect
 * the project's `language:` frontmatter (CJK, Thai, etc. tokenise differently
 * from whitespace-delimited Latin scripts).
 */
let _wordcountLocale: StoryLineLocale = DEFAULT_STORYLINE_LOCALE;
export function setWordcountLocale(locale: StoryLineLocale): void {
    _wordcountLocale = locale || DEFAULT_STORYLINE_LOCALE;
}
export function getWordcountLocale(): StoryLineLocale {
    return _wordcountLocale;
}
function wrapScalar(v: unknown): unknown {
    if (!_writeSceneFieldsAsWikilinks) return v;
    if (v === undefined || v === null || v === '') return v;
    const s = coerceString(v);
    return s ? toWikilink(s) : v;
}
function wrapArray(arr: unknown): unknown {
    if (!_writeSceneFieldsAsWikilinks) return arr;
    if (!Array.isArray(arr)) return arr;
    return arr
        .map((s: unknown) => {
            const title = coerceString(s);
            if (!title) return undefined;
            const stem = _sceneTitleToStem.get(title);
            // If the file stem differs from the title (e.g. "01-01 Opening Image" vs
            // "Opening Image"), emit `[[stem|title]]` so Obsidian's graph resolves
            // the link to the real file while `cleanWikilink` still reads the title.
            if (stem && stem !== title) return `[[${stem}|${title}]]`;
            return toWikilink(title);
        })
        .filter((s): s is string => !!s);
}

/**
 * Parses frontmatter from markdown content and extracts Scene data
 */
export class MetadataParser {

    /**
     * Parse a TFile into a Scene object
     */
    static async parseFile(app: App, file: TFile): Promise<Scene | null> {
        const content = await app.vault.read(file);
        return this.parseContent(content, file.path);
    }

    /**
     * Parse markdown content into a Scene object
     */
    static parseContent(content: string, filePath: string): Scene | null {
        const fmRaw = this.extractFrontmatter(content);
        if (!fmRaw || fmRaw.type !== 'scene') {
            return null;
        }
        const frontmatter = fmRaw as Partial<Scene> & Record<string, unknown>;
        const templateSubcategory = this.normalizeFrontmatterString(frontmatter.templateSubcategory);

        return {
            filePath,
            type: 'scene',
            title: frontmatter.title || this.titleFromPath(filePath),
            act: frontmatter.act,
            chapter: frontmatter.chapter,
            sequence: frontmatter.sequence,
            characters: this.parseCharacters(frontmatter.characters),
            locations: this.parseLocations(frontmatter),
            scenarios: this.parseStringArray(frontmatter.scenarios),
            status: this.parseStatus(frontmatter.status),
            category: this.normalizeFrontmatterString(frontmatter.category),
            tags: frontmatter.tags || [],
            ignored_detections: this.parseStringArray(frontmatter.ignored_detections),
            created: frontmatter.created,
            modified: frontmatter.modified,
            notes: frontmatter.notes,
            notesFile: this.normalizeFrontmatterString(frontmatter.notesFile ?? frontmatter.notes_file),
            corkboardNote: this.parseBooleanFlag(frontmatter.corkboardNote ?? (frontmatter.corkboard_note as boolean | undefined)),
            corkboardNoteColor: this.normalizeFrontmatterString(frontmatter.corkboardNoteColor ?? frontmatter.corkboard_note_color),
            corkboardNoteImage: this.normalizeFrontmatterString(frontmatter.corkboardNoteImage),
            corkboardNoteCaption: this.normalizeFrontmatterString(frontmatter.corkboardNoteCaption),
            plotgridOrigin: this.normalizeFrontmatterString(frontmatter.plotgridOrigin ?? frontmatter.plotgrid_origin),
            subtitle: frontmatter.subtitle,
            color: frontmatter.color,
            codexLinks: this.parseCodexLinks(frontmatter.codexLinks),
            // Issue #71 — hydrate custom-field values from top-level YAML keys
            custom: hydrateCustomFromTopLevel(
                frontmatter,
                frontmatter.custom && typeof frontmatter.custom === 'object'
                    ? (frontmatter.custom as Record<string, string>)
                    : undefined,
                ENTITY_TYPE_SCENE,
                templateSubcategory,
            ),
            templateSubcategory,
            beatsheet: frontmatter.beatsheet,
            arcAnchor: this.parseBooleanFlag(frontmatter.arcAnchor ?? (frontmatter.arc_anchor as boolean | undefined)),
        };
    }

    /**
     * Issue #182 — coerce a frontmatter value into a trimmed string or undefined.
     * Obsidian's YAML parser can produce `undefined`, `number`, `boolean`, or even
     * `object`/`array` for fields typed as `string`. Passing these directly into
     * Obsidian APIs (normalizePath, getAbstractFileByPath, stringifyYaml) crashes
     * with `Cannot read properties of undefined (reading 'replace')`. This helper
     * is the single normalization point so downstream code always receives a
     * properly typed value.
     */
    private static normalizeFrontmatterString(value: unknown): string | undefined {
        if (value === undefined || value === null) return undefined;
        if (typeof value === 'string') {
            const s = value.trim();
            return s.length > 0 ? s : undefined;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        // objects, arrays, symbols, etc. → undefined (never leak to Obsidian APIs)
        return undefined;
    }

    /**
     * Extract frontmatter from markdown content
     */
    static extractFrontmatter(content: string): Record<string, unknown> | null {
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match) return null;
        try {
            return parseYaml(match[1]);
        } catch {
            return null;
        }
    }

    /**
     * Extract body content (everything after frontmatter)
     */
    static extractBody(content: string): string {
        const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        return match ? match[1].trim() : content;
    }

    /**
     * Update frontmatter fields in a file
     */
    static async updateFrontmatter(
        app: App,
        file: TFile,
        updates: Partial<Scene>
    ): Promise<void> {
        const content = await app.vault.read(file);
        const frontmatter = this.extractFrontmatter(content) || {};
        const body = this.extractBody(content);

        // Apply updates to frontmatter
        for (const [key, value] of Object.entries(updates)) {
            if (key === 'filePath') continue;
            // Remove empty notes rather than storing blank string
            if (key === 'notes' && !value) { delete frontmatter[key]; continue; }
            if (key === 'corkboardNote' && !value) { delete frontmatter[key]; continue; }
            if (key === 'corkboardNoteColor' && !value) { delete frontmatter[key]; continue; }
            if (key === 'corkboardNoteImage' && !value) { delete frontmatter[key]; continue; }
            if (key === 'corkboardNoteCaption' && !value) { delete frontmatter[key]; continue; }
            if (key === 'plotgridOrigin' && !value) { delete frontmatter[key]; continue; }
            if (key === 'subtitle' && !value) { delete frontmatter[key]; continue; }
            if (key === 'color' && !value) { delete frontmatter[key]; continue; }
            if (key === 'category' && !value) { delete frontmatter[key]; continue; }
            if (key === 'beatsheet' && !value) { delete frontmatter[key]; continue; }
            if (key === 'arcAnchor' && !value) { delete frontmatter[key]; continue; }
            if (key === 'ignored_detections') {
                if (Array.isArray(value) && value.length > 0) frontmatter[key] = value;
                else delete frontmatter[key];
                continue;
            }
            if (key === 'locations' || key === 'scenarios') {
                if (Array.isArray(value) && value.length > 0) {
                    frontmatter[key] = wrapArray(value);
                    if (key === 'locations') delete frontmatter.location;
                } else {
                    delete frontmatter[key];
                }
                continue;
            }
            if (key === 'codexLinks') {
                if (value && typeof value === 'object' && Object.keys(value).some(k => {
                    const arr = (value as Record<string, unknown>)[k];
                    return Array.isArray(arr) && arr.length > 0;
                })) {
                    frontmatter[key] = value;
                } else {
                    delete frontmatter[key];
                }
                continue;
            }
            if (key === 'custom') {
                if (value && typeof value === 'object') {
                    const cleaned: Record<string, unknown> = {};
                    for (const [fk, fv] of Object.entries(value as Record<string, unknown>)) {
                        if (fv === undefined || fv === null || fv === '') continue;
                        cleaned[fk] = fv;
                    }
                    if (Object.keys(cleaned).length > 0) {
                        frontmatter[key] = cleaned;
                    } else {
                        delete frontmatter[key];
                    }
                } else {
                    delete frontmatter[key];
                }
                continue;
            }
            if (key === 'templateSubcategory' && !value) {
                delete frontmatter[key];
                continue;
            }
            if (value !== undefined) {
                if ((SCENE_LINK_FIELDS_ARRAY as readonly string[]).includes(key)) {
                    frontmatter[key] = wrapArray(value);
                } else {
                    frontmatter[key] = value;
                }
            } else {
                delete frontmatter[key];
            }
        }

        // Update modified date
        frontmatter.modified = new Date().toISOString().split('T')[0];

        // Issue #71 - mirror custom-field values to top-level YAML keys.
        // Resolve against the merged subcategory (not `updates`), since most
        // scene writes don't carry templateSubcategory and would otherwise
        // fall back to the base template.
        mirrorCustomToTopLevel(
            frontmatter,
            frontmatter.custom as Record<string, string> | undefined,
            ENTITY_TYPE_SCENE,
            typeof frontmatter.templateSubcategory === 'string' ? frontmatter.templateSubcategory : undefined,
        );

        // Rebuild the mirrored custom-field body sections from the merged
        // frontmatter (Phase 2). Files without a mirror block stay untouched;
        // existing blocks are regenerated from the current mirror keys so
        // removed flags / cleared values drop out on the next write.
        let finalBody = body;
        const mirrored = buildSceneMirroredSections(frontmatter);
        if (body.includes(MIRROR_SEPARATOR) || mirrored.length > 0) {
            const { notes: existingNotes } = parseMirroredBody(body);
            finalBody = buildMirroredBody(existingNotes, mirrored);
        }

        const newContent = `---\n${stringifyYaml(frontmatter)}---\n\n${finalBody}`;
        await app.vault.modify(file, newContent);
    }

    /**
     * Generate frontmatter content for a new scene.
     *
     * Issue #77 \u2014 `extraFrontmatter` lets callers (SceneManager.createScene)
     * inject arbitrary YAML keys defined under Settings \u2192 "Default scene
     * frontmatter" (e.g. `cssclasses: [fountain]`). StoryLine-managed keys
     * always win on conflict so the scene model stays consistent.
     */
    static generateSceneContent(
        scene: Partial<Scene>,
        _template?: string,
        extraFrontmatter?: Record<string, unknown>,
    ): string {
        const fm: Record<string, unknown> = {
            type: 'scene',
            title: scene.title || 'Untitled Scene',
        };

        if (scene.act !== undefined) fm.act = scene.act;
        if (scene.chapter !== undefined) fm.chapter = scene.chapter;
        if (scene.sequence !== undefined) fm.sequence = scene.sequence;
        if (scene.characters?.length) fm.characters = wrapArray(scene.characters);
        if (scene.locations?.length) fm.locations = wrapArray(scene.locations);
        if (scene.scenarios?.length) fm.scenarios = wrapArray(scene.scenarios);
        fm.status = scene.status || 'idea';
        if (scene.category) fm.category = scene.category;
        if (scene.tags?.length) fm.tags = scene.tags;
        if (scene.notes) fm.notes = scene.notes;
        if (scene.notesFile) fm.notesFile = scene.notesFile;
        if (scene.corkboardNote) fm.corkboardNote = true;
        if (scene.corkboardNoteColor) fm.corkboardNoteColor = scene.corkboardNoteColor;
        if (scene.corkboardNoteImage) fm.corkboardNoteImage = scene.corkboardNoteImage;
        if (scene.corkboardNoteCaption) fm.corkboardNoteCaption = scene.corkboardNoteCaption;
        if (scene.plotgridOrigin) fm.plotgridOrigin = scene.plotgridOrigin;
        if (scene.subtitle) fm.subtitle = scene.subtitle;
        if (scene.color) fm.color = scene.color;
        if (scene.beatsheet) fm.beatsheet = scene.beatsheet;
        if (scene.arcAnchor) fm.arcAnchor = true;
        if (scene.codexLinks && Object.keys(scene.codexLinks).some(k => scene.codexLinks![k]?.length)) {
            fm.codexLinks = scene.codexLinks;
        }
        // Issue #71 — mirror custom-field values to top-level YAML keys
        mirrorCustomToTopLevel(fm, scene.custom, ENTITY_TYPE_SCENE, scene.templateSubcategory);
        if (scene.custom && Object.keys(scene.custom).length > 0) {
            fm.custom = scene.custom;
        }
        if (scene.templateSubcategory) fm.templateSubcategory = scene.templateSubcategory;
        fm.created = new Date().toISOString().split('T')[0];
        fm.modified = new Date().toISOString().split('T')[0];

        // Issue #77 \u2014 merge user-defined "Default scene frontmatter" keys.
        // StoryLine-owned keys always win, so we only add keys that aren't
        // already present.
        if (extraFrontmatter && typeof extraFrontmatter === 'object') {
            for (const [k, v] of Object.entries(extraFrontmatter)) {
                if (k && !(k in fm) && v !== undefined && v !== null) {
                    fm[k] = v;
                }
            }
        }

        return `---\n${stringifyYaml(fm)}---\n`;
    }

    /**
     * Parse locations array, cleaning wikilinks. Falls back to the legacy
     * scalar `location` frontmatter key (single location) by wrapping it
     * into an array.
     */
    private static parseLocations(frontmatter: Record<string, unknown>): string[] | undefined {
        if (Array.isArray(frontmatter.locations)) {
            const arr = frontmatter.locations
                .map((l: unknown) => this.cleanWikilink(String(l)) ?? '')
                .filter(s => s.length > 0);
            if (arr.length > 0) return arr;
        }
        const legacy = frontmatter.location;
        if (typeof legacy === 'string' && legacy.trim()) {
            const clean = this.cleanWikilink(legacy);
            return clean ? [clean] : undefined;
        }
        return undefined;
    }

    private static parseBooleanFlag(value: unknown): boolean | undefined {
        if (value === true || value === false) return value;
        if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (v === 'true') return true;
            if (v === 'false') return false;
        }
        if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
        }
        return undefined;
    }

    /**
     * Strip wikilink brackets from a string. Handles:
     *   `[[Name]]`             → `Name`
     *   `[[Path/To/Name]]`     → `Name`     (last path segment)
     *   `[[Name|Display]]`     → `Display`  (alias preferred for display)
     *   `[[Name#heading]]`     → `Name`
     * Quoted YAML strings are also unwrapped. Issue #73.
     *
     * Since v1.10.35 (issue #186): plain (non-wikilink) strings that look like
     * file paths or filenames are also normalised to the scene title — e.g.
     * `"MyProject/Scenes/Scene 10.md"` → `"Scene 10"`, `"Scene 10.md"` →
     * `"Scene 10"`. This makes setup/payoff links tolerant of values written
     * as paths (as the old template comment suggested) instead of titles.
     */
    static cleanWikilink(value: string | undefined): string | undefined {
        if (value === undefined || value === null) return undefined;
        let s = String(value).trim();
        if (!s) return undefined;
        // Strip surrounding YAML quotes that may have leaked through
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            s = s.slice(1, -1).trim();
        }
        const m = s.match(/^\[\[([^\]]+)\]\]$/);
        if (!m) {
            // Plain string (not a wikilink). If it looks like a path or a
            // filename with a .md extension, normalise it to the scene title
            // so setup/payoff links stored as paths still resolve. Issue #186.
            return MetadataParser.stripPathAndExtension(s);
        }
        let inner = m[1];
        // Alias: prefer the right-hand display label
        const pipe = inner.indexOf('|');
        if (pipe >= 0) {
            inner = inner.slice(pipe + 1).trim();
        } else {
            // Drop block/heading refs and keep last path segment
            inner = inner.split('#')[0];
            const slash = inner.lastIndexOf('/');
            if (slash >= 0) inner = inner.slice(slash + 1);
        }
        inner = inner.trim();
        // Also strip a trailing .md extension that may survive after the
        // last-segment extraction above (e.g. `[[Scene 10.md]]`).
        return MetadataParser.stripPathAndExtension(inner);
    }

    /**
     * Normalise a plain scene-reference string to its title form:
     * drop any folder path prefix and a trailing `.md` extension.
     * `"Folder/Scene 10.md"` → `"Scene 10"`, `"Scene 10"` → `"Scene 10"`.
     * Issue #186.
     */
    private static stripPathAndExtension(s: string): string {
        let out = s;
        const slash = out.lastIndexOf('/');
        if (slash >= 0) out = out.slice(slash + 1);
        const backslash = out.lastIndexOf('\\');
        if (backslash >= 0) out = out.slice(backslash + 1);
        if (out.toLowerCase().endsWith('.md')) out = out.slice(0, -3);
        return out.trim();
    }

    /**
     * Parse characters array, cleaning wikilinks
     */
    private static parseCharacters(chars: unknown): string[] | undefined {
        if (!Array.isArray(chars)) return undefined;
        return chars
            .map((c: unknown) => this.cleanWikilink(String(c)) ?? '')
            .filter(s => s.length > 0);
    }

    /**
     * Parse an array of strings, cleaning wikilinks
     */
    private static parseStringArray(arr: unknown): string[] | undefined {
        if (!Array.isArray(arr)) return undefined;
        return arr
            .map((s: unknown) => this.cleanWikilink(String(s)) ?? '')
            .filter(s => s.length > 0);
    }

    /**
     * Validate and parse scene status.
     * Accepts any status that appears in the current status order (built-in + custom).
     * Unknown strings are preserved as-is to prevent data loss.
     */
    private static parseStatus(status: string | undefined): SceneStatus | undefined {
        if (!status) return undefined;
        const lower = String(status).toLowerCase().trim();
        if (!lower) return undefined;
        // Accept anything — the status order list is the source of truth for known
        // statuses, but we preserve unknown strings so user data is never silently
        // dropped (e.g. hand-edited YAML with a status not yet defined in settings).
        return lower as SceneStatus;
    }

    /**
     * Parse codexLinks: Record<string, string[]> from frontmatter.
     * Accepts { categoryId: ['EntryName', ...] } or undefined.
     */
    private static parseCodexLinks(raw: unknown): Record<string, string[]> | undefined {
        if (!raw || typeof raw !== 'object') return undefined;
        const result: Record<string, string[]> = {};
        let hasAny = false;
        for (const [key, val] of Object.entries(raw)) {
            if (Array.isArray(val)) {
                const arr = val
                    .map((v: unknown) => this.cleanWikilink(String(v)) ?? '')
                    .filter(Boolean);
                if (arr.length > 0) {
                    result[key] = arr;
                    hasAny = true;
                }
            }
        }
        return hasAny ? result : undefined;
    }

    /**
     * Extract a title from file path
     */
    private static titleFromPath(filePath: string): string {
        const name = filePath.split('/').pop() || '';
        return name.replace(/\.md$/, '');
    }
}
/* eslint-enable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion -- end of file-wide suppression block opened at line 1 */
