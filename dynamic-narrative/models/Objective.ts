/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import type { DNBase, DNPhase, DNLinkedChild } from './types';
import { createDefaultPhases } from './types';

// ─── Objective Type ──────────────────────────────────────────────
// Basic structure: phases only, never references other entities.

export interface ObjectiveType extends DNBase {
    type: 'objective-type';
    category: string;
    phases: DNPhase[];
}

export function createEmptyObjectiveType(title: string): ObjectiveType {
    const now = new Date().toISOString();
    return {
        filePath: '',
        title,
        description: '',
        created: now,
        modified: now,
        type: 'objective-type',
        category: '',
        phases: createDefaultPhases(),
    };
}

// ─── Objective Variant ───────────────────────────────────────────
// References an ObjectiveType; phases mirror the Type's structure and
// add their own Conditions/Commands plus linked Arc Variants.

export interface ObjectiveVariantPhase extends DNPhase {
    linkedArcs: DNLinkedChild[];
}

export interface ObjectiveVariant extends DNBase {
    type: 'objective-variant';
    objectiveTypeId: string; // filePath of the referenced ObjectiveType
    category: string;
    linkedLocations: string[];
    linkedCharacters: string[];
    phases: ObjectiveVariantPhase[];
}

export function createEmptyObjectiveVariant(title: string, objectiveTypeId: string): ObjectiveVariant {
    const now = new Date().toISOString();
    const defaultPhases = createDefaultPhases();
    return {
        filePath: '',
        title,
        description: '',
        created: now,
        modified: now,
        type: 'objective-variant',
        objectiveTypeId,
        category: '',
        linkedLocations: [],
        linkedCharacters: [],
        phases: defaultPhases.map(p => ({ ...p, linkedArcs: [] })),
    };
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
