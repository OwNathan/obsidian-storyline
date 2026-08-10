/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import type { DNBase, DNPhase, DNLinkedChild } from './types';

export interface ScenarioPhase extends DNPhase {
    linkedObjectives: DNLinkedChild[];
}

export interface Scenario extends DNBase {
    type: 'scenario';
    category: string;
    linkedActs: number[];
    linkedLocations: string[];
    linkedCharacters: string[];
    phases: ScenarioPhase[];
}

export function createEmptyScenario(title: string): Scenario {
    const now = new Date().toISOString();
    return {
        filePath: '',
        title,
        description: '',
        created: now,
        modified: now,
        dirty: true,
        type: 'scenario',
        category: '',
        linkedActs: [],
        linkedLocations: [],
        linkedCharacters: [],
        phases: [],
    };
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
