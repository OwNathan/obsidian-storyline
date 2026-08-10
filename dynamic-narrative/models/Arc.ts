/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import type { DNBase, DNLinkedEntity, DNPhase } from './types';
import { createDefaultPhases } from './types';

// ─── Arc Type ────────────────────────────────────────────────────
// Basic structure: phases only, never references other entities.

export interface ArcType extends DNBase {
    type: 'arc-type';
    phases: DNPhase[];
}

export function createEmptyArcType(title: string): ArcType {
    const now = new Date().toISOString();
    return {
        filePath: '',
        title,
        description: '',
        created: now,
        modified: now,
        dirty: true,
        type: 'arc-type',
        phases: createDefaultPhases(),
    };
}

// ─── Arc Variant ─────────────────────────────────────────────────
// References an ArcType; its phases are always read from the Type.

export interface ArcVariant extends DNBase {
    type: 'arc-variant';
    arcTypeId: string; // filePath of the referenced ArcType
    conditionsOverride: string;
    commandsOverride: string;
    linkedGoals: DNLinkedEntity[];
    linkedLimits: DNLinkedEntity[];
    linkedEvents: DNLinkedEntity[];
    linkedModifiers: DNLinkedEntity[];
}

export function createEmptyArcVariant(title: string, arcTypeId: string): ArcVariant {
    const now = new Date().toISOString();
    return {
        filePath: '',
        title,
        description: '',
        created: now,
        modified: now,
        dirty: true,
        type: 'arc-variant',
        arcTypeId,
        conditionsOverride: '',
        commandsOverride: '',
        linkedGoals: [],
        linkedLimits: [],
        linkedEvents: [],
        linkedModifiers: [],
    };
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
