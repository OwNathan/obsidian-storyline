/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { Character, CharacterRelation, CharacterRelationCategory, CHARACTER_FIELD_KEYS, LEGACY_RELATION_FIELDS_TO_CLEAN, normalizeCharacterRelations, normalizeRoleEntries, CHARACTER_CATEGORIES } from '../models/Character';
import { hydrateUniversalFieldsFromTopLevel, mirrorUniversalFieldsToTopLevel, UniversalFieldTemplate } from './FieldTemplateService';
import { App, TFile, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { coerceString } from '../utils/narrow';
import { MirroredSection, buildMirroredBody, parseMirroredBody, ParsedMirrorSection } from './CodexManager';

/**
 * Manages character .md files — loading, saving, creating, and deleting
 * character profiles from the project's Characters/ folder.
 */
export class CharacterManager {
    private app: App;
    private characters: Map<string, Character> = new Map();
    private _isSaving = false;
    private _fieldTemplates: UniversalFieldTemplate[] = [];

    constructor(app: App) {
        this.app = app;
    }

    /** Whether the manager is currently writing a file (prevents modify-loop). */
    isSelfWrite(): boolean {
        return this._isSaving;
    }

    /** Set field templates for resolving universal field mirror keys during body parsing. */
    setFieldTemplates(templates: UniversalFieldTemplate[]): void {
        this._fieldTemplates = templates;
    }

    /**
     * Load all character files from a given folder path.
     * Uses the vault adapter (filesystem) for reliable discovery of
     * externally-created or synced files.
     */
    async loadCharacters(folderPath: string): Promise<Character[]> {
        this.characters.clear();
        const adapter = this.app.vault.adapter;
        if (!await adapter.exists(folderPath)) return [];

        const listing = await adapter.list(folderPath);
        for (const f of listing.files) {
            if (f.endsWith('.md')) {
                try {
                    const filePath = normalizePath(f);
                    const content = await adapter.read(filePath);
                    // Folder-based fallback (issue #74): files inside the
                    // Characters folder are accepted even if `type:` is
                    // missing, so user-inserted templates don't make the
                    // entry vanish from the Codex.
                    const character = this.parseCharacterContent(content, filePath, /*folderFallback*/ true);
                    if (character) {
                        this.characters.set(filePath, character);
                    }
                } catch { /* file unreadable — skip */ }
            }
        }

        return this.getAllCharacters();
    }

    /**
     * Add a single file from an external folder scan.
     * Returns true if the file was recognised as a character.
     */
    addFile(content: string, filePath: string): boolean {
        if (this.characters.has(filePath)) return false;
        const character = this.parseCharacterContent(content, filePath);
        if (character) {
            this.characters.set(filePath, character);
            return true;
        }
        return false;
    }

    /**
     * Get all loaded characters sorted by name.
     */
    getAllCharacters(): Character[] {
        return Array.from(this.characters.values()).sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        );
    }

    /**
     * Get a character by file path.
     */
    getCharacter(filePath: string): Character | undefined {
        return this.characters.get(filePath);
    }

    /**
     * Find a character by name (case-insensitive).
     * Checks full name, nickname(s), and first name.
     */
    findByName(name: string): Character | undefined {
        const lower = name.toLowerCase();
        for (const char of this.characters.values()) {
            if (char.name.toLowerCase() === lower) return char;
            // Check nickname(s) — supports comma-separated
            if (char.nickname) {
                const nicks = char.nickname.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
                if (nicks.includes(lower)) return char;
            }
            // Check first name (first word of full name)
            const firstName = char.name.split(/\s+/)[0];
            if (firstName && firstName.toLowerCase() === lower) return char;
        }
        return undefined;
    }

    /**
     * Build a map from lowercased alias → canonical character name (display casing).
     * Aliases include: full name, each comma-separated nickname, the first
     * word of the full name (only if it's unique — i.e. no other character
     * shares the same first name), and any manual aliases passed in.
     *
     * @param manualAliases  Optional user-defined alias → canonical mappings
     *                       (from plugin settings.characterAliases).
     */
    buildAliasMap(manualAliases?: Record<string, string>): Map<string, string> {
        const aliasMap = new Map<string, string>();
        const allChars = this.getAllCharacters();

        // Count first-name usage to avoid ambiguity
        const firstNameCount = new Map<string, number>();
        for (const char of allChars) {
            const first = char.name.split(/\s+/)[0]?.toLowerCase();
            if (first) firstNameCount.set(first, (firstNameCount.get(first) || 0) + 1);
        }

        for (const char of allChars) {
            const canonical = char.name;

            // Full name
            aliasMap.set(canonical.toLowerCase(), canonical);

            // Nicknames
            if (char.nickname) {
                const nicks = char.nickname.split(',').map(n => n.trim()).filter(Boolean);
                for (const nick of nicks) {
                    aliasMap.set(nick.toLowerCase(), canonical);
                }
            }

            // First name (only if unique across all characters)
            const first = canonical.split(/\s+/)[0];
            if (first && (firstNameCount.get(first.toLowerCase()) || 0) <= 1) {
                aliasMap.set(first.toLowerCase(), canonical);
            }
        }

        // Apply manual aliases (these always win over auto-detected ones)
        if (manualAliases) {
            for (const [alias, canonical] of Object.entries(manualAliases)) {
                aliasMap.set(alias.toLowerCase(), canonical);
            }
        }

        return aliasMap;
    }

    /**
     * Create a new character file.
     */
    async createCharacter(folderPath: string, name: string): Promise<Character> {
        await this.ensureFolder(folderPath);
        const safeName = name.replace(/[\\/:*?"<>|]/g, '-');
        const filePath = normalizePath(`${folderPath}/${safeName}.md`);

        // Check if file already exists
        if (this.app.vault.getAbstractFileByPath(filePath)) {
            throw new Error(`Character file already exists: ${filePath}`);
        }

        const now = new Date().toISOString().split('T')[0];
        const fm: Record<string, unknown> = {
            type: 'character',
            name,
            created: now,
            modified: now,
        };

        const content = `---\n${stringifyYaml(fm)}---\n`;
        await this.app.vault.create(filePath, content);

        const character: Character = {
            filePath,
            type: 'character',
            name,
            created: now,
            modified: now,
        };

        this.characters.set(filePath, character);
        return character;
    }

    /**
     * Save/update a character back to its file.
     */
    async saveCharacter(character: Character, mirrored?: MirroredSection[]): Promise<void> {
        const normalizedFilePath = normalizePath(character.filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedFilePath);
        if (!(file instanceof TFile)) {
            throw new Error(`Character file not found: ${normalizedFilePath}`);
        }

        const content = await this.app.vault.read(file);
        const existingFm = this.extractFrontmatter(content) || {};
        const body = this.extractBody(content);

        // Build frontmatter from character object
        const fm: Record<string, unknown> = { ...existingFm };
        fm.type = 'character';
        fm.name = character.name;
        fm.modified = new Date().toISOString().split('T')[0];
        if (character.created) fm.created = character.created;

        // Write all standard fields
        for (const key of CHARACTER_FIELD_KEYS) {
            if (key === 'name') continue; // already set above
            const val = character[key];
            if (val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0)) {
                fm[key] = val;
            } else {
                delete fm[key]; // Remove empty fields to keep frontmatter clean
            }
        }
        // Clean up legacy keys
        delete fm['coreBeliefs'];
        delete fm['romanticHistory'];
        delete fm['customRelationType'];
        delete fm['customRelationLabel'];
        for (const key of LEGACY_RELATION_FIELDS_TO_CLEAN) {
            delete fm[key];
        }

        // Custom fields
        if (character.custom && Object.keys(character.custom).length > 0) {
            fm.custom = character.custom;
        } else {
            delete fm.custom;
        }

        // Universal fields (values from field-templates)
        if (character.universalFields && Object.keys(character.universalFields).length > 0) {
            fm.universalFields = character.universalFields;
        } else {
            delete fm.universalFields;
        }
        // Issue #71 — mirror to top-level YAML keys for templates that opt in
        mirrorUniversalFieldsToTopLevel(fm, character.universalFields);

        // Build body: strip old mirrored sections, then rebuild with notes + current mirrored fields
        const { notes: existingNotes } = parseMirroredBody(body);
        const notesContent = character.notes ?? (existingNotes || '');
        const finalBody = buildMirroredBody(notesContent, mirrored ?? []);

        const newContent = `---\n${stringifyYaml(fm)}---\n${finalBody ? '\n' + finalBody : ''}`;
        this._isSaving = true;
        try {
            await this.app.vault.modify(file, newContent);
        } finally {
            this._isSaving = false;
        }

        // Update in-memory cache
        this.characters.set(normalizedFilePath, { ...character, filePath: normalizedFilePath });
    }

    /**
     * Delete a character file.
     */
    async deleteCharacter(filePath: string): Promise<void> {
        const normalizedFilePath = normalizePath(filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedFilePath);
        if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file);
        }
        this.characters.delete(normalizedFilePath);
    }

    /**
     * Rename a character — renames the file and updates the name field.
     */
    async renameCharacter(character: Character, newName: string, folderPath: string): Promise<Character> {
        const safeName = newName.replace(/[\\/:*?"<>|]/g, '-');
        const newPath = normalizePath(`${folderPath}/${safeName}.md`);

        const oldPath = normalizePath(character.filePath);
        const file = this.app.vault.getAbstractFileByPath(oldPath);
        if (file instanceof TFile && newPath !== oldPath) {
            await this.app.fileManager.renameFile(file, newPath);
        }

        this.characters.delete(oldPath);
        const updated: Character = { ...character, filePath: newPath, name: newName };
        this.characters.set(newPath, updated);
        await this.saveCharacter(updated);
        return updated;
    }

    /**
     * Move a character file to a different folder. Used by the Promote /
     * Demote actions to shuttle a character between the per-project Codex/
     * Characters folder and the series-level shared folder.
     *
     * Wikilinks in scenes reference characters by NAME (not file path), so
     * no link cascade is needed — only the file location changes.
     */
    async moveCharacter(character: Character, targetFolderPath: string): Promise<Character> {
        const oldPath = normalizePath(character.filePath);
        await this.ensureFolder(targetFolderPath);
        const basename = oldPath.split('/').pop() ?? `${character.name}.md`;
        const newPath = normalizePath(`${targetFolderPath}/${basename}`);
        if (newPath === oldPath) return character;

        if (this.app.vault.getAbstractFileByPath(newPath)) {
            throw new Error(`A character file already exists at: ${newPath}`);
        }

        const file = this.app.vault.getAbstractFileByPath(oldPath);
        if (file instanceof TFile) {
            await this.app.fileManager.renameFile(file, newPath);
        }

        this.characters.delete(oldPath);
        const updated: Character = { ...character, filePath: newPath };
        this.characters.set(newPath, updated);
        return updated;
    }
    /**
     * Parse raw markdown content as a Character.
     * Used by both TFile-based and adapter-based loading.
     */
    private parseCharacterContent(content: string, filePath: string, folderFallback = false): Character | null {
        const fm = this.extractFrontmatter(content);
        // Folder-based fallback (issue #74): when this file already lives
        // inside the Characters folder, accept it even if `type:` is missing
        // or has been overwritten (e.g. by a Templater template). Otherwise
        // require the discriminator to match.
        if (!fm && !folderFallback) return null;
        const safeFm = (fm ?? {}) as Partial<Character> & Record<string, unknown>;
        if (safeFm.type !== 'character' && !folderFallback) return null;

        const body = this.extractBody(content);

        // Parse mirrored sections from body (body wins over frontmatter)
        const { notes: plainNotes, sections } = parseMirroredBody(body);

        const basename = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath;
        const relations = normalizeCharacterRelations(this.parseRelations(safeFm.relations) || this.buildLegacyRelations(safeFm));

        const character: Character = {
            filePath,
            type: 'character',
            name: safeFm.name || basename,
            tagline: safeFm.tagline,
            image: safeFm.image,
            gallery: this.parseGallery(safeFm.gallery),
            nickname: safeFm.nickname,
            age: safeFm.age != null ? String(safeFm.age) : undefined,
            role: safeFm.role,
            roles: normalizeRoleEntries(safeFm.roles),
            occupation: safeFm.occupation,
            residency: safeFm.residency,
            locations: this.parseStringList(safeFm.locations),
            family: safeFm.family,
            appearance: safeFm.appearance,
            distinguishingFeatures: safeFm.distinguishingFeatures,
            style: safeFm.style,
            quirks: safeFm.quirks,
            personality: safeFm.personality,
            internalMotivation: safeFm.internalMotivation,
            externalMotivation: safeFm.externalMotivation,
            strengths: safeFm.strengths,
            flaws: safeFm.flaws,
            fears: safeFm.fears,
            belief: safeFm.belief || (safeFm.coreBeliefs as string | undefined),
            misbelief: safeFm.misbelief,
            formativeMemories: safeFm.formativeMemories,
            accomplishments: safeFm.accomplishments,
            secrets: safeFm.secrets,
            relations: relations.length ? relations : undefined,
            startingPoint: safeFm.startingPoint,
            goal: safeFm.goal,
            expectedChange: safeFm.expectedChange,
            habits: safeFm.habits,
            props: safeFm.props,
            books: this.parseStringList(safeFm.books),
            custom: safeFm.custom && typeof safeFm.custom === 'object'
                ? (safeFm.custom as Record<string, string>)
                : undefined,
            universalFields: hydrateUniversalFieldsFromTopLevel(
                safeFm,
                safeFm.universalFields && typeof safeFm.universalFields === 'object'
                    ? (safeFm.universalFields as Record<string, string | string[]>)
                    : undefined,
            ) as Record<string, string | string[]> | undefined,
            created: safeFm.created,
            modified: safeFm.modified,
            notes: plainNotes || undefined,
        };

        // Apply mirrored body values — body is source of truth for mirrored fields
        if (sections.length > 0) {
            for (const sec of sections) {
                const key = this.resolveMirrorKey(sec.sectionTitle, sec.fieldLabel);
                if (!key) continue;
                if (key.startsWith('uf_')) {
                    if (!character.universalFields) character.universalFields = {};
                    character.universalFields[key] = sec.value;
                } else if (key.includes(' :: ')) {
                    if (!character.custom) character.custom = {};
                    character.custom[key] = sec.value;
                } else {
                    (character as unknown as Record<string, unknown>)[key] = sec.value;
                }
            }
        }

        return character;
    }

    /**
     * Resolve a sectionTitle + fieldLabel pair to a field key for a Character.
     */
    private resolveMirrorKey(sectionTitle: string, fieldLabel: string): string | null {
        // Universal field — match by section and label
        const tpl = this._fieldTemplates.find(t => t.section === sectionTitle && t.label === fieldLabel);
        if (tpl) return tpl.id;

        // Built-in field — scan CHARACTER_CATEGORIES
        for (const cat of CHARACTER_CATEGORIES) {
            if (cat.title !== sectionTitle) continue;
            const field = cat.fields.find(f => f.label === fieldLabel);
            if (field) return field.key;
        }

        // Fallback: composite custom-section key
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
        return match ? match[1].trim() : '';
    }

    private parseStringList(value: unknown): string[] | undefined {
        if (Array.isArray(value)) {
            const parsed = value.map(v => coerceString(v).trim()).filter(Boolean);
            return parsed.length ? parsed : undefined;
        }
        if (value == null || value === '') return undefined;
        const str = coerceString(value);
        if (!str) return undefined;
        const parsed = str
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        return parsed.length ? parsed : undefined;
    }

    private parseRelations(value: unknown): CharacterRelation[] | undefined {
        if (!Array.isArray(value)) return undefined;
        const parsed: CharacterRelation[] = [];
        for (const item of value) {
            if (!item || typeof item !== 'object') continue;
            const rec = item as Record<string, unknown>;
            const category = typeof rec.category === 'string' ? rec.category : '';
            const type = typeof rec.type === 'string' ? rec.type : '';
            const target = typeof rec.target === 'string' ? rec.target : '';
            if (!category || !type || !target) continue;
            parsed.push({ category: category as CharacterRelationCategory, type, target });
        }
        return parsed.length ? parsed : undefined;
    }

    private buildLegacyRelations(fm: Record<string, unknown>): CharacterRelation[] {
        const out: CharacterRelation[] = [];
        const addMany = (key: keyof Character, category: CharacterRelation['category'], type: string) => {
            const names = this.parseStringList((fm as unknown as Record<string, unknown>)[key]);
            if (!names) return;
            for (const target of names) {
                out.push({ category, type, target });
            }
        };

        addMany('siblings', 'family', 'sibling');
        addMany('halfSiblings', 'family', 'half-sibling');
        addMany('twins', 'family', 'twin');
        addMany('parents', 'family', 'parent');
        addMany('children', 'family', 'child');
        addMany('stepParents', 'family', 'step-parent');
        addMany('stepChildren', 'family', 'step-child');
        addMany('adoptiveParents', 'family', 'adoptive-parent');
        addMany('adoptedChildren', 'family', 'adopted-child');
        addMany('guardians', 'family', 'guardian');
        addMany('wards', 'family', 'ward');
        addMany('grandparents', 'family', 'grandparent');
        addMany('grandchildren', 'family', 'grandchild');
        addMany('auntsUncles', 'family', 'aunt/uncle');
        addMany('niecesNephews', 'family', 'niece/nephew');
        addMany('cousins', 'family', 'cousin');
        addMany('inLaws', 'family', 'in-law');

        addMany('romantic', 'romantic', 'partner');
        addMany('spouses', 'romantic', 'spouse');
        addMany('exPartners', 'romantic', 'ex-partner');

        addMany('allies', 'social', 'ally');
        addMany('friends', 'social', 'friend');
        addMany('bestFriends', 'social', 'best-friend');
        addMany('confidants', 'social', 'confidant');
        addMany('acquaintances', 'social', 'acquaintance');

        addMany('enemies', 'conflict', 'enemy');
        addMany('rivals', 'conflict', 'rival');
        addMany('betrayers', 'conflict', 'betrayer');
        addMany('avengers', 'conflict', 'avenger');

        addMany('mentors', 'guidance', 'mentor');
        addMany('mentees', 'guidance', 'mentee');
        addMany('leaders', 'guidance', 'leader');
        addMany('followers', 'guidance', 'follower');
        addMany('bosses', 'guidance', 'boss');
        addMany('subordinates', 'guidance', 'subordinate');
        addMany('commanders', 'guidance', 'commander');
        addMany('secondsInCommand', 'guidance', 'second-in-command');
        addMany('masters', 'guidance', 'master');
        addMany('apprentices', 'guidance', 'apprentice');

        addMany('colleagues', 'professional', 'colleague');
        addMany('businessPartners', 'professional', 'business-partner');
        addMany('clients', 'professional', 'client');
        addMany('handlers', 'professional', 'handler');
        addMany('assets', 'professional', 'asset');

        addMany('protectors', 'story', 'protector');
        addMany('dependents', 'story', 'dependent');
        addMany('owesDebtTo', 'story', 'owes-debt-to');
        addMany('swornTo', 'story', 'sworn-to');
        addMany('boundByOath', 'story', 'bound-by-oath');
        addMany('idolizes', 'story', 'idolizes');
        addMany('fearsPeople', 'story', 'fears');
        addMany('obsessedWith', 'story', 'obsessed-with');

        const customTypeRaw = typeof fm.customRelationType === 'string' ? fm.customRelationType : (typeof fm.customRelationLabel === 'string' ? fm.customRelationLabel : 'custom');
        const customType = customTypeRaw.trim().toLowerCase().replace(/\s+/g, '-');
        const customNames = this.parseStringList(fm.customRelations) || this.parseStringList(fm.otherRelations);
        if (customNames) {
            for (const target of customNames) {
                out.push({ category: 'custom', type: customType || 'custom', target });
            }
        }

        return out;
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
            // Race: another caller (or a synced file) created it between
            // our exists() check and createFolder(). Treat as success.
            if (await adapter.exists(folderPath)) return;
            throw e;
        }
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
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion -- end of file-wide suppression block opened at line 1 */
