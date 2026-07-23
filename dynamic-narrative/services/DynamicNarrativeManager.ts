/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { App, Notice, TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { Scenario, ScenarioPhase } from '../models/Scenario';
import type { Objective, ObjectivePhase } from '../models/Objective';
import type { Arc, ArcPhase } from '../models/Arc';
import type { Quest, QuestPhase } from '../models/Quest';
import {
    DNBase,
    DNEntityType,
    DNEntity,
    DNLinkedChild,
    DNPhase,
    DEFAULT_DN_PHASES,
    DEFAULT_SCENARIO_CATEGORIES,
    DEFAULT_OBJECTIVE_CATEGORIES,
    DEFAULT_OBJECTIVE_VARIANTS,
    DEFAULT_ARC_CATEGORIES,
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
import { createEmptyObjective } from '../models/Objective';
import { createEmptyArc } from '../models/Arc';
import { createEmptyQuest } from '../models/Quest';

interface DynamicNarrativeSystemData {
    scenarios: Record<string, Scenario>;
    objectives: Record<string, Objective>;
    arcs: Record<string, Arc>;
    quests: Record<string, Quest>;
    layout: {
        inspectorWidth: number;
    };
    version: number;
}

const SYSTEM_FILE_NAME = 'dynamic-narrative.json';
const DN_FOLDER_NAME = 'DynamicNarrative';
const SUBFOLDERS = ['Scenarios', 'Objectives', 'Arcs', 'Quests'] as const;

export class DynamicNarrativeManager {
    private app: App;
    private plugin: SceneCardsPlugin;

    private scenarios: Map<string, Scenario> = new Map();
    private objectives: Map<string, Objective> = new Map();
    private arcs: Map<string, Arc> = new Map();
    private quests: Map<string, Quest> = new Map();

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
        this.objectives.clear();
        this.arcs.clear();
        this.quests.clear();

        const systemData = await this.loadSystemJson();
        if (systemData) {
            for (const [path, entity] of Object.entries(systemData.scenarios)) {
                entity.type = 'scenario';
                this.scenarios.set(path, entity);
            }
            for (const [path, entity] of Object.entries(systemData.objectives)) {
                entity.type = 'objective';
                this.objectives.set(path, entity);
            }
            for (const [path, entity] of Object.entries(systemData.arcs)) {
                entity.type = 'arc';
                this.arcs.set(path, entity);
            }
            for (const [path, entity] of Object.entries(systemData.quests)) {
                entity.type = 'quest';
                this.quests.set(path, entity);
            }
        }

        await this.scanEntityFolder('Scenarios', 'scenario');
        await this.scanEntityFolder('Objectives', 'objective');
        await this.scanEntityFolder('Arcs', 'arc');
        await this.scanEntityFolder('Quests', 'quest');

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
                    switch (entityType) {
                        case 'scenario':
                            this.scenarios.set(entity.filePath, entity as Scenario);
                            break;
                        case 'objective':
                            this.objectives.set(entity.filePath, entity as Objective);
                            break;
                        case 'arc':
                            this.arcs.set(entity.filePath, entity as Arc);
                            break;
                        case 'quest':
                            this.quests.set(entity.filePath, entity as Quest);
                            break;
                    }
                }
            }
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
            objectives: Object.fromEntries(this.objectives),
            arcs: Object.fromEntries(this.arcs),
            quests: Object.fromEntries(this.quests),
            layout: {
                inspectorWidth: 350,
            },
            version: 1,
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
            } else if (tags.includes('storyline-objective')) {
                return this.parseObjectiveFromFm(fm, body, file.path);
            } else if (tags.includes('storyline-arc')) {
                return this.parseArcFromFm(fm, body, file.path);
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
        const description = this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            type: 'scenario',
            category: (fm['scenario-category'] as string) || '',
            linkedActs: this.parseNumberList(fm['scenario-acts']),
            linkedLocations: this.parseStringList(fm['linked-locations']),
            linkedCharacters: this.parseStringList(fm['linked-characters']),
            phases,
        };
    }

    private parseObjectiveFromFm(fm: Record<string, unknown>, body: string, filePath: string): Objective {
        const phases = this.parseObjectivePhases(fm['objective-phases']);
        const description = this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            type: 'objective',
            variant: (fm['objective-variant'] as string) || '',
            priority: (fm['objective-priority'] as string) || '',
            category: (fm['objective-category'] as string) || '',
            linkedLocations: this.parseStringList(fm['linked-locations']),
            linkedCharacters: this.parseStringList(fm['linked-characters']),
            phases,
        };
    }

    private parseArcFromFm(fm: Record<string, unknown>, body: string, filePath: string): Arc {
        const phases = this.parseArcPhases(fm['arc-phases']);
        const description = this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            type: 'arc',
            category: (fm['arc-category'] as string) || '',
            linkedLocations: this.parseStringList(fm['linked-locations']),
            dynamicLocations: Boolean(fm['dynamic-locations']),
            phases,
        };
    }

    private parseQuestFromFm(fm: Record<string, unknown>, body: string, filePath: string): Quest {
        const phases = this.parseQuestPhases(fm['quest-phases']);
        const description = this.extractBodySection(body, 'Overview');
        return {
            filePath,
            title: (fm.title as string) || this.titleFromPath(filePath),
            description,
            created: (fm.created as string) || '',
            modified: (fm.modified as string) || new Date().toISOString(),
            type: 'quest',
            category: (fm['quest-category'] as string) || '',
            questType: (fm['quest-type'] as string) || '',
            phases,
        };
    }

    private parseScenarioPhases(raw: unknown): ScenarioPhase[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => ({
            name: (p['phase-name'] as string) || '',
            description: (p['phase-description'] as string) || '',
            startConditions: (p['phase-start-conditions'] as string) || '',
            startCommands: (p['phase-start-commands'] as string) || '',
            endConditions: (p['phase-end-conditions'] as string) || '',
            endCommands: (p['phase-end-commands'] as string) || '',
            isDefault: isDefaultPhase((p['phase-name'] as string) || ''),
            linkedObjectives: this.parseLinkedChildren(p['linked-objectives']),
        }));
    }

    private parseObjectivePhases(raw: unknown): ObjectivePhase[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => ({
            name: (p['phase-name'] as string) || '',
            description: (p['phase-description'] as string) || '',
            startConditions: (p['phase-start-conditions'] as string) || '',
            startCommands: (p['phase-start-commands'] as string) || '',
            endConditions: (p['phase-end-conditions'] as string) || '',
            endCommands: (p['phase-end-commands'] as string) || '',
            isDefault: isDefaultPhase((p['phase-name'] as string) || ''),
            linkedArcs: this.parseLinkedChildren(p['linked-arcs']),
        }));
    }

    private parseArcPhases(raw: unknown): ArcPhase[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => ({
            name: (p['phase-name'] as string) || '',
            description: (p['phase-description'] as string) || '',
            startConditions: (p['phase-start-conditions'] as string) || '',
            startCommands: (p['phase-start-commands'] as string) || '',
            endConditions: (p['phase-end-conditions'] as string) || '',
            endCommands: (p['phase-end-commands'] as string) || '',
            isDefault: isDefaultPhase((p['phase-name'] as string) || ''),
            linkedGoals: this.parseStringList(p['linked-goals']),
            linkedLimits: this.parseStringList(p['linked-limits']),
            linkedEvents: this.parseStringList(p['linked-events']),
            linkedModifiers: this.parseStringList(p['linked-modifiers']),
        }));
    }

    private parseQuestPhases(raw: unknown): QuestPhase[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => ({
            name: (p['phase-name'] as string) || '',
            description: (p['phase-description'] as string) || '',
            startConditions: (p['phase-start-conditions'] as string) || '',
            startCommands: (p['phase-start-commands'] as string) || '',
            endConditions: (p['phase-end-conditions'] as string) || '',
            endCommands: (p['phase-end-commands'] as string) || '',
            isDefault: isDefaultPhase((p['phase-name'] as string) || ''),
        }));
    }

    private parseLinkedChildren(raw: unknown): DNLinkedChild[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((item: Record<string, unknown>) => ({
            id: (item['objective-id'] || item['arc-id'] || '') as string,
            isPrimary: item['is-primary'] !== false,
            mandatory: item['mandatory'] === true,
        }));
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

    private buildFrontmatter(entity: DNEntity): Record<string, unknown> {
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
            case 'objective': {
                const o = entity as Objective;
                fm.tags = ['storyline-objective'];
                fm.title = o.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                if (o.variant) fm['objective-variant'] = o.variant;
                if (o.priority) fm['objective-priority'] = o.priority;
                fm['objective-category'] = o.category;
                if (o.linkedLocations.length > 0) fm['linked-locations'] = o.linkedLocations;
                if (o.linkedCharacters.length > 0) fm['linked-characters'] = o.linkedCharacters;
                if (o.phases.length > 0) {
                    fm['objective-phases'] = o.phases.map(p => this.serializeObjectivePhase(p));
                }
                break;
            }
            case 'arc': {
                const a = entity as Arc;
                fm.tags = ['storyline-arc'];
                fm.title = a.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                fm['arc-category'] = a.category;
                if (a.linkedLocations.length > 0) fm['linked-locations'] = a.linkedLocations;
                if (a.dynamicLocations) fm['dynamic-locations'] = true;
                if (a.phases.length > 0) {
                    fm['arc-phases'] = a.phases.map(p => this.serializeArcPhase(p));
                }
                break;
            }
            case 'quest': {
                const q = entity as Quest;
                fm.tags = ['storyline-quest'];
                fm.title = q.title;
                if (shortDesc) fm['short-desc'] = shortDesc;
                fm['quest-category'] = q.category;
                if (q.questType) fm['quest-type'] = q.questType;
                if (q.phases.length > 0) {
                    fm['quest-phases'] = q.phases.map(p => this.serializeQuestPhase(p));
                }
                break;
            }
        }

        fm.created = entity.created;
        fm.modified = new Date().toISOString();
        return fm;
    }

    private serializeScenarioPhase(p: ScenarioPhase): Record<string, unknown> {
        const obj: Record<string, unknown> = {
            'phase-name': p.name,
            'phase-description': p.description,
            'phase-start-conditions': p.startConditions,
            'phase-end-conditions': p.endConditions,
            'phase-start-commands': p.startCommands,
            'phase-end-commands': p.endCommands,
        };
        if (p.linkedObjectives.length > 0) {
            obj['linked-objectives'] = p.linkedObjectives.map(c => ({
                'objective-id': c.id,
                'is-primary': c.isPrimary,
                'mandatory': c.mandatory,
            }));
        }
        return obj;
    }

    private serializeObjectivePhase(p: ObjectivePhase): Record<string, unknown> {
        const obj: Record<string, unknown> = {
            'phase-name': p.name,
            'phase-description': p.description,
            'phase-start-conditions': p.startConditions,
            'phase-end-conditions': p.endConditions,
            'phase-start-commands': p.startCommands,
            'phase-end-commands': p.endCommands,
        };
        if (p.linkedArcs.length > 0) {
            obj['linked-arcs'] = p.linkedArcs.map(c => ({
                'arc-id': c.id,
                'is-primary': c.isPrimary,
                'mandatory': c.mandatory,
            }));
        }
        return obj;
    }

    private serializeArcPhase(p: ArcPhase): Record<string, unknown> {
        const obj: Record<string, unknown> = {
            'phase-name': p.name,
            'phase-description': p.description,
            'phase-start-conditions': p.startConditions,
            'phase-end-conditions': p.endConditions,
            'phase-start-commands': p.startCommands,
            'phase-end-commands': p.endCommands,
        };
        if (p.linkedGoals.length > 0) obj['linked-goals'] = p.linkedGoals;
        if (p.linkedLimits.length > 0) obj['linked-limits'] = p.linkedLimits;
        if (p.linkedEvents.length > 0) obj['linked-events'] = p.linkedEvents;
        if (p.linkedModifiers.length > 0) obj['linked-modifiers'] = p.linkedModifiers;
        return obj;
    }

    private serializeQuestPhase(p: QuestPhase): Record<string, unknown> {
        return {
            'phase-name': p.name,
            'phase-description': p.description,
            'phase-start-conditions': p.startConditions,
            'phase-end-conditions': p.endConditions,
            'phase-start-commands': p.startCommands,
            'phase-end-commands': p.endCommands,
        };
    }

    private async readExistingBodySection(entity: DNEntity, sectionName: string): Promise<string> {
        try {
            const file = this.app.vault.getAbstractFileByPath(entity.filePath);
            if (!(file instanceof TFile)) return '';
            const content = await this.app.vault.read(file);
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            const body = fmMatch ? content.slice(fmMatch[0].length).trim() : '';
            return this.extractBodySection(body, sectionName);
        } catch {
            return '';
        }
    }

    private async buildBody(entity: DNEntity): Promise<string> {
        const mainPurpose = await this.readExistingBodySection(entity, 'Main Purpose');
        const integrationAnalysis = await this.readExistingBodySection(entity, 'Integration Analysis');

        let body = `# Overview\n${entity.description}\n\n# Game Details\n## Main Purpose\n${mainPurpose}\n\n## Integration Analysis\n${integrationAnalysis}\n`;
        return body;
    }

    private async writeEntityFile(entity: DNEntity): Promise<void> {
        try {
            const fm = this.buildFrontmatter(entity);
            const body = await this.buildBody(entity);
            const content = `---\n${stringifyYaml(fm)}---\n${body}`;

            const file = this.app.vault.getAbstractFileByPath(entity.filePath);
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

    // ─── CRUD: Scenarios ─────────────────────────────────────────

    async createScenario(data: Partial<Scenario>): Promise<Scenario> {
        const entity = createEmptyScenario(data.title || 'New Scenario');
        Object.assign(entity, data);
        entity.type = 'scenario';
        entity.created = new Date().toISOString();
        entity.modified = new Date().toISOString();

        const safeName = entity.title.replace(/[\\/:*?"<>|]/g, '-');
        const folder = normalizePath(`${this.projectFolder}/${DN_FOLDER_NAME}/Scenarios`);
        entity.filePath = this.getUniquePath(folder, `${safeName}.md`);

        await this.writeEntityFile(entity);
        this.scenarios.set(entity.filePath, entity);
        await this.saveSystemJson();
        return entity;
    }

    async updateScenario(filePath: string, updates: Partial<Scenario>): Promise<void> {
        const entity = this.scenarios.get(filePath);
        if (!entity) return;

        const oldSnap = deepClone(entity);

        let currentPath = filePath;
        if (updates.title !== undefined && updates.title !== entity.title) {
            currentPath = await this.doRenameFile(filePath, updates.title, `${DN_FOLDER_NAME}/Scenarios`);
            entity.filePath = currentPath;
            this.scenarios.delete(filePath);
            this.scenarios.set(currentPath, entity);
            await this.cascadeRename(filePath, currentPath);
        }

        Object.assign(entity, updates);
        entity.modified = new Date().toISOString();

        this.plugin.sceneManager.undoManager.recordUpdate(
            currentPath,
            oldSnap as unknown as Record<string, unknown>,
            updates,
            `Update scenario "${entity.title}"`
        );

        await this.writeEntityFile(entity);
        this.scenarios.set(currentPath, entity);
        await this.saveSystemJson();
    }

    async deleteScenario(filePath: string): Promise<void> {
        const entity = this.scenarios.get(filePath);
        if (!entity) return;

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file && file instanceof TFile) {
            const content = await this.app.vault.read(file);
            this.plugin.sceneManager.undoManager.recordDelete(
                filePath,
                content,
                `Delete scenario "${entity.title}"`
            );
            await this.app.vault.delete(file);
        }

        this.scenarios.delete(filePath);
        await this.saveSystemJson();
    }

    // ─── CRUD: Objectives ────────────────────────────────────────

    async createObjective(data: Partial<Objective>): Promise<Objective> {
        const entity = createEmptyObjective(data.title || 'New Objective');
        Object.assign(entity, data);
        entity.type = 'objective';
        entity.created = new Date().toISOString();
        entity.modified = new Date().toISOString();

        const safeName = entity.title.replace(/[\\/:*?"<>|]/g, '-');
        const folder = normalizePath(`${this.projectFolder}/${DN_FOLDER_NAME}/Objectives`);
        entity.filePath = this.getUniquePath(folder, `${safeName}.md`);

        await this.writeEntityFile(entity);
        this.objectives.set(entity.filePath, entity);
        await this.saveSystemJson();
        return entity;
    }

    async updateObjective(filePath: string, updates: Partial<Objective>): Promise<void> {
        const entity = this.objectives.get(filePath);
        if (!entity) return;

        const oldSnap = deepClone(entity);

        let currentPath = filePath;
        if (updates.title !== undefined && updates.title !== entity.title) {
            currentPath = await this.doRenameFile(filePath, updates.title, `${DN_FOLDER_NAME}/Objectives`);
            entity.filePath = currentPath;
            this.objectives.delete(filePath);
            this.objectives.set(currentPath, entity);
            await this.cascadeRename(filePath, currentPath);
        }

        Object.assign(entity, updates);
        entity.modified = new Date().toISOString();

        this.plugin.sceneManager.undoManager.recordUpdate(
            currentPath,
            oldSnap as unknown as Record<string, unknown>,
            updates,
            `Update objective "${entity.title}"`
        );

        await this.writeEntityFile(entity);
        this.objectives.set(currentPath, entity);
        await this.saveSystemJson();
    }

    async deleteObjective(filePath: string): Promise<void> {
        const entity = this.objectives.get(filePath);
        if (!entity) return;

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file && file instanceof TFile) {
            const content = await this.app.vault.read(file);
            this.plugin.sceneManager.undoManager.recordDelete(
                filePath,
                content,
                `Delete objective "${entity.title}"`
            );
            await this.app.vault.delete(file);
        }

        this.objectives.delete(filePath);
        await this.saveSystemJson();
    }

    // ─── CRUD: Arcs ──────────────────────────────────────────────

    async createArc(data: Partial<Arc>): Promise<Arc> {
        const entity = createEmptyArc(data.title || 'New Arc');
        Object.assign(entity, data);
        entity.type = 'arc';
        entity.created = new Date().toISOString();
        entity.modified = new Date().toISOString();

        const safeName = entity.title.replace(/[\\/:*?"<>|]/g, '-');
        const folder = normalizePath(`${this.projectFolder}/${DN_FOLDER_NAME}/Arcs`);
        entity.filePath = this.getUniquePath(folder, `${safeName}.md`);

        await this.writeEntityFile(entity);
        this.arcs.set(entity.filePath, entity);
        await this.saveSystemJson();
        return entity;
    }

    async updateArc(filePath: string, updates: Partial<Arc>): Promise<void> {
        const entity = this.arcs.get(filePath);
        if (!entity) return;

        const oldSnap = deepClone(entity);

        let currentPath = filePath;
        if (updates.title !== undefined && updates.title !== entity.title) {
            currentPath = await this.doRenameFile(filePath, updates.title, `${DN_FOLDER_NAME}/Arcs`);
            entity.filePath = currentPath;
            this.arcs.delete(filePath);
            this.arcs.set(currentPath, entity);
            await this.cascadeRename(filePath, currentPath);
        }

        Object.assign(entity, updates);
        entity.modified = new Date().toISOString();

        this.plugin.sceneManager.undoManager.recordUpdate(
            currentPath,
            oldSnap as unknown as Record<string, unknown>,
            updates,
            `Update arc "${entity.title}"`
        );

        await this.writeEntityFile(entity);
        this.arcs.set(currentPath, entity);
        await this.saveSystemJson();
    }

    async deleteArc(filePath: string): Promise<void> {
        const entity = this.arcs.get(filePath);
        if (!entity) return;

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file && file instanceof TFile) {
            const content = await this.app.vault.read(file);
            this.plugin.sceneManager.undoManager.recordDelete(
                filePath,
                content,
                `Delete arc "${entity.title}"`
            );
            await this.app.vault.delete(file);
        }

        this.arcs.delete(filePath);
        await this.saveSystemJson();
    }

    // ─── CRUD: Quests ────────────────────────────────────────────

    async createQuest(data: Partial<Quest>): Promise<Quest> {
        const entity = createEmptyQuest(data.title || 'New Quest');
        Object.assign(entity, data);
        entity.type = 'quest';
        entity.created = new Date().toISOString();
        entity.modified = new Date().toISOString();

        const safeName = entity.title.replace(/[\\/:*?"<>|]/g, '-');
        const folder = normalizePath(`${this.projectFolder}/${DN_FOLDER_NAME}/Quests`);
        entity.filePath = this.getUniquePath(folder, `${safeName}.md`);

        await this.writeEntityFile(entity);
        this.quests.set(entity.filePath, entity);
        await this.saveSystemJson();
        return entity;
    }

    async updateQuest(filePath: string, updates: Partial<Quest>): Promise<void> {
        const entity = this.quests.get(filePath);
        if (!entity) return;

        const oldSnap = deepClone(entity);

        let currentPath = filePath;
        if (updates.title !== undefined && updates.title !== entity.title) {
            currentPath = await this.doRenameFile(filePath, updates.title, `${DN_FOLDER_NAME}/Quests`);
            entity.filePath = currentPath;
            this.quests.delete(filePath);
            this.quests.set(currentPath, entity);
            await this.cascadeRename(filePath, currentPath);
        }

        Object.assign(entity, updates);
        entity.modified = new Date().toISOString();

        this.plugin.sceneManager.undoManager.recordUpdate(
            currentPath,
            oldSnap as unknown as Record<string, unknown>,
            updates,
            `Update quest "${entity.title}"`
        );

        await this.writeEntityFile(entity);
        this.quests.set(currentPath, entity);
        await this.saveSystemJson();
    }

    async deleteQuest(filePath: string): Promise<void> {
        const entity = this.quests.get(filePath);
        if (!entity) return;

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file && file instanceof TFile) {
            const content = await this.app.vault.read(file);
            this.plugin.sceneManager.undoManager.recordDelete(
                filePath,
                content,
                `Delete quest "${entity.title}"`
            );
            await this.app.vault.delete(file);
        }

        this.quests.delete(filePath);
        await this.saveSystemJson();
    }

    // ─── Auto-linking ────────────────────────────────────────────

    async createAndLinkObjective(scenarioPath: string, phaseName: string, data: Partial<Objective>): Promise<Objective> {
        const objective = await this.createObjective(data);
        const scenario = this.scenarios.get(scenarioPath);
        if (!scenario) return objective;

        const phase = scenario.phases.find(p => p.name === phaseName);
        if (!phase) return objective;

        phase.linkedObjectives.push({
            id: `[[${objective.filePath}]]`,
            isPrimary: true,
            mandatory: false,
        });

        await this.writeEntityFile(scenario);
        await this.saveSystemJson();
        return objective;
    }

    async createAndLinkArc(objectivePath: string, phaseName: string, data: Partial<Arc>): Promise<Arc> {
        const arc = await this.createArc(data);
        const objective = this.objectives.get(objectivePath);
        if (!objective) return arc;

        const phase = objective.phases.find(p => p.name === phaseName);
        if (!phase) return arc;

        phase.linkedArcs.push({
            id: `[[${arc.filePath}]]`,
            isPrimary: true,
            mandatory: false,
        });

        await this.writeEntityFile(objective);
        await this.saveSystemJson();
        return arc;
    }

    async createAndLinkQuest(arcPath: string, phaseName: string, category: string, data: Partial<Quest>): Promise<Quest> {
        const quest = await this.createQuest({ ...data, category });
        const arc = this.arcs.get(arcPath);
        if (!arc) return quest;

        const phase = arc.phases.find(p => p.name === phaseName);
        if (!phase) return quest;

        const wikilink = `[[${quest.filePath}]]`;
        switch (category) {
            case 'Goal':
                phase.linkedGoals.push(wikilink);
                break;
            case 'Limit':
                phase.linkedLimits.push(wikilink);
                break;
            case 'Event':
                phase.linkedEvents.push(wikilink);
                break;
            case 'Modifier':
                phase.linkedModifiers.push(wikilink);
                break;
        }

        await this.writeEntityFile(arc);
        await this.saveSystemJson();
        return quest;
    }

    // ─── Hierarchy Queries ───────────────────────────────────────

    getLinkedObjectives(scenarioPath: string, phaseName?: string): DNLinkedChild[] {
        const scenario = this.scenarios.get(scenarioPath);
        if (!scenario) return [];
        if (phaseName) {
            const phase = scenario.phases.find(p => p.name === phaseName);
            return phase ? phase.linkedObjectives : [];
        }
        return scenario.phases.flatMap(p => p.linkedObjectives);
    }

    getLinkedArcs(objectivePath: string, phaseName?: string): DNLinkedChild[] {
        const objective = this.objectives.get(objectivePath);
        if (!objective) return [];
        if (phaseName) {
            const phase = objective.phases.find(p => p.name === phaseName);
            return phase ? phase.linkedArcs : [];
        }
        return objective.phases.flatMap(p => p.linkedArcs);
    }

    getLinkedQuests(arcPath: string, phaseName?: string): string[] {
        const arc = this.arcs.get(arcPath);
        if (!arc) return [];
        const phases = phaseName
            ? arc.phases.filter(p => p.name === phaseName)
            : arc.phases;
        return phases.flatMap(p => [
            ...p.linkedGoals,
            ...p.linkedLimits,
            ...p.linkedEvents,
            ...p.linkedModifiers,
        ]);
    }

    getConnectionsForQuest(questPath: string): { scenarios: number; objectives: number; arcs: number } {
        const wikilink = `[[${questPath}]]`;
        let arcs = 0;
        let objectives = 0;
        const connectedObjectivePaths = new Set<string>();
        const connectedScenarioPaths = new Set<string>();

        for (const arc of this.arcs.values()) {
            for (const phase of arc.phases) {
                if (
                    phase.linkedGoals.includes(wikilink) ||
                    phase.linkedLimits.includes(wikilink) ||
                    phase.linkedEvents.includes(wikilink) ||
                    phase.linkedModifiers.includes(wikilink)
                ) {
                    arcs++;
                    break;
                }
            }
        }

        for (const obj of this.objectives.values()) {
            for (const phase of obj.phases) {
                for (const arcRef of phase.linkedArcs) {
                    const arcPath = resolveWikilinkPath(arcRef.id);
                    const arc = this.arcs.get(arcPath);
                    if (!arc) continue;
                    for (const arcPhase of arc.phases) {
                        if (
                            arcPhase.linkedGoals.includes(wikilink) ||
                            arcPhase.linkedLimits.includes(wikilink) ||
                            arcPhase.linkedEvents.includes(wikilink) ||
                            arcPhase.linkedModifiers.includes(wikilink)
                        ) {
                            if (!connectedObjectivePaths.has(obj.filePath)) {
                                connectedObjectivePaths.add(obj.filePath);
                                objectives++;
                            }
                            break;
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

    // resolveWikilinkPath is imported from models/types.ts

    // ─── Phase Management ────────────────────────────────────────

    addCustomPhase(entity: DNEntity, phase: DNPhase): void {
        const newPhase = { ...phase, isDefault: false };
        switch (entity.type) {
            case 'scenario':
                (entity as Scenario).phases.push({ ...newPhase, linkedObjectives: [] } as ScenarioPhase);
                break;
            case 'objective':
                (entity as Objective).phases.push({ ...newPhase, linkedArcs: [] } as ObjectivePhase);
                break;
            case 'arc':
                (entity as Arc).phases.push({
                    ...newPhase,
                    linkedGoals: [],
                    linkedLimits: [],
                    linkedEvents: [],
                    linkedModifiers: [],
                } as ArcPhase);
                break;
            case 'quest':
                (entity as Quest).phases.push(newPhase as QuestPhase);
                break;
        }
    }

    removeCustomPhase(entity: DNEntity, phaseName: string): void {
        if (isDefaultPhase(phaseName)) return;
        switch (entity.type) {
            case 'scenario':
                (entity as Scenario).phases = (entity as Scenario).phases.filter(p => p.name !== phaseName);
                break;
            case 'objective':
                (entity as Objective).phases = (entity as Objective).phases.filter(p => p.name !== phaseName);
                break;
            case 'arc':
                (entity as Arc).phases = (entity as Arc).phases.filter(p => p.name !== phaseName);
                break;
            case 'quest':
                (entity as Quest).phases = (entity as Quest).phases.filter(p => p.name !== phaseName);
                break;
        }
    }

    renameCustomPhase(entity: DNEntity, oldName: string, newName: string): void {
        if (isDefaultPhase(oldName)) return;
        const phases = this.getPhases(entity);
        const phase = phases.find(p => p.name === oldName);
        if (phase) {
            phase.name = newName;
        }
    }

    reorderCustomPhases(entity: DNEntity, fromIndex: number, toIndex: number): void {
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
        const phases = this.getPhases(entity);
        const hasDefaults = entity.type !== 'scenario';
        return getOrderedPhases(phases, hasDefaults);
    }

    private getPhases(entity: DNEntity): DNPhase[] {
        switch (entity.type) {
            case 'scenario': return (entity as Scenario).phases;
            case 'objective': return (entity as Objective).phases;
            case 'arc': return (entity as Arc).phases;
            case 'quest': return (entity as Quest).phases;
        }
    }

    private setPhases(entity: DNEntity, phases: DNPhase[]): void {
        switch (entity.type) {
            case 'scenario':
                (entity as Scenario).phases = phases as ScenarioPhase[];
                break;
            case 'objective':
                (entity as Objective).phases = phases as ObjectivePhase[];
                break;
            case 'arc':
                (entity as Arc).phases = phases as ArcPhase[];
                break;
            case 'quest':
                (entity as Quest).phases = phases as QuestPhase[];
                break;
        }
    }

    // ─── Phase Reassignment (drag between columns) ───────────────

    async reassignPhase(parentPath: string, childPath: string, fromPhase: string, toPhase: string): Promise<void> {
        const parent = this.getEntity(parentPath);
        if (!parent) return;

        const wikilink = `[[${childPath}]]`;

        switch (parent.type) {
            case 'scenario': {
                const scenario = parent as Scenario;
                const fromP = scenario.phases.find(p => p.name === fromPhase);
                const toP = scenario.phases.find(p => p.name === toPhase);
                if (!fromP || !toP) return;
                const idx = fromP.linkedObjectives.findIndex(c => resolveWikilinkPath(c.id) === childPath);
                if (idx < 0) return;
                const [child] = fromP.linkedObjectives.splice(idx, 1);
                toP.linkedObjectives.push(child);
                break;
            }
            case 'objective': {
                const objective = parent as Objective;
                const fromP = objective.phases.find(p => p.name === fromPhase);
                const toP = objective.phases.find(p => p.name === toPhase);
                if (!fromP || !toP) return;
                const idx = fromP.linkedArcs.findIndex(c => resolveWikilinkPath(c.id) === childPath);
                if (idx < 0) return;
                const [child] = fromP.linkedArcs.splice(idx, 1);
                toP.linkedArcs.push(child);
                break;
            }
            case 'arc': {
                const arc = parent as Arc;
                const fromP = arc.phases.find(p => p.name === fromPhase);
                const toP = arc.phases.find(p => p.name === toPhase);
                if (!fromP || !toP) return;
                for (const listKey of ['linkedGoals', 'linkedLimits', 'linkedEvents', 'linkedModifiers'] as const) {
                    const list = (fromP as unknown as Record<string, string[]>)[listKey as string];
                    const idx = list.indexOf(wikilink);
                    if (idx >= 0) {
                        list.splice(idx, 1);
                        ((toP as unknown as Record<string, string[]>)[listKey as string]).push(wikilink);
                        break;
                    }
                }
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

        for (const objective of this.objectives.values()) {
            let changed = false;
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

        for (const arc of this.arcs.values()) {
            let changed = false;
            for (const phase of arc.phases) {
                for (const listKey of ['linkedGoals', 'linkedLimits', 'linkedEvents', 'linkedModifiers'] as const) {
                    const list = (phase as unknown as Record<string, string[]>)[listKey as string];
                    const idx = list.indexOf(oldWikilink);
                    if (idx >= 0) {
                        list[idx] = newWikilink;
                        changed = true;
                    }
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
            case 'objective':
                return this.plugin.settings.dnObjectiveCategories?.length
                    ? this.plugin.settings.dnObjectiveCategories
                    : DEFAULT_OBJECTIVE_CATEGORIES;
            case 'arc':
                return this.plugin.settings.dnArcCategories?.length
                    ? this.plugin.settings.dnArcCategories
                    : DEFAULT_ARC_CATEGORIES;
            case 'quest':
                return this.plugin.settings.dnQuestCategories?.length
                    ? this.plugin.settings.dnQuestCategories
                    : DEFAULT_QUEST_CATEGORIES;
        }
    }

    getVariants(): string[] {
        return this.plugin.settings.dnObjectiveVariants?.length
            ? this.plugin.settings.dnObjectiveVariants
            : DEFAULT_OBJECTIVE_VARIANTS;
    }

    addCategory(entityType: DNEntityType, name: string): void {
        const cats = this.getCategories(entityType);
        if (cats.includes(name)) return;
        cats.push(name);
        this.setCategories(entityType, cats);
    }

    removeCategory(entityType: DNEntityType, name: string): void {
        const defaults = this.getDefaultCategories(entityType);
        if (defaults.includes(name)) return;
        const cats = this.getCategories(entityType).filter(c => c !== name);
        this.setCategories(entityType, cats);
    }

    private getDefaultCategories(entityType: DNEntityType): string[] {
        switch (entityType) {
            case 'scenario': return DEFAULT_SCENARIO_CATEGORIES;
            case 'objective': return DEFAULT_OBJECTIVE_CATEGORIES;
            case 'arc': return DEFAULT_ARC_CATEGORIES;
            case 'quest': return DEFAULT_QUEST_CATEGORIES;
        }
    }

    private setCategories(entityType: DNEntityType, categories: string[]): void {
        switch (entityType) {
            case 'scenario':
                this.plugin.settings.dnScenarioCategories = categories;
                break;
            case 'objective':
                this.plugin.settings.dnObjectiveCategories = categories;
                break;
            case 'arc':
                this.plugin.settings.dnArcCategories = categories;
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

    getAllObjectives(): Objective[] {
        return Array.from(this.objectives.values());
    }

    getAllArcs(): Arc[] {
        return Array.from(this.arcs.values());
    }

    getAllQuests(): Quest[] {
        return Array.from(this.quests.values());
    }

    getQuestsByCategory(category: string): Quest[] {
        return this.getAllQuests().filter(q => q.category === category);
    }

    getEntity(filePath: string): DNEntity | undefined {
        return this.scenarios.get(filePath)
            || this.objectives.get(filePath)
            || this.arcs.get(filePath)
            || this.quests.get(filePath);
    }

    getEntityType(filePath: string): DNEntityType | null {
        if (this.scenarios.has(filePath)) return 'scenario';
        if (this.objectives.has(filePath)) return 'objective';
        if (this.arcs.has(filePath)) return 'arc';
        if (this.quests.has(filePath)) return 'quest';
        return null;
    }


    // ─── Vault Event Handlers ────────────────────────────────────

    handleFileDeleted(filePath: string): void {
        let removed = false;
        if (this.scenarios.delete(filePath)) removed = true;
        else if (this.objectives.delete(filePath)) removed = true;
        else if (this.arcs.delete(filePath)) removed = true;
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
        this.objectives.clear();
        this.arcs.clear();
        this.quests.clear();
        this.initialized = false;
        this._saveQueue = Promise.resolve();
    }

    // ─── Helpers ─────────────────────────────────────────────────

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
