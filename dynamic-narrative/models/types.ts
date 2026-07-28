/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */

export type DNEntityType = 'scenario' | 'objective-type' | 'objective-variant' | 'arc-type' | 'arc-variant' | 'quest';

export type DNEntity = import('./Scenario').Scenario
    | import('./Objective').ObjectiveType
    | import('./Objective').ObjectiveVariant
    | import('./Arc').ArcType
    | import('./Arc').ArcVariant
    | import('./Quest').Quest;

export interface DNBase {
    filePath: string;
    title: string;
    description: string;
    created: string;
    modified: string;
}

export interface DNPhase {
    name: string;
    description: string;
    startConditions: string;
    startCommands: string;
    endConditions: string;
    endCommands: string;
    isDefault: boolean;
    overrides: string[];
}

export interface DNLinkedChild {
    id: string;
    isPrimary: boolean;
    mandatory: boolean;
}

export const DEFAULT_DN_PHASES: string[] = [
    'QuestSleeping',
    'QuestAvailable',
    'QuestStarted',
    'QuestCompleted',
    'QuestFailed',
];

export const DEFAULT_SCENARIO_CATEGORIES: string[] = [
    'Main Plot',
    'Core',
    'Minor',
    'Dynamic',
];

export const DEFAULT_OBJECTIVE_CATEGORIES: string[] = [
    'Structured',
    'Dynamic',
    'Procedural',
];

export const DEFAULT_ARC_CATEGORIES: string[] = [
    'Primary',
    'Secondary',
];

export const DEFAULT_QUEST_CATEGORIES: string[] = [
    'Goal',
    'Limit',
    'Event',
    'Modifier',
];

export function createDefaultPhase(name: string): DNPhase {
    return {
        name,
        description: '',
        startConditions: '',
        startCommands: '',
        endConditions: '',
        endCommands: '',
        isDefault: true,
        overrides: [],
    };
}

export function createDefaultPhases(): DNPhase[] {
    return DEFAULT_DN_PHASES.map(name => createDefaultPhase(name));
}

export function getOrderedPhases(phases: DNPhase[], hasDefaults: boolean): DNPhase[] {
    if (!hasDefaults) {
        return [...phases];
    }
    const defaults = phases.filter(p => p.isDefault);
    const customs = phases.filter(p => !p.isDefault);
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
    return result;
}

export function deriveShortDesc(description: string, maxLen = 200): string {
    if (!description) return '';
    const trimmed = description.trim();
    if (trimmed.length <= maxLen) return trimmed;
    return trimmed.substring(0, maxLen).trimEnd() + '...';
}

export function isDefaultPhase(name: string): boolean {
    return DEFAULT_DN_PHASES.includes(name);
}

export function resolveWikilinkPath(wikilink: string): string {
    return wikilink.replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/\.md$/i, '') + '.md';
}

export function isScenario(e: { type: string }): e is import('./Scenario').Scenario { return e.type === 'scenario'; }
export function isObjectiveType(e: { type: string }): e is import('./Objective').ObjectiveType { return e.type === 'objective-type'; }
export function isObjectiveVariant(e: { type: string }): e is import('./Objective').ObjectiveVariant { return e.type === 'objective-variant'; }
export function isArcType(e: { type: string }): e is import('./Arc').ArcType { return e.type === 'arc-type'; }
export function isArcVariant(e: { type: string }): e is import('./Arc').ArcVariant { return e.type === 'arc-variant'; }
export function isQuest(e: { type: string }): e is import('./Quest').Quest { return e.type === 'quest'; }

export function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
}

export const DN_INSPECTOR_MIN_WIDTH = 250;
export const DN_INSPECTOR_MAX_WIDTH = 800;

export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { fn(...args); timer = null; }, delay);
    };
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
