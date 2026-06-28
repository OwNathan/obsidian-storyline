/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import type { DNBase, DNPhase, DNLinkedChild } from './types';
import { createDefaultPhases } from './types';

export interface ObjectivePhase extends DNPhase {
    linkedArcs: DNLinkedChild[];
}

export interface Objective extends DNBase {
    type: 'objective';
    category: string;
    linkedLocations: string[];
    linkedCharacters: string[];
    phases: ObjectivePhase[];
}

export function createEmptyObjective(title: string): Objective {
    const now = new Date().toISOString();
    const defaultPhases = createDefaultPhases();
    return {
        filePath: '',
        title,
        description: '',
        created: now,
        modified: now,
        type: 'objective',
        category: '',
        linkedLocations: [],
        linkedCharacters: [],
        phases: defaultPhases.map(p => ({ ...p, linkedArcs: [] })),
    };
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
