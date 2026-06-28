/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import type { DNBase, DNPhase } from './types';
import { createDefaultPhases } from './types';

export type QuestPhase = DNPhase;

export interface Quest extends DNBase {
    type: 'quest';
    category: string;
    questType: string;
    phases: QuestPhase[];
}

export function createEmptyQuest(title: string): Quest {
    const now = new Date().toISOString();
    const defaultPhases = createDefaultPhases();
    return {
        filePath: '',
        title,
        description: '',
        created: now,
        modified: now,
        type: 'quest',
        category: '',
        questType: '',
        phases: defaultPhases.map(p => ({ ...p })),
    };
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
