/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { App, Notice, TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { Scenario, ScenarioPhase } from '../models/Scenario';
import type { ObjectiveType, ObjectiveVariant, ObjectiveVariantPhase } from '../models/Objective';
import type { ArcType, ArcVariant } from '../models/Arc';
import type { Quest, QuestPhase } from '../models/Quest';
import {
    DNBase,
    DNEntityType,
    DNEntity,
    DNArcVariantQuestList,
    DNLinkedEntity,
    DNLinkedChild,
    DNLinkedCommentTarget,
    DNClipboard,
    DNClipboardPhaseEntry,
    DNClipboardQuestEntry,
    DNPasteMode,
    DNPhase,
    DEFAULT_DN_PHASES,
    DEFAULT_SCENARIO_CATEGORIES,
    DEFAULT_OBJECTIVE_CATEGORIES,
    DEFAULT_QUEST_CATEGORIES,
    createDefaultPhases,
    createDefaultPhase,
    getOrderedPhases,
    deriveShortDesc,
    isDefaultPhase,
    resolveWikilinkPath,
    deepClone,
} from '../models/types';
import { createEmptyScenario } from '../models/Scenario';
import { createEmptyObjectiveType, createEmptyObjectiveVariant } from '../models/Objective';
import { createEmptyArcType, createEmptyArcVariant } from '../models/Arc';
import { createEmptyQuest } from '../models/Quest';

interface DynamicNarrativeSystemData {
    scenarios: Record<string, Scenario>;
    objectiveTypes: Record<string, ObjectiveType>;
    objectiveVariants: Record<string, ObjectiveVariant>;
    arcTypes: Record<string, ArcType>;
    arcVariants: Record<string, ArcVariant>;
    quests: Record<string, Quest>;
    layout: {
        inspectorWidth: number;
    };
    version: number;
}

const SYSTEM_FILE_NAME = 'dynamic-narrative.json';
const DN_FOLDER_NAME = 'DynamicNarrative';
const SUBFOLDERS = ['Scenarios', 'ObjectiveTypes', 'ObjectiveVariants', 'ArcTypes', 'ArcVariants', 'Quests'] as const;

const QUEST_LINK_LISTS: DNArcVariantQuestList[] = ['linkedGoals', 'linkedLimits', 'linkedEvents', 'linkedModifiers'];

export class DynamicNarrativeManager {
    private app: App;
    private plugin: SceneCardsPlugin;

    private scenarios: Map<string, Scenario> = new Map();
    private objectiveTypes: Map<string, ObjectiveType> = new Map();
    private objectiveVariants: Map<string, ObjectiveVariant> = new Map();
    private arcTypes: Map<string, ArcType> = new Map();
    private arcVariants: Map<string, ArcVariant> = new Map();
    private quests: Map<string, Quest> = new Map();

    dnClipboard: DNClipboard | null = null;

    private projectFolder: string = '';
    private systemFilePath: string = '';
    private initialized = false;
    private _saveQueue: Promise<void> = Promise.resolve();

    constructor(app: App, plugin: SceneCardsPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    // ─── Initialization ──────────────────────────────────────────

    async initialize(projectFolder: string): Promise<void> {
        this.projectFolder = projectFolder;
        this.systemFilePath = normalizePath(`${projectFolder}/System/${SYSTEM_FILE_NAME}`);
        this.dnClipboard = null;
        await this.ensureFolders();
        await this.loadAll();
        this.initialized = true;
    }

    private async ensureFolders(): Promise<void> {
        const dnFolder = normalizePath(`${this.projectFolder}/${DN_FOLDER_NAME}`);
        await this.ensureFolder(dnFolder);
        for (const sub of SUBFOLDERS) {
            await this.ensureFolder(normalizePath(`${dnFolder}/${sub}`));
        }
    }

    private async ensureFolder(path: string): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (!existing) {
            await this.app.vault.createFolder(path);
        }
    }

    async loadAll(): Promise<void> {
        this.scenarios.clear();
        this.objectiveTypes.clear();
        this.objectiveVariants.clear();
        this.arcTypes.clear();
        this.arcVariants.clear();
        this.quests.clear();

        const systemData = await this.loadSystemJson();
        if (systemData) {
            for (const [path, entity] of Object.entries(systemData.scenarios ?? {})) {
                entity.type = 'scenario';
                this.scenarios.set(path, entity);
            }
            for (const [path, entity] of Object.entries(systemData.objectiveTypes ?? {})) {
                entity.type = 'objective-type';
                this.objectiveTypes.set(path, entity);
            }
            for (const [path, entity] of Object.entries(systemData.objectiveVariants ?? {})) {
                entity.type = 'objective-variant';
                this.objectiveVariants.set(path, entity);
            }
            for (const [path, entity] of Object.entries(systemData.arcTypes ?? {})) {
                const arcType = { ...entity } as ArcType & { category?: unknown };
                delete arcType.category;
                arcType.type = 'arc-type';
                this.arcTypes.set(path, arcType);
            }
            for (const [path, entity] of Object.entries(systemData.arcVariants ?? {})) {
                const arcVariant = { ...entity } as ArcVariant & {
                    category?: unknown;
                    linkedLocations?: unknown;
                    dynamicLocations?: unknown;
                    phases?: unknown;
                };
                delete arcVariant.category;
                delete arcVariant.linkedLocations;
                delete arcVariant.dynamicLocations;
                delete arcVariant.phases;
                arcVariant.conditionsOverride = typeof arcVariant.conditionsOverride === 'string'
                    ? arcVariant.conditionsOverride
                    : '';
                arcVariant.commandsOverride = typeof arcVariant.commandsOverride === 'string'
                    ? arcVariant.commandsOverride
                    : '';
                arcVariant.linkedGoals = this.parseLinkedEntities(arcVariant.linkedGoals);
                arcVariant.linkedLimits = this.parseLinkedEntities(arcVariant.linkedLimits);
                arcVariant.linkedEvents = this.parseLinkedEntities(arcVariant.linkedEvents);
                arcVariant.linkedModifiers = this.parseLinkedEntities(arcVariant.linkedModifiers);
                arcVariant.type = 'arc-variant';
                this.arcVariants.set(path, arcVariant);
            }
            for (const [path, entity] of Object.entries(systemData.quests ?? {})) {
                entity.type = 'quest';
                this.quests.set(path, entity);
            }
        }

        await this.scanEntityFolder('Scenarios', 'scenario');
        await this.scanEntityFolder('ObjectiveTypes', 'objective-type');
        await this.scanEntityFolder('ObjectiveVariants', 'objective-variant');
        await this.scanEntityFolder('ArcTypes', 'arc-type');
        await this.scanEntityFolder('ArcVariants', 'arc-variant');
        await this.scanEntityFolder('Quests', 'quest');

        this.syncAllVariants();

        await this.saveSystemJson();
    }

    private async scanEntityFolder(subfolder: string, entityType: DNEntityType): Promise<void> {
        const folderPath = normalizePath(`${this.projectFolder}/${DN_FOLDER_NAME}/${subfolder}`);
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !(folder instanceof TFolder)) return;

        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === 'md') {
                const entity = await this.parseEntityFile(child);
                if (entity && entity.type === entityType) {
                    this.getMapForType(entityType).set(entity.filePath, entity as never);
                }
            }
        }
    }

    private getMapForType(entityType: DNEntityType): Map<string, DNEntity> {
        switch (entityType) {
            case 'scenario': return this.scenarios as Map<string, DNEntity>;
            case 'objective-type': return this.objectiveTypes as Map<string, DNEntity>;
            case 'objective-variant': return this.objectiveVariants as Map<string, DNEntity>;
            case 'arc-type': return this.arcTypes as Map<string, DNEntity>;
            case 'arc-variant': return this.arcVariants as Map<string, DNEntity>;
            case 'quest': return this.quests as Map<string, DNEntity>;
        }
    }

    // ─── System JSON ─────────────────────────────────────────────

    private async loadSystemJson(): Promise<DynamicNarrativeSystemData | null> {
        try {
            const file = this.app.vault.getAbstractFileByPath(this.systemFilePath);
            if (!file || !(file instanceof TFile)) return null;
            const content = await this.app.vault.read(file);
            return JSON.parse(content) as DynamicNarrativeSystemData;
        } catch {
            return null;
        }
    }

    async saveSystemJson(): Promise<void> {
        this._saveQueue = this._saveQueue.then(() => this._doSaveSystemJson());
        return this._saveQueue;
    }

    private async _doSaveSystemJson(): Promise<void> {
        const data: DynamicNarrativeSystemData = {
            scenarios: Object.fromEntries(this.scenarios),
            objectiveTypes: Object.fromEntries(this.objectiveTypes),
            objectiveVariants: Object.fromEntries(this.objectiveVariants),
            arcTypes: Object.fromEntries(this.arcTypes),
            arcVariants: Object.fromEntries(this.arcVariants),
            quests: Object.fromEntries(this.quests),
            layout: {
                inspectorWidth: 350,
            },
            version: 2,
        };

        const content = JSON.stringify(data, null, 2);
        const file = this.app.vault.getAbstractFileByPath(this.systemFilePath);
        if (file && file instanceof TFile) {
            await this.app.vault.modify(file, content);
        } else {
            await this.ensureFolder(normalizePath(`${this.projectFolder}/System`));
            await this.app.vault.create(this.systemFilePath, content);
        }
    }

    // ─── File I/O ────────────────────────────────────────────────

    private async parseEntityFile(file: TFile): Promise<DNEntity | null> {
        try {
            const content = await this.app.vault.read(file);
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!fmMatch) return null;

            const fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
            const body = content.slice(fmMatch[0].length).trim();
            const tags = Array.isArray(fm.tags) ? fm.tags as string[] : [];

            if (tags.includes('storyline-scenario')) {
                return this.parseScenarioFromFm(fm, body, file.path);
            } else if (tags.includes('storyline-objective-type')) {
                return this.parseObjectiveTypeFromFm(fm, body, file.path);
            } else if (tags.includes('storyline-objective-variant')) {
                return this.parseObjectiveVariantFromFm(fm, body, file.path);
            } else if (tags.includes('storyline-arc-type')) {
                return this.parseArcTypeFromFm(fm, body, file.path);
            } else if (tags.includes('storyline-arc-variant')) {
                return this.parseArcVariantFromFm(fm, body, file.path);
            } else if (tags.includes('storyline-quest')) {
                return this.parseQuestFromFm(fm, body, file.path);
            }
            return null;
        } catch {
            return null;
        }
    }

    private parseScenarioFromFm(fm: Record<string, unknown>, body: string, filePath: string): Scenario {
        const phases = this.parseScenarioPhases(fm['scenario-phases']);
        const description = (fm.description as string) ?? this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            dirty: fm['dirty'] !== false,
            type: 'scenario',
            category: (fm['scenario-category'] as string) || '',
            linkedActs: this.parseNumberList(fm['scenario-acts']),
            linkedLocations: this.parseStringList(fm['linked-locations']),
            linkedCharacters: this.parseStringList(fm['linked-characters']),
            phases,
        };
    }

    private parseObjectiveTypeFromFm(fm: Record<string, unknown>, body: string, filePath: string): ObjectiveType {
        const phases = this.parsePlainPhases(fm['objective-type-phases']);
        const description = (fm.description as string) ?? this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            dirty: fm['dirty'] !== false,
            type: 'objective-type',
            category: (fm['objective-type-category'] as string) || '',
            phases,
        };
    }

    private parseObjectiveVariantFromFm(fm: Record<string, unknown>, body: string, filePath: string): ObjectiveVariant {
        const phases = this.parseObjectiveVariantPhases(fm['objective-variant-phases']);
        const description = (fm.description as string) ?? this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            dirty: fm['dirty'] !== false,
            type: 'objective-variant',
            objectiveTypeId: this.parseTypeRef(fm['objective-type-ref']),
            category: (fm['objective-variant-category'] as string) || '',
            linkedLocations: this.parseStringList(fm['linked-locations']),
            linkedCharacters: this.parseStringList(fm['linked-characters']),
            phases,
        };
    }

    private parseArcTypeFromFm(fm: Record<string, unknown>, body: string, filePath: string): ArcType {
        const phases = this.parsePlainPhases(fm['arc-type-phases']);
        const description = (fm.description as string) ?? this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            dirty: fm['dirty'] !== false,
            type: 'arc-type',
            phases,
        };
    }

    private parseArcVariantFromFm(fm: Record<string, unknown>, body: string, filePath: string): ArcVariant {
        const description = (fm.description as string) ?? this.extractBodySection(body, 'Overview');
        const hasLegacyPhaseData = Array.isArray(fm['arc-variant-phases']);
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            dirty: fm['dirty'] !== false || hasLegacyPhaseData,
            type: 'arc-variant',
            arcTypeId: this.parseTypeRef(fm['arc-type-ref']),
            conditionsOverride: (fm['conditions-override'] as string) || '',
            commandsOverride: (fm['commands-override'] as string) || '',
            linkedGoals: this.parseLinkedEntities(fm['linked-goals']),
            linkedLimits: this.parseLinkedEntities(fm['linked-limits']),
            linkedEvents: this.parseLinkedEntities(fm['linked-events']),
            linkedModifiers: this.parseLinkedEntities(fm['linked-modifiers']),
        };
    }

    private parseQuestFromFm(fm: Record<string, unknown>, body: string, filePath: string): Quest {
        const phases = this.parseQuestPhases(fm['quest-phases']);
        const description = (fm.description as string) ?? this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            dirty: fm['dirty'] !== false,
            type: 'quest',
            category: (fm['quest-category'] as string) || '',
            phases,
        };
    }

    private parseTypeRef(raw: unknown): string {
        if (typeof raw !== 'string') return '';
        return resolveWikilinkPath(raw);
    }

    private parseBasePhase(p: Record<string, unknown>): DNPhase {
        const name = (p['phase-name'] as string) || '';
        const rawOverrides = typeof p['phase-overrides'] === 'string' ? (p['phase-overrides'] as string) : '';

        let overrides: string[];
        if ('phase-overrides' in p && p['phase-overrides'] !== null && p['phase-overrides'] !== undefined) {
            overrides = rawOverrides ? rawOverrides.split(',').map(s => s.trim()).filter(Boolean) : [];
        } else {
            overrides = [];
            const fieldMap: Array<{ key: string; name: string }> = [
                { key: 'phase-description', name: 'description' },
                { key: 'phase-start-conditions', name: 'startConditions' },
                { key: 'phase-end-conditions', name: 'endConditions' },
                { key: 'phase-start-commands', name: 'startCommands' },
                { key: 'phase-end-commands', name: 'endCommands' },
            ];
            for (const { key, name: fn } of fieldMap) {
                if (typeof p[key] === 'string' && (p[key] as string).trim()) {
                    overrides.push(fn);
                }
            }
        }

        return {
            name,
            description: (p['phase-description'] as string) || '',
            startConditions: (p['phase-start-conditions'] as string) || '',
            startCommands: (p['phase-start-commands'] as string) || '',
            endConditions: (p['phase-end-conditions'] as string) || '',
            endCommands: (p['phase-end-commands'] as string) || '',
            isDefault: isDefaultPhase(name),
            overrides,
        };
    }

    private parseScenarioPhases(raw: unknown): ScenarioPhase[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => ({
            ...this.parseBasePhase(p),
            linkedObjectives: this.parseLinkedChildren(p['linked-objectives']),
        }));
    }

    private parsePlainPhases(raw: unknown): DNPhase[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => this.parseBasePhase(p));
    }

    private parseObjectiveVariantPhases(raw: unknown): ObjectiveVariantPhase[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => ({
            ...this.parseBasePhase(p),
            linkedArcs: this.parseLinkedChildren(p['linked-arcs']),
        }));
    }

    private parseQuestPhases(raw: unknown): QuestPhase[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => this.parseBasePhase(p) as QuestPhase);
    }

    private parseLinkedChildren(raw: unknown): DNLinkedChild[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((item: Record<string, unknown>) => ({
            id: (item['objective-id'] || item['arc-id'] || '') as string,
            isPrimary: item['is-primary'] !== false,
            mandatory: item['mandatory'] === true,
            comment: typeof item['comment'] === 'string' ? item['comment'] : undefined,
        }));
    }

    private parseLinkedEntities(raw: unknown): DNLinkedEntity[] {
        if (!Array.isArray(raw)) return [];
        return raw.flatMap((item: unknown) => {
            if (typeof item === 'string') {
                return item.trim().length > 0 ? [{ id: item }] : [];
            }
            if (!item || typeof item !== 'object') return [];
            const record = item as Record<string, unknown>;
            const id = [record.id, record['quest-id']].find((value): value is string => typeof value === 'string');
            if (!id || id.trim().length === 0) return [];
            return [{
                id,
                comment: typeof record.comment === 'string' && record.comment.trim().length > 0
                    ? record.comment
                    : undefined,
            }];
        });
    }

    private parseStringList(raw: unknown): string[] {
        if (!Array.isArray(raw)) return [];
        return raw.filter((v): v is string => typeof v === 'string');
    }

    private parseNumberList(raw: unknown): number[] {
        if (!Array.isArray(raw)) return [];
        return raw.map(v => Number(v)).filter(n => Number.isFinite(n));
    }

    private extractBodySection(body: string, sectionName: string): string {
        const regex = new RegExp(`#{1,6}\\s+${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, 'i');
        const match = body.match(regex);
        return match ? match[1].trim() : '';
    }

    private titleFromPath(filePath: string): string {
        const name = filePath.split('/').pop() || '';
        return name.replace(/\.md$/i, '');
    }

    // ─── Writing ─────────────────────────────────────────────────

    private buildFrontmatter(entity: DNEntity, bumpModified = true): Record<string, unknown> {
        const fm: Record<string, unknown> = {};
        const shortDesc = deriveShortDesc(entity.description);

        switch (entity.type) {
            case 'scenario': {
                const s = entity as Scenario;
                fm.tags = ['storyline-scenario'];
                fm.title = s.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                fm['scenario-category'] = s.category;
                if (s.linkedActs.length > 0) fm['scenario-acts'] = s.linkedActs;
                if (s.linkedLocations.length > 0) fm['linked-locations'] = s.linkedLocations;
                if (s.linkedCharacters.length > 0) fm['linked-characters'] = s.linkedCharacters;
                if (s.phases.length > 0) {
                    fm['scenario-phases'] = s.phases.map(p => this.serializeScenarioPhase(p));
                }
                break;
            }
            case 'objective-type': {
                const ot = entity as ObjectiveType;
                fm.tags = ['storyline-objective-type'];
                fm.title = ot.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                fm['objective-type-category'] = ot.category;
                if (ot.phases.length > 0) {
                    fm['objective-type-phases'] = ot.phases.map(p => this.serializePlainPhase(p));
                }
                break;
            }
            case 'objective-variant': {
                const ov = entity as ObjectiveVariant;
                fm.tags = ['storyline-objective-variant'];
                fm.title = ov.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                if (ov.objectiveTypeId) fm['objective-type-ref'] = `[[${ov.objectiveTypeId}]]`;
                fm['objective-variant-category'] = ov.category;
                if (ov.linkedLocations.length > 0) fm['linked-locations'] = ov.linkedLocations;
                if (ov.linkedCharacters.length > 0) fm['linked-characters'] = ov.linkedCharacters;
                if (ov.phases.length > 0) {
                    fm['objective-variant-phases'] = ov.phases.map(p => this.serializeObjectiveVariantPhase(p));
                }
                break;
            }
            case 'arc-type': {
                const at = entity as ArcType;
                fm.tags = ['storyline-arc-type'];
                fm.title = at.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                if (at.phases.length > 0) {
                    fm['arc-type-phases'] = at.phases.map(p => this.serializePlainPhase(p));
                }
                break;
            }
            case 'arc-variant': {
                const av = entity as ArcVariant;
                fm.tags = ['storyline-arc-variant'];
                fm.title = av.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                if (av.arcTypeId) fm['arc-type-ref'] = `[[${av.arcTypeId}]]`;
                if (av.conditionsOverride) fm['conditions-override'] = av.conditionsOverride;
                if (av.commandsOverride) fm['commands-override'] = av.commandsOverride;
                if (av.linkedGoals.length > 0) fm['linked-goals'] = this.serializeLinkedEntities(av.linkedGoals);
                if (av.linkedLimits.length > 0) fm['linked-limits'] = this.serializeLinkedEntities(av.linkedLimits);
                if (av.linkedEvents.length > 0) fm['linked-events'] = this.serializeLinkedEntities(av.linkedEvents);
                if (av.linkedModifiers.length > 0) fm['linked-modifiers'] = this.serializeLinkedEntities(av.linkedModifiers);
                break;
            }
            case 'quest': {
                const q = entity as Quest;
                fm.tags = ['storyline-quest'];
                fm.title = q.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                fm['quest-category'] = q.category;
                if (q.phases.length > 0) {
                    fm['quest-phases'] = q.phases.map(p => this.serializePlainPhase(p));
                }
                break;
            }
        }

        fm.description = entity.description;
        fm['dirty'] = entity.dirty === false ? false : true;
        fm.created = entity.created;
        fm.modified = bumpModified ? new Date().toISOString() : entity.modified;
        return fm;
    }

    private serializeBasePhase(p: DNPhase): Record<string, unknown> {
        const obj: Record<string, unknown> = {
            'phase-name': p.name,
            'phase-description': p.description,
            'phase-start-conditions': p.startConditions,
            'phase-end-conditions': p.endConditions,
            'phase-start-commands': p.startCommands,
            'phase-end-commands': p.endCommands,
        };
        if (p.overrides.length > 0) {
            obj['phase-overrides'] = p.overrides.join(',');
        }
        return obj;
    }

    private serializeScenarioPhase(p: ScenarioPhase): Record<string, unknown> {
        const obj = this.serializeBasePhase(p);
        if (p.linkedObjectives.length > 0) {
            obj['linked-objectives'] = p.linkedObjectives.map(c => {
                const linked: Record<string, unknown> = {
                    'objective-id': c.id,
                    'is-primary': c.isPrimary,
                    'mandatory': c.mandatory,
                };
                if (c.comment) linked.comment = c.comment;
                return linked;
            });
        }
        return obj;
    }

    private serializePlainPhase(p: DNPhase): Record<string, unknown> {
        return this.serializeBasePhase(p);
    }

    private serializeObjectiveVariantPhase(p: ObjectiveVariantPhase): Record<string, unknown> {
        const obj = this.serializeBasePhase(p);
        if (p.linkedArcs.length > 0) {
            obj['linked-arcs'] = p.linkedArcs.map(c => {
                const linked: Record<string, unknown> = {
                    'arc-id': c.id,
                    'is-primary': c.isPrimary,
                    'mandatory': c.mandatory,
                };
                if (c.comment) linked.comment = c.comment;
                return linked;
            });
        }
        return obj;
    }

    private serializeLinkedEntities(links: DNLinkedEntity[]): Array<Record<string, unknown>> {
        return links.map(link => {
            const result: Record<string, unknown> = { 'quest-id': link.id };
            if (link.comment) result.comment = link.comment;
            return result;
        });
    }

    private stripFrontmatter(content: string): string {
        const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
        return fmMatch ? content.slice(fmMatch[0].length) : content;
    }

    private buildSkeletonBody(): string {
        return `> [!WARNING] Do not modify this file
> Changes made to this file won't be reflected in the metadata and can be overwritten by future exports. Only make changes and add comments using the Plugin and its UI

# Overview

## Phases
`;
    }

    private toMarkdownWikilink(link: string): string {
        const trimmed = link.trim();
        if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) return trimmed;
        return `[[${trimmed.replace(/^\[\[|\]\]$/g, '')}]]`;
    }

    private appendLinkedMarkdownSection(body: string, heading: string, links: string[]): string {
        const validLinks = links.filter(link => link.trim().length > 0);
        if (validLinks.length === 0) return body;
        let result = `${body}#### ${heading}\n`;
        for (const link of validLinks) {
            result += `- ${this.toMarkdownWikilink(link)}\n`;
        }
        return result;
    }

    private appendLinkedChildMarkdownSection(body: string, heading: string, children: DNLinkedChild[]): string {
        const validChildren = children.filter(child => child.id.trim().length > 0);
        if (validChildren.length === 0) return body;
        let result = `${body}#### ${heading}\n`;
        for (const child of validChildren) {
            const annotations: string[] = [];
            annotations.push(child.isPrimary ? 'Primary' : 'Secondary');
            if (child.mandatory) annotations.push('Mandatory');
            const suffix = annotations.length > 0 ? ` (${annotations.join(', ')})` : '';
            result += `- ${this.toMarkdownWikilink(child.id)}${suffix}\n`;
        }
        return result;
    }

    private buildReflectedBody(entity: DNEntity): string {
        let body = `> [!WARNING] Do not modify this file
> Changes made to this file won't be reflected in the metadata and can be overwritten by future exports. Only make changes and add comments using the Plugin and its UI

# Overview
${entity.description}
`;

        if (entity.type === 'arc-variant') {
            const arc = entity as ArcVariant;
            body += `\n## Conditions Override\n${arc.conditionsOverride}\n`;
            body += `\n## Commands Override\n${arc.commandsOverride}\n`;
            for (const [heading, links] of [
                ['Goals', arc.linkedGoals],
                ['Limits', arc.linkedLimits],
                ['Events', arc.linkedEvents],
                ['Modifiers', arc.linkedModifiers],
            ] as Array<[string, DNLinkedEntity[]]>) {
                const validLinks = links.filter(link => link.id.trim().length > 0);
                if (validLinks.length === 0) continue;
                body += `\n## ${heading}\n`;
                for (const link of validLinks) {
                    body += `- ${this.toMarkdownWikilink(link.id)}\n`;
                }
            }
            return body;
        }

        body += '\n## Phases\n';
        for (const phase of entity.phases) {
            body += `\n### ${phase.name}\n`;
            body += `#### Description\n${phase.description}\n`;
            body += `#### Start Conditions\n${phase.startConditions}\n`;
            body += `#### Start Commands\n${phase.startCommands}\n`;
            body += `#### End Conditions\n${phase.endConditions}\n`;
            body += `#### End Commands\n${phase.endCommands}\n`;

            switch (entity.type) {
                case 'scenario':
                    body = this.appendLinkedChildMarkdownSection(body, 'Linked Objectives', (phase as ScenarioPhase).linkedObjectives);
                    break;
                case 'objective-variant':
                    body = this.appendLinkedChildMarkdownSection(body, 'Linked Arcs', (phase as ObjectiveVariantPhase).linkedArcs);
                    break;
            }
        }
        return body;
    }

    private async writeEntityFile(entity: DNEntity): Promise<void> {
        try {
            const file = this.app.vault.getAbstractFileByPath(entity.filePath);
            let body = entity.type === 'arc-variant'
                ? this.buildReflectedBody(entity)
                : this.buildSkeletonBody();
            if (file && file instanceof TFile) {
                const existing = await this.app.vault.read(file);
                body = this.stripFrontmatter(existing);
            }

            const fm = this.buildFrontmatter(entity);
            const content = `---\n${stringifyYaml(fm)}---\n${body}`;

            if (file && file instanceof TFile) {
                await this.app.vault.modify(file, content);
            } else {
                const dir = entity.filePath.substring(0, entity.filePath.lastIndexOf('/'));
                await this.ensureFolder(dir);
                await this.app.vault.create(entity.filePath, content);
            }
        } catch (e) {
            console.error('[StoryLine] Failed to write entity file:', entity.filePath, e);
            new Notice(`Failed to save ${entity.title}: ${(e as Error).message || 'Unknown error'}`);
        }
    }

    private async syncEntityBody(entity: DNEntity): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(entity.filePath);
        if (!(file instanceof TFile)) return;
        entity.dirty = false;
        const fm = this.buildFrontmatter(entity, false);
        const content = `---\n${stringifyYaml(fm)}---\n${this.buildReflectedBody(entity)}`;
        await this.app.vault.modify(file, content);
    }

    async syncAllDirtyBodies(onProgress?: (done: number, total: number, filePath: string) => void): Promise<number> {
        const all: DNEntity[] = [
            ...this.scenarios.values(),
            ...this.objectiveTypes.values(),
            ...this.objectiveVariants.values(),
            ...this.arcTypes.values(),
            ...this.arcVariants.values(),
            ...this.quests.values(),
        ];
        const dirty = all.filter(e => e.dirty === true);
        let done = 0;
        for (const entity of dirty) {
            try {
                await this.syncEntityBody(entity);
            } catch (e) {
                console.error('[StoryLine] Failed to sync entity body:', entity.filePath, e);
                new Notice(`Failed to sync ${entity.title}: ${(e as Error).message || 'Unknown error'}`);
            }
            done++;
            if (onProgress) onProgress(done, dirty.length, entity.filePath);
        }
        await this.saveSystemJson();
        return dirty.length;
    }

    private async doRenameFile(oldPath: string, newTitle: string, typeFolder: string): Promise<string> {
        const safeName = newTitle.replace(/[\\/:*?"<>|]/g, '-');
        const folder = normalizePath(`${this.projectFolder}/${typeFolder}`);
        const newPath = this.getUniquePath(folder, `${safeName}.md`);

        const file = this.app.vault.getAbstractFileByPath(oldPath);
        if (file && file instanceof TFile) {
            try {
                await this.app.vault.rename(file, newPath);
            } catch (e) {
                console.error('[StoryLine] Failed to rename entity file:', oldPath, '->', newPath, e);
            }
        }

        return newPath;
    }

    // ─── Generic CRUD helpers ────────────────────────────────────

    private getFolderForType(entityType: DNEntityType): string {
        switch (entityType) {
            case 'scenario': return 'Scenarios';
            case 'objective-type': return 'ObjectiveTypes';
            case 'objective-variant': return 'ObjectiveVariants';
            case 'arc-type': return 'ArcTypes';
            case 'arc-variant': return 'ArcVariants';
            case 'quest': return 'Quests';
        }
    }

    private async createEntity<T extends DNEntity>(entity: T): Promise<T> {
        entity.created = new Date().toISOString();
        entity.modified = new Date().toISOString();
        entity.dirty = true;

        const safeName = entity.title.replace(/[\\/:*?"<>|]/g, '-');
        const folder = normalizePath(`${this.projectFolder}/${DN_FOLDER_NAME}/${this.getFolderForType(entity.type)}`);
        entity.filePath = this.getUniquePath(folder, `${safeName}.md`);

        await this.writeEntityFile(entity);
        this.getMapForType(entity.type).set(entity.filePath, entity);
        await this.saveSystemJson();
        return entity;
    }

    private async updateEntityCommon(filePath: string, updates: Record<string, unknown>, label: string): Promise<DNEntity | undefined> {
        const entity = this.getEntity(filePath);
        if (!entity) return undefined;

        const oldSnap = deepClone(entity);

        let currentPath = filePath;
        if (updates.title !== undefined && updates.title !== entity.title) {
            currentPath = await this.doRenameFile(filePath, updates.title as string, `${DN_FOLDER_NAME}/${this.getFolderForType(entity.type)}`);
            entity.filePath = currentPath;
            this.getMapForType(entity.type).delete(filePath);
            this.getMapForType(entity.type).set(currentPath, entity);
            await this.cascadeRename(filePath, currentPath);
        }

        Object.assign(entity, updates);
        entity.modified = new Date().toISOString();
        entity.dirty = true;

        this.plugin.sceneManager.undoManager.recordUpdate(
            currentPath,
            oldSnap as unknown as Record<string, unknown>,
            updates,
            `Update ${label} "${entity.title}"`
        );

        await this.writeEntityFile(entity);
        this.getMapForType(entity.type).set(currentPath, entity);
        await this.saveSystemJson();
        return entity;
    }

    private async deleteEntityCommon(filePath: string, label: string): Promise<void> {
        const entity = this.getEntity(filePath);
        if (!entity) return;

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file && file instanceof TFile) {
            const content = await this.app.vault.read(file);
            this.plugin.sceneManager.undoManager.recordDelete(
                filePath,
                content,
                `Delete ${label} "${entity.title}"`
            );
            await this.app.vault.delete(file);
        }

        this.getMapForType(entity.type).delete(filePath);
        await this.saveSystemJson();
    }

    // ─── CRUD: Scenarios ─────────────────────────────────────────

    async createScenario(data: Partial<Scenario>): Promise<Scenario> {
        const entity = createEmptyScenario(data.title || 'New Scenario');
        Object.assign(entity, data);
        entity.type = 'scenario';
        return this.createEntity(entity);
    }

    async updateScenario(filePath: string, updates: Partial<Scenario>): Promise<void> {
        await this.updateEntityCommon(filePath, updates as Record<string, unknown>, 'scenario');
    }

    async deleteScenario(filePath: string): Promise<void> {
        await this.deleteEntityCommon(filePath, 'scenario');
    }

    // ─── CRUD: Objective Types ───────────────────────────────────

    async createObjectiveType(data: Partial<ObjectiveType>): Promise<ObjectiveType> {
        const entity = createEmptyObjectiveType(data.title || 'New Objective Type');
        Object.assign(entity, data);
        entity.type = 'objective-type';
        if (!entity.phases || entity.phases.length === 0) {
            entity.phases = createDefaultPhases();
        }
        return this.createEntity(entity);
    }

    async updateObjectiveType(filePath: string, updates: Partial<ObjectiveType>): Promise<ObjectiveType | undefined> {
        const entity = this.objectiveTypes.get(filePath);
        if (!entity) return undefined;
        const phasesBefore = entity.phases.map(p => p.name);
        const updatedEntity = await this.updateEntityCommon(filePath, updates as Record<string, unknown>, 'objective type');
        const updated = this.objectiveTypes.get(entity.filePath);
        if (updated) {
            await this.propagateTypePhaseChanges(updated, phasesBefore);
        }
        return updatedEntity as ObjectiveType | undefined;
    }

    async deleteObjectiveType(filePath: string): Promise<boolean> {
        const dependents = this.getObjectiveVariantsOfType(filePath);
        if (dependents.length > 0) {
            new Notice(`Cannot delete: ${dependents.length} objective variant(s) still reference this type.`);
            return false;
        }
        await this.deleteEntityCommon(filePath, 'objective type');
        return true;
    }

    // ─── CRUD: Objective Variants ────────────────────────────────

    async createObjectiveVariant(data: Partial<ObjectiveVariant>): Promise<ObjectiveVariant> {
        const entity = createEmptyObjectiveVariant(data.title || 'New Objective Variant', data.objectiveTypeId || '');
        Object.assign(entity, data);
        entity.type = 'objective-variant';
        this.syncObjectiveVariantPhases(entity);
        return this.createEntity(entity);
    }

    async updateObjectiveVariant(filePath: string, updates: Partial<ObjectiveVariant>): Promise<void> {
        await this.updateEntityCommon(filePath, updates as Record<string, unknown>, 'objective variant');
    }

    async deleteObjectiveVariant(filePath: string): Promise<void> {
        await this.deleteEntityCommon(filePath, 'objective variant');
    }

    // ─── CRUD: Arc Types ─────────────────────────────────────────

    async createArcType(data: Partial<ArcType>): Promise<ArcType> {
        const entity = createEmptyArcType(data.title || 'New Arc Type');
        Object.assign(entity, data);
        delete (entity as ArcType & { category?: unknown }).category;
        entity.type = 'arc-type';
        if (!entity.phases || entity.phases.length === 0) {
            entity.phases = createDefaultPhases();
        }
        return this.createEntity(entity);
    }

    async updateArcType(filePath: string, updates: Partial<ArcType>): Promise<ArcType | undefined> {
        const entity = this.arcTypes.get(filePath);
        if (!entity) return undefined;
        const phasesBefore = entity.phases.map(p => p.name);
        const cleanUpdates = { ...updates } as Partial<ArcType> & { category?: unknown };
        delete cleanUpdates.category;
        const updatedEntity = await this.updateEntityCommon(filePath, cleanUpdates as Record<string, unknown>, 'arc type');
        const updated = this.arcTypes.get(entity.filePath);
        if (updated) {
            await this.propagateTypePhaseChanges(updated, phasesBefore);
        }
        return updatedEntity as ArcType | undefined;
    }

    async deleteArcType(filePath: string): Promise<boolean> {
        const dependents = this.getArcVariantsOfType(filePath);
        if (dependents.length > 0) {
            new Notice(`Cannot delete: ${dependents.length} arc variant(s) still reference this type.`);
            return false;
        }
        await this.deleteEntityCommon(filePath, 'arc type');
        return true;
    }

    // ─── CRUD: Arc Variants ──────────────────────────────────────

    async createArcVariant(data: Partial<ArcVariant>): Promise<ArcVariant> {
        const entity = createEmptyArcVariant(data.title || 'New Arc Variant', data.arcTypeId || '');
        Object.assign(entity, data);
        const legacyFields = entity as ArcVariant & {
            category?: unknown;
            linkedLocations?: unknown;
            dynamicLocations?: unknown;
            phases?: unknown;
        };
        delete legacyFields.category;
        delete legacyFields.linkedLocations;
        delete legacyFields.dynamicLocations;
        delete legacyFields.phases;
        entity.conditionsOverride = typeof entity.conditionsOverride === 'string' ? entity.conditionsOverride : '';
        entity.commandsOverride = typeof entity.commandsOverride === 'string' ? entity.commandsOverride : '';
        entity.linkedGoals = this.parseLinkedEntities(entity.linkedGoals);
        entity.linkedLimits = this.parseLinkedEntities(entity.linkedLimits);
        entity.linkedEvents = this.parseLinkedEntities(entity.linkedEvents);
        entity.linkedModifiers = this.parseLinkedEntities(entity.linkedModifiers);
        entity.type = 'arc-variant';
        return this.createEntity(entity);
    }

    async updateArcVariant(filePath: string, updates: Partial<ArcVariant>): Promise<void> {
        const cleanUpdates = { ...updates } as Partial<ArcVariant> & {
            category?: unknown;
            linkedLocations?: unknown;
            dynamicLocations?: unknown;
            phases?: unknown;
        };
        delete cleanUpdates.category;
        delete cleanUpdates.linkedLocations;
        delete cleanUpdates.dynamicLocations;
        delete cleanUpdates.phases;
        for (const listKey of QUEST_LINK_LISTS) {
            if (listKey in cleanUpdates) {
                cleanUpdates[listKey] = this.parseLinkedEntities(cleanUpdates[listKey]);
            }
        }
        await this.updateEntityCommon(filePath, cleanUpdates as Record<string, unknown>, 'arc variant');
    }

    async deleteArcVariant(filePath: string): Promise<void> {
        await this.deleteEntityCommon(filePath, 'arc variant');
    }

    // ─── CRUD: Quests ────────────────────────────────────────────

    async createQuest(data: Partial<Quest>): Promise<Quest> {
        const entity = createEmptyQuest(data.title || 'New Quest');
        Object.assign(entity, data);
        entity.type = 'quest';
        return this.createEntity(entity);
    }

    async updateQuest(filePath: string, updates: Partial<Quest>): Promise<Quest | undefined> {
        const updated = await this.updateEntityCommon(filePath, updates as Record<string, unknown>, 'quest');
        return updated as Quest | undefined;
    }

    async deleteQuest(filePath: string): Promise<void> {
        await this.deleteEntityCommon(filePath, 'quest');
    }

    entityTitleExists(entityType: DNEntityType, title: string, excludePath = ''): boolean {
        const normalizedTitle = title.trim().toLowerCase();
        if (!normalizedTitle) return false;
        return Array.from(this.getMapForType(entityType).values()).some(entity =>
            entity.filePath !== excludePath && entity.title.trim().toLowerCase() === normalizedTitle,
        );
    }

    async cloneEntity(sourcePath: string, newTitle: string): Promise<DNEntity | undefined> {
        const source = this.getEntity(sourcePath);
        if (!source) return undefined;
        const title = newTitle.trim();
        if (!title || title.toLowerCase() === source.title.trim().toLowerCase()) return undefined;
        if (this.entityTitleExists(source.type, title, source.filePath)) return undefined;

        const clone = deepClone(source);
        clone.title = title;
        clone.filePath = '';
        clone.created = '';
        clone.modified = '';
        clone.dirty = true;
        return this.createEntity(clone);
    }

    async pasteLinksIntoPhase(
        parentPath: string,
        phaseName: string,
        entries: DNClipboardPhaseEntry[],
        mode: DNPasteMode,
    ): Promise<number> {
        const parent = this.getEntity(parentPath);
        let links: DNLinkedChild[] | undefined;
        let childType: 'objective-variant' | 'arc-variant';

        if (parent?.type === 'scenario') {
            links = parent.phases.find(phase => phase.name === phaseName)?.linkedObjectives;
            childType = 'objective-variant';
        } else if (parent?.type === 'objective-variant') {
            links = parent.phases.find(phase => phase.name === phaseName)?.linkedArcs;
            childType = 'arc-variant';
        } else {
            return 0;
        }

        if (!links) return 0;

        const makeLink = (entry: DNClipboardPhaseEntry): DNLinkedChild | null => {
            const path = resolveWikilinkPath(entry.path);
            if (this.getEntity(path)?.type !== childType) return null;
            const link: DNLinkedChild = {
                id: `[[${path}]]`,
                isPrimary: entry.isPrimary,
                mandatory: entry.mandatory,
            };
            const comment = entry.comment?.trim();
            if (comment) link.comment = comment;
            return link;
        };

        if (mode === 'overwrite') {
            const replacement = entries.map(makeLink).filter((link): link is DNLinkedChild => link !== null);
            links.splice(0, links.length, ...replacement);
            await this.writeEntityFile(parent);
            await this.saveSystemJson();
            return replacement.length;
        }

        let added = 0;
        for (const entry of entries) {
            const link = makeLink(entry);
            if (!link) continue;
            const path = resolveWikilinkPath(link.id);
            const alreadyPresent = mode === 'unique'
                ? links.some(existing => resolveWikilinkPath(existing.id) === path)
                : links.some(existing =>
                    resolveWikilinkPath(existing.id) === path
                    && (existing.comment?.trim() ?? '') === (link.comment?.trim() ?? ''),
                );
            if (alreadyPresent) continue;
            links.push(link);
            added++;
        }

        if (added > 0) {
            await this.writeEntityFile(parent);
            await this.saveSystemJson();
        }
        return added;
    }

    async pasteLinksIntoQuestList(
        arcPath: string,
        listKey: DNArcVariantQuestList,
        entries: DNClipboardQuestEntry[],
        mode: DNPasteMode,
    ): Promise<number> {
        const arc = this.arcVariants.get(arcPath);
        if (!arc) return 0;

        const links = arc[listKey];
        const otherListPaths = new Set(
            QUEST_LINK_LISTS
                .filter(key => key !== listKey)
                .flatMap(key => arc[key].map(link => resolveWikilinkPath(link.id))),
        );
        const makeLink = (entry: DNClipboardQuestEntry): DNLinkedEntity | null => {
            const path = resolveWikilinkPath(entry.path);
            if (this.getEntity(path)?.type !== 'quest') return null;
            const link: DNLinkedEntity = { id: `[[${path}]]` };
            const comment = entry.comment?.trim();
            if (comment) link.comment = comment;
            return link;
        };

        if (mode === 'overwrite') {
            const seen = new Set<string>();
            const replacement: DNLinkedEntity[] = [];
            for (const entry of entries) {
                const link = makeLink(entry);
                if (!link) continue;
                const path = resolveWikilinkPath(link.id);
                if (seen.has(path) || otherListPaths.has(path)) continue;
                seen.add(path);
                replacement.push(link);
            }
            links.splice(0, links.length, ...replacement);
            await this.writeEntityFile(arc);
            await this.saveSystemJson();
            return replacement.length;
        }

        const existingPaths = new Set(
            QUEST_LINK_LISTS.flatMap(key => arc[key].map(link => resolveWikilinkPath(link.id))),
        );
        let added = 0;
        for (const entry of entries) {
            const link = makeLink(entry);
            if (!link) continue;
            const path = resolveWikilinkPath(link.id);
            if (existingPaths.has(path)) continue;
            existingPaths.add(path);
            links.push(link);
            added++;
        }

        if (added > 0) {
            await this.writeEntityFile(arc);
            await this.saveSystemJson();
        }
        return added;
    }

    // ─── Type → Variant phase synchronization ────────────────────

    getObjectiveVariantsOfType(typePath: string): ObjectiveVariant[] {
        return this.getAllObjectiveVariants().filter(v => v.objectiveTypeId === typePath);
    }

    getArcVariantsOfType(typePath: string): ArcVariant[] {
        return this.getAllArcVariants().filter(v => v.arcTypeId === typePath);
    }

    private syncObjectiveVariantPhases(variant: ObjectiveVariant): void {
        const type = this.objectiveTypes.get(variant.objectiveTypeId);
        if (!type) return;
        const orderedTypePhases = getOrderedPhases(type.phases, true);
        const result: ObjectiveVariantPhase[] = [];
        for (const tp of orderedTypePhases) {
            const existing = variant.phases.find(p => p.name === tp.name);
            if (existing) {
                result.push({ ...existing, isDefault: tp.isDefault });
            } else {
                result.push({
                    name: tp.name,
                    description: '',
                    startConditions: '',
                    startCommands: '',
                    endConditions: '',
                    endCommands: '',
                    isDefault: tp.isDefault,
                    overrides: [],
                    linkedArcs: [],
                });
            }
        }
        variant.phases = result;
    }

    private syncAllVariants(): void {
        for (const variant of this.objectiveVariants.values()) {
            this.syncObjectiveVariantPhases(variant);
        }
    }

    private async propagateTypePhaseChanges(type: ObjectiveType | ArcType, phasesBefore: string[]): Promise<void> {
        const phasesAfter = type.phases.map(p => p.name);
        const removed = phasesBefore.filter(n => !phasesAfter.includes(n));
        const added = phasesAfter.filter(n => !phasesBefore.includes(n));
        if (removed.length === 0 && added.length === 0) return;

        if (type.type === 'objective-type') {
            for (const variant of this.getObjectiveVariantsOfType(type.filePath)) {
                this.syncObjectiveVariantPhases(variant);
                await this.writeEntityFile(variant);
            }
        }
        await this.saveSystemJson();
    }

    // ─── Auto-linking (create + link) ────────────────────────────

    async createAndLinkObjectiveVariant(scenarioPath: string, phaseName: string, typeId: string, data: Partial<ObjectiveVariant>): Promise<ObjectiveVariant> {
        const variant = await this.createObjectiveVariant({ ...data, objectiveTypeId: typeId });
        await this.linkExistingObjectiveVariant(scenarioPath, phaseName, variant.filePath);
        return variant;
    }

    async createAndLinkArcVariant(objectiveVariantPath: string, phaseName: string, typeId: string, data: Partial<ArcVariant>): Promise<ArcVariant> {
        const variant = await this.createArcVariant({ ...data, arcTypeId: typeId });
        await this.linkExistingArcVariant(objectiveVariantPath, phaseName, variant.filePath);
        return variant;
    }

    async createAndLinkQuest(arcVariantPath: string, category: string, data: Partial<Quest>): Promise<Quest> {
        const quest = await this.createQuest({ ...data, category });
        await this.linkExistingQuest(arcVariantPath, quest.filePath);
        return quest;
    }

    // ─── Linking existing entities ───────────────────────────────

    async linkExistingObjectiveVariant(scenarioPath: string, phaseName: string, variantPath: string): Promise<boolean> {
        const scenario = this.scenarios.get(scenarioPath);
        const variant = this.objectiveVariants.get(variantPath);
        if (!scenario || !variant) return false;

        const phase = scenario.phases.find(p => p.name === phaseName);
        if (!phase) return false;

        const wikilink = `[[${variantPath}]]`;

        phase.linkedObjectives.push({ id: wikilink, isPrimary: true, mandatory: false });
        await this.writeEntityFile(scenario);
        await this.saveSystemJson();
        return true;
    }

    async linkExistingArcVariant(objectiveVariantPath: string, phaseName: string, variantPath: string): Promise<boolean> {
        const objective = this.objectiveVariants.get(objectiveVariantPath);
        const variant = this.arcVariants.get(variantPath);
        if (!objective || !variant) return false;

        const phase = objective.phases.find(p => p.name === phaseName);
        if (!phase) return false;

        const wikilink = `[[${variantPath}]]`;

        phase.linkedArcs.push({ id: wikilink, isPrimary: true, mandatory: false });
        await this.writeEntityFile(objective);
        await this.saveSystemJson();
        return true;
    }

    async linkExistingQuest(arcVariantPath: string, questPath: string): Promise<boolean> {
        const arc = this.arcVariants.get(arcVariantPath);
        const quest = this.quests.get(questPath);
        if (!arc || !quest) return false;

        const wikilink = `[[${questPath}]]`;
        if (QUEST_LINK_LISTS.some(key => arc[key].some(link => resolveWikilinkPath(link.id) === questPath))) return false;
        const listKey = this.getQuestListKey(quest.category);
        const list = arc[listKey];
        list.push({ id: wikilink });

        await this.writeEntityFile(arc);
        await this.saveSystemJson();
        return true;
    }

    async unlinkQuestFromArcVariant(arcVariantPath: string, questPath: string): Promise<boolean> {
        const arc = this.arcVariants.get(arcVariantPath);
        if (!arc) return false;

        let changed = false;
        for (const listKey of QUEST_LINK_LISTS) {
            const list = arc[listKey];
            const filtered = list.filter(link => resolveWikilinkPath(link.id) !== questPath);
            if (filtered.length !== list.length) {
                arc[listKey] = filtered;
                changed = true;
            }
        }
        if (!changed) return false;

        await this.writeEntityFile(arc);
        await this.saveSystemJson();
        return true;
    }

    async updateLinkedComment(parentPath: string, target: DNLinkedCommentTarget, comment: string): Promise<boolean> {
        const parent = this.getEntity(parentPath);
        if (!parent || target.index < 0) return false;

        let link: DNLinkedEntity | undefined;
        if (target.kind === 'phase' && parent.type === 'scenario') {
            const phase = (parent as Scenario).phases.find(p => p.name === target.phaseName);
            link = phase?.linkedObjectives[target.index];
        } else if (target.kind === 'phase' && parent.type === 'objective-variant') {
            const phase = (parent as ObjectiveVariant).phases.find(p => p.name === target.phaseName);
            link = phase?.linkedArcs[target.index];
        } else if (target.kind === 'arc-variant' && parent.type === 'arc-variant') {
            link = (parent as ArcVariant)[target.listKey][target.index];
        }
        if (!link) return false;

        const normalized = comment.trim().length > 0 ? comment : undefined;
        link.comment = normalized;
        await this.writeEntityFile(parent);
        await this.saveSystemJson();
        return true;
    }

    async unlinkLinkedChildFromPhase(parentPath: string, phaseName: string, index: number): Promise<boolean> {
        const parent = this.getEntity(parentPath);
        if (!parent || index < 0) return false;

        if (parent.type === 'scenario') {
            const scenario = parent as Scenario;
            const phase = scenario.phases.find(p => p.name === phaseName);
            if (!phase || index >= phase.linkedObjectives.length) return false;
            phase.linkedObjectives.splice(index, 1);
        } else if (parent.type === 'objective-variant') {
            const objective = parent as ObjectiveVariant;
            const phase = objective.phases.find(p => p.name === phaseName);
            if (!phase || index >= phase.linkedArcs.length) return false;
            phase.linkedArcs.splice(index, 1);
        } else {
            return false;
        }

        await this.writeEntityFile(parent);
        await this.saveSystemJson();
        return true;
    }

    private getQuestListKey(category: string): 'linkedGoals' | 'linkedLimits' | 'linkedEvents' | 'linkedModifiers' {
        switch (category) {
            case 'Goal': return 'linkedGoals';
            case 'Limit': return 'linkedLimits';
            case 'Event': return 'linkedEvents';
            case 'Modifier': return 'linkedModifiers';
            default: return 'linkedGoals';
        }
    }

    // ─── Hierarchy Queries ───────────────────────────────────────

    getLinkedObjectiveVariants(scenarioPath: string, phaseName?: string): DNLinkedChild[] {
        const scenario = this.scenarios.get(scenarioPath);
        if (!scenario) return [];
        if (phaseName) {
            const phase = scenario.phases.find(p => p.name === phaseName);
            return phase ? phase.linkedObjectives : [];
        }
        return scenario.phases.flatMap(p => p.linkedObjectives);
    }

    getLinkedArcVariants(objectiveVariantPath: string, phaseName?: string): DNLinkedChild[] {
        const objective = this.objectiveVariants.get(objectiveVariantPath);
        if (!objective) return [];
        if (phaseName) {
            const phase = objective.phases.find(p => p.name === phaseName);
            return phase ? phase.linkedArcs : [];
        }
        return objective.phases.flatMap(p => p.linkedArcs);
    }

    getLinkedQuests(arcVariantPath: string): string[] {
        const arc = this.arcVariants.get(arcVariantPath);
        if (!arc) return [];
        return [
            ...arc.linkedGoals,
            ...arc.linkedLimits,
            ...arc.linkedEvents,
            ...arc.linkedModifiers,
        ].map(link => link.id);
    }

    getConnectionsForQuest(questPath: string): { scenarios: number; objectives: number; arcs: number } {
        let arcs = 0;
        let objectives = 0;
        const connectedObjectivePaths = new Set<string>();
        const connectedScenarioPaths = new Set<string>();

        for (const arc of this.arcVariants.values()) {
            if (QUEST_LINK_LISTS.some(listKey => arc[listKey].some(link => resolveWikilinkPath(link.id) === questPath))) {
                arcs++;
            }
        }

        for (const obj of this.objectiveVariants.values()) {
            for (const phase of obj.phases) {
                for (const arcRef of phase.linkedArcs) {
                    const arcPath = resolveWikilinkPath(arcRef.id);
                    const arc = this.arcVariants.get(arcPath);
                    if (!arc) continue;
                    if (QUEST_LINK_LISTS.some(listKey => arc[listKey].some(link => resolveWikilinkPath(link.id) === questPath))) {
                        if (!connectedObjectivePaths.has(obj.filePath)) {
                            connectedObjectivePaths.add(obj.filePath);
                            objectives++;
                        }
                    }
                }
            }
        }

        for (const scenario of this.scenarios.values()) {
            for (const phase of scenario.phases) {
                for (const objRef of phase.linkedObjectives) {
                    const objPath = resolveWikilinkPath(objRef.id);
                    if (connectedObjectivePaths.has(objPath)) {
                        if (!connectedScenarioPaths.has(scenario.filePath)) {
                            connectedScenarioPaths.add(scenario.filePath);
                        }
                        break;
                    }
                }
            }
        }

        return {
            scenarios: connectedScenarioPaths.size,
            objectives,
            arcs,
        };
    }

    // ─── Phase Management ────────────────────────────────────────

    addCustomPhase(entity: DNEntity, phase: DNPhase): void {
        if (entity.type === 'objective-variant' || entity.type === 'arc-variant') return;
        const newPhase = { ...phase, isDefault: false };
        switch (entity.type) {
            case 'scenario':
                (entity as Scenario).phases.push({ ...newPhase, linkedObjectives: [] } as ScenarioPhase);
                break;
            case 'objective-type':
            case 'arc-type':
            case 'quest':
                (entity as ObjectiveType | ArcType | Quest).phases.push(deepClone(newPhase));
                break;
        }
    }

    removeCustomPhase(entity: DNEntity, phaseName: string): void {
        if (isDefaultPhase(phaseName) || entity.type === 'objective-variant' || entity.type === 'arc-variant') return;
        switch (entity.type) {
            case 'scenario':
                (entity as Scenario).phases = (entity as Scenario).phases.filter(p => p.name !== phaseName);
                break;
            case 'objective-type':
            case 'arc-type':
            case 'quest':
                (entity as ObjectiveType | ArcType | Quest).phases = (entity as ObjectiveType | ArcType | Quest).phases.filter(p => p.name !== phaseName);
                break;
        }
    }

    renameCustomPhase(entity: DNEntity, oldName: string, newName: string): void {
        if (isDefaultPhase(oldName) || entity.type === 'objective-variant' || entity.type === 'arc-variant') return;
        const phases = this.getPhases(entity);
        const phase = phases.find(p => p.name === oldName);
        if (phase) {
            phase.name = newName;
        }
    }

    /**
     * Add a custom phase to an Objective/Arc type. Objective Variant phase
     * changes are propagated; Arc Variants read their phases from the type.
     */
    async addTypePhase(type: ObjectiveType | ArcType, phase: DNPhase): Promise<void> {
        const phasesBefore = this.getPhases(type).map(p => p.name);
        this.addCustomPhase(type, phase);
        type.modified = new Date().toISOString();
        await this.writeEntityFile(type);
        await this.propagateTypePhaseChanges(type, phasesBefore);
    }

    /**
     * Remove a custom phase from an Objective/Arc type. Objective Variant
     * phase changes are propagated; Arc Variants read their phases from the type.
     */
    async removeTypePhase(type: ObjectiveType | ArcType, phaseName: string): Promise<void> {
        if (isDefaultPhase(phaseName)) return;
        const phasesBefore = this.getPhases(type).map(p => p.name);
        this.removeCustomPhase(type, phaseName);
        type.modified = new Date().toISOString();
        await this.writeEntityFile(type);
        await this.propagateTypePhaseChanges(type, phasesBefore);
    }

    /**
     * Rename a custom phase on an Objective/Arc type and propagate the new
     * name to every existing Objective Variant.
     */
    async renameTypePhase(type: ObjectiveType | ArcType, oldName: string, newName: string): Promise<void> {
        if (isDefaultPhase(oldName)) return;
        this.renameCustomPhase(type, oldName, newName);
        type.modified = new Date().toISOString();
        await this.writeEntityFile(type);
        if (type.type === 'objective-type') {
            for (const variant of this.getObjectiveVariantsOfType(type.filePath)) {
                const phase = variant.phases.find(p => p.name === oldName);
                if (phase) phase.name = newName;
                variant.modified = new Date().toISOString();
                await this.writeEntityFile(variant);
            }
        }
        await this.saveSystemJson();
    }

    reorderCustomPhases(entity: DNEntity, fromIndex: number, toIndex: number): void {
        if (entity.type === 'objective-variant' || entity.type === 'arc-variant') return;
        const phases = this.getPhases(entity);
        const customs = phases.filter(p => !p.isDefault);
        const [moved] = customs.splice(fromIndex, 1);
        if (!moved) return;
        customs.splice(toIndex, 0, moved);

        const defaults = phases.filter(p => p.isDefault);
        const sleeping = defaults.find(p => p.name === 'QuestSleeping');
        const available = defaults.find(p => p.name === 'QuestAvailable');
        const started = defaults.find(p => p.name === 'QuestStarted');
        const completed = defaults.find(p => p.name === 'QuestCompleted');
        const failed = defaults.find(p => p.name === 'QuestFailed');

        const result: DNPhase[] = [];
        if (sleeping) result.push(sleeping);
        if (available) result.push(available);
        if (started) result.push(started);
        result.push(...customs);
        if (completed) result.push(completed);
        if (failed) result.push(failed);

        this.setPhases(entity, result);
    }

    updatePhaseFields(entity: DNEntity, phaseName: string, updates: Partial<DNPhase>): void {
        const phases = this.getPhases(entity);
        const phase = phases.find(p => p.name === phaseName);
        if (phase) {
            Object.assign(phase, updates);
        }
    }

    getOrderedPhasesForEntity(entity: DNEntity): DNPhase[] {
        if (entity.type === 'arc-variant') {
            const type = this.arcTypes.get(entity.arcTypeId);
            return type ? getOrderedPhases(type.phases, true) : [];
        }
        const phases = this.getPhases(entity);
        const hasDefaults = entity.type !== 'scenario';
        return getOrderedPhases(phases, hasDefaults);
    }

    getTypePhaseValue(entity: ObjectiveVariant, phaseName: string, fieldName: string): string {
        const type = this.objectiveTypes.get(entity.objectiveTypeId);
        if (!type) return '';
        const tp = type.phases.find(p => p.name === phaseName);
        if (!tp) return '';
        const value = (tp as unknown as Record<string, unknown>)[fieldName];
        return typeof value === 'string' ? value : '';
    }

    private getPhases(entity: DNEntity): DNPhase[] {
        if (entity.type === 'arc-variant') return [];
        return (entity as Scenario | ObjectiveType | ObjectiveVariant | ArcType | Quest).phases;
    }

    private setPhases(entity: DNEntity, phases: DNPhase[]): void {
        switch (entity.type) {
            case 'scenario':
                (entity as Scenario).phases = phases as ScenarioPhase[];
                break;
            case 'objective-variant':
                (entity as ObjectiveVariant).phases = phases as ObjectiveVariantPhase[];
                break;
            case 'objective-type':
            case 'arc-type':
            case 'quest':
                (entity as ObjectiveType | ArcType | Quest).phases = phases;
                break;
        }
    }

    // ─── Phase Reassignment (drag between columns) ───────────────

    async reassignPhase(parentPath: string, childPath: string, fromPhase: string, toPhase: string, fromIndex?: number): Promise<number | undefined> {
        const parent = this.getEntity(parentPath);
        if (!parent) return;

        const wikilink = `[[${childPath}]]`;

        switch (parent.type) {
            case 'scenario': {
                const scenario = parent as Scenario;
                const fromP = scenario.phases.find(p => p.name === fromPhase);
                const toP = scenario.phases.find(p => p.name === toPhase);
                if (!fromP || !toP) return;
                const indexedLink = fromIndex !== undefined && fromIndex >= 0 && fromIndex < fromP.linkedObjectives.length
                    ? fromP.linkedObjectives[fromIndex]
                    : undefined;
                const idx = indexedLink && resolveWikilinkPath(indexedLink.id) === childPath
                    ? fromIndex as number
                    : fromP.linkedObjectives.findIndex(c => resolveWikilinkPath(c.id) === childPath);
                if (idx < 0 || idx >= fromP.linkedObjectives.length) return;
                const [child] = fromP.linkedObjectives.splice(idx, 1);
                toP.linkedObjectives.push(child);
                break;
            }
            case 'objective-variant': {
                const objective = parent as ObjectiveVariant;
                const fromP = objective.phases.find(p => p.name === fromPhase);
                const toP = objective.phases.find(p => p.name === toPhase);
                if (!fromP || !toP) return;
                const indexedLink = fromIndex !== undefined && fromIndex >= 0 && fromIndex < fromP.linkedArcs.length
                    ? fromP.linkedArcs[fromIndex]
                    : undefined;
                const idx = indexedLink && resolveWikilinkPath(indexedLink.id) === childPath
                    ? fromIndex as number
                    : fromP.linkedArcs.findIndex(c => resolveWikilinkPath(c.id) === childPath);
                if (idx < 0 || idx >= fromP.linkedArcs.length) return;
                const [child] = fromP.linkedArcs.splice(idx, 1);
                toP.linkedArcs.push(child);
                break;
            }
        }

        await this.writeEntityFile(parent);
        await this.saveSystemJson();
        if (parent.type === 'scenario') {
            const toP = (parent as Scenario).phases.find(p => p.name === toPhase);
            return toP ? toP.linkedObjectives.length - 1 : undefined;
        }
        if (parent.type === 'objective-variant') {
            const toP = (parent as ObjectiveVariant).phases.find(p => p.name === toPhase);
            return toP ? toP.linkedArcs.length - 1 : undefined;
        }
        return undefined;
    }

    async toggleLinkPriority(parentPath: string, childPath: string, phaseName: string, isPrimary: boolean, index?: number): Promise<void> {
        const parent = this.getEntity(parentPath);
        if (!parent) return;

        switch (parent.type) {
            case 'scenario': {
                const scenario = parent as Scenario;
                const phase = scenario.phases.find(p => p.name === phaseName);
                if (!phase) return;
                const indexedLink = index !== undefined && index >= 0 && index < phase.linkedObjectives.length
                    ? phase.linkedObjectives[index]
                    : undefined;
                const link = indexedLink && resolveWikilinkPath(indexedLink.id) === childPath
                    ? indexedLink
                    : phase.linkedObjectives.find(c => resolveWikilinkPath(c.id) === childPath);
                if (link) link.isPrimary = isPrimary;
                break;
            }
            case 'objective-variant': {
                const objective = parent as ObjectiveVariant;
                const phase = objective.phases.find(p => p.name === phaseName);
                if (!phase) return;
                const indexedLink = index !== undefined && index >= 0 && index < phase.linkedArcs.length
                    ? phase.linkedArcs[index]
                    : undefined;
                const link = indexedLink && resolveWikilinkPath(indexedLink.id) === childPath
                    ? indexedLink
                    : phase.linkedArcs.find(c => resolveWikilinkPath(c.id) === childPath);
                if (link) link.isPrimary = isPrimary;
                break;
            }
        }

        await this.writeEntityFile(parent);
        await this.saveSystemJson();
    }

    // ─── Cascade Rename ──────────────────────────────────────────

    async cascadeRename(oldPath: string, newPath: string): Promise<void> {
        const oldWikilink = `[[${oldPath}]]`;
        const newWikilink = `[[${newPath}]]`;
        this.updateClipboardPath(oldPath, newPath);

        for (const scenario of this.scenarios.values()) {
            let changed = false;
            for (const phase of scenario.phases) {
                for (const child of phase.linkedObjectives) {
                    if (child.id === oldWikilink) {
                        child.id = newWikilink;
                        changed = true;
                    }
                }
            }
            if (changed) await this.writeEntityFile(scenario);
        }

        for (const objective of this.objectiveVariants.values()) {
            let changed = false;
            if (objective.objectiveTypeId === oldPath) {
                objective.objectiveTypeId = newPath;
                changed = true;
            }
            for (const phase of objective.phases) {
                for (const child of phase.linkedArcs) {
                    if (child.id === oldWikilink) {
                        child.id = newWikilink;
                        changed = true;
                    }
                }
            }
            if (changed) await this.writeEntityFile(objective);
        }

        for (const arc of this.arcVariants.values()) {
            let changed = false;
            if (arc.arcTypeId === oldPath) {
                arc.arcTypeId = newPath;
                changed = true;
            }
            for (const listKey of QUEST_LINK_LISTS) {
                const list = arc[listKey];
                const idx = list.findIndex(link => link.id === oldWikilink);
                if (idx >= 0) {
                    list[idx].id = newWikilink;
                    changed = true;
                }
            }
            if (changed) await this.writeEntityFile(arc);
        }

        await this.saveSystemJson();
    }

    // ─── Category Management ─────────────────────────────────────

    getCategories(entityType: DNEntityType): string[] {
        switch (entityType) {
            case 'scenario':
                return this.plugin.settings.dnScenarioCategories?.length
                    ? this.plugin.settings.dnScenarioCategories
                    : DEFAULT_SCENARIO_CATEGORIES;
            case 'objective-type':
            case 'objective-variant':
                return this.plugin.settings.dnObjectiveCategories?.length
                    ? this.plugin.settings.dnObjectiveCategories
                    : DEFAULT_OBJECTIVE_CATEGORIES;
            case 'arc-type':
            case 'arc-variant':
                return [];
            case 'quest':
                return this.plugin.settings.dnQuestCategories?.length
                    ? this.plugin.settings.dnQuestCategories
                    : DEFAULT_QUEST_CATEGORIES;
        }
    }

    addCategory(entityType: DNEntityType, name: string): void {
        if (entityType === 'arc-type' || entityType === 'arc-variant') return;
        const cats = this.getCategories(entityType);
        if (cats.includes(name)) return;
        cats.push(name);
        this.setCategories(entityType, cats);
    }

    removeCategory(entityType: DNEntityType, name: string): void {
        if (entityType === 'arc-type' || entityType === 'arc-variant') return;
        const defaults = this.getDefaultCategories(entityType);
        if (defaults.includes(name)) return;
        const cats = this.getCategories(entityType).filter(c => c !== name);
        this.setCategories(entityType, cats);
    }

    private getDefaultCategories(entityType: DNEntityType): string[] {
        switch (entityType) {
            case 'scenario': return DEFAULT_SCENARIO_CATEGORIES;
            case 'objective-type':
            case 'objective-variant': return DEFAULT_OBJECTIVE_CATEGORIES;
            case 'arc-type':
            case 'arc-variant': return [];
            case 'quest': return DEFAULT_QUEST_CATEGORIES;
        }
    }

    private setCategories(entityType: DNEntityType, categories: string[]): void {
        switch (entityType) {
            case 'scenario':
                this.plugin.settings.dnScenarioCategories = categories;
                break;
            case 'objective-type':
            case 'objective-variant':
                this.plugin.settings.dnObjectiveCategories = categories;
                break;
            case 'arc-type':
            case 'arc-variant':
                break;
            case 'quest':
                this.plugin.settings.dnQuestCategories = categories;
                break;
        }
        this.plugin.saveSettings();
    }

    // ─── Queries ─────────────────────────────────────────────────

    getAllScenarios(): Scenario[] {
        return Array.from(this.scenarios.values());
    }

    getAllObjectiveTypes(): ObjectiveType[] {
        return Array.from(this.objectiveTypes.values());
    }

    getAllObjectiveVariants(): ObjectiveVariant[] {
        return Array.from(this.objectiveVariants.values());
    }

    getAllArcTypes(): ArcType[] {
        return Array.from(this.arcTypes.values());
    }

    getAllArcVariants(): ArcVariant[] {
        return Array.from(this.arcVariants.values());
    }

    getAllQuests(): Quest[] {
        return Array.from(this.quests.values());
    }

    getQuestsByCategory(category: string): Quest[] {
        return this.getAllQuests().filter(q => q.category === category);
    }

    getObjectiveType(path: string): ObjectiveType | undefined {
        return this.objectiveTypes.get(path);
    }

    getArcType(path: string): ArcType | undefined {
        return this.arcTypes.get(path);
    }

    getEntity(filePath: string): DNEntity | undefined {
        return this.scenarios.get(filePath)
            || this.objectiveTypes.get(filePath)
            || this.objectiveVariants.get(filePath)
            || this.arcTypes.get(filePath)
            || this.arcVariants.get(filePath)
            || this.quests.get(filePath);
    }

    getEntities(entityType: DNEntityType): DNEntity[] {
        return [...this.getMapForType(entityType).values()];
    }

    getEntityType(filePath: string): DNEntityType | null {
        if (this.scenarios.has(filePath)) return 'scenario';
        if (this.objectiveTypes.has(filePath)) return 'objective-type';
        if (this.objectiveVariants.has(filePath)) return 'objective-variant';
        if (this.arcTypes.has(filePath)) return 'arc-type';
        if (this.arcVariants.has(filePath)) return 'arc-variant';
        if (this.quests.has(filePath)) return 'quest';
        return null;
    }


    // ─── Vault Event Handlers ────────────────────────────────────

    handleFileDeleted(filePath: string): void {
        this.removeClipboardPath(filePath);
        let removed = false;
        if (this.scenarios.delete(filePath)) removed = true;
        else if (this.objectiveTypes.delete(filePath)) removed = true;
        else if (this.objectiveVariants.delete(filePath)) removed = true;
        else if (this.arcTypes.delete(filePath)) removed = true;
        else if (this.arcVariants.delete(filePath)) removed = true;
        else if (this.quests.delete(filePath)) removed = true;
        if (removed) {
            void this.saveSystemJson();
        }
    }

    isDNEntityPath(filePath: string): boolean {
        return filePath.includes(`/${DN_FOLDER_NAME}/`);
    }

    getInitialized(): boolean {
        return this.initialized;
    }

    destroy(): void {
        this.scenarios.clear();
        this.objectiveTypes.clear();
        this.objectiveVariants.clear();
        this.arcTypes.clear();
        this.arcVariants.clear();
        this.quests.clear();
        this.dnClipboard = null;
        this.initialized = false;
        this._saveQueue = Promise.resolve();
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private updateClipboardPath(oldPath: string, newPath: string): void {
        if (!this.dnClipboard) return;
        if (this.dnClipboard.kind === 'phase-links') {
            for (const entry of this.dnClipboard.entries) {
                if (resolveWikilinkPath(entry.path) === oldPath) entry.path = newPath;
            }
        } else {
            for (const entry of this.dnClipboard.entries) {
                if (resolveWikilinkPath(entry.path) === oldPath) entry.path = newPath;
            }
        }
    }

    private removeClipboardPath(filePath: string): void {
        const clipboard = this.dnClipboard;
        if (!clipboard) return;
        if (clipboard.kind === 'phase-links') {
            const entries = clipboard.entries.filter(entry => resolveWikilinkPath(entry.path) !== filePath);
            if (entries.length === 0) {
                this.dnClipboard = null;
                return;
            }
            this.dnClipboard = {
                kind: 'phase-links',
                childType: clipboard.childType,
                entries,
            };
            return;
        }

        const entries = clipboard.entries.filter(entry => resolveWikilinkPath(entry.path) !== filePath);
        this.dnClipboard = entries.length > 0
            ? { kind: 'quest-links', category: clipboard.category, entries }
            : null;
    }

    private getUniquePath(folder: string, fileName: string): string {
        const dot = fileName.lastIndexOf('.');
        const base = dot >= 0 ? fileName.slice(0, dot) : fileName;
        const ext = dot >= 0 ? fileName.slice(dot) : '';
        let candidate = normalizePath(`${folder}/${fileName}`);
        let dedupe = 1;
        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = normalizePath(`${folder}/${base} (${dedupe})${ext}`);
            dedupe++;
        }
        return candidate;
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
