/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { Scene } from '../models/Scene';

/**
 * Severity levels for plot hole warnings
 */
export type WarningSeverity = 'error' | 'warning' | 'info';

/**
 * A single plot hole / consistency warning
 */
export interface PlotWarning {
    severity: WarningSeverity;
    category: string;
    message: string;
    /** File paths of scenes involved (for navigation) */
    scenePaths?: string[];
}

/**
 * Validates story consistency and detects potential plot holes.
 *
 * Categories of checks:
 * 1. Characters — disappearing characters
 * 2. Plotlines — tags that start but drop off, unbalanced plotlines
 * 3. Structure — empty acts, huge act imbalances, missing metadata
 */
export class Validator {

    /**
     * Run all plot hole checks and return a list of warnings.
     */
    static validate(scenes: Scene[]): PlotWarning[] {
        if (scenes.length === 0) return [];

        const warnings: PlotWarning[] = [];

        this.checkCharacters(scenes, warnings);
        this.checkPlotlines(scenes, warnings);
        this.checkStructure(scenes, warnings);

        return warnings;
    }

    // ─── Character Checks ──────────────────────────────────────

    private static checkCharacters(scenes: Scene[], warnings: PlotWarning[]): void {
        // Characters who appear once then vanish
        const sorted = [...scenes].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        const charApps = new Map<string, Scene[]>();
        for (const s of sorted) {
            const chars = new Set<string>();
            s.characters?.forEach(c => chars.add(c.toLowerCase()));
            for (const c of chars) {
                const list = charApps.get(c) || [];
                list.push(s);
                charApps.set(c, list);
            }
        }

        // Characters that appear only once (suspicious if there are many scenes)
        if (scenes.length >= 5) {
            for (const [char, apps] of charApps) {
                if (apps.length === 1) {
                    warnings.push({
                        severity: 'info',
                        category: 'Characters',
                        message: `Character "${char}" appears in only 1 scene ("${apps[0].title}")`,
                        scenePaths: [apps[0].filePath],
                    });
                }
            }
        }

        // Characters who disappear for a long stretch (> 40% of total scenes)
        const GAP_THRESHOLD = Math.max(5, Math.floor(scenes.length * 0.4));
        for (const [char, apps] of charApps) {
            if (apps.length < 2) continue;

            for (let i = 1; i < apps.length; i++) {
                const prevSeq = apps[i - 1].sequence ?? 0;
                const currSeq = apps[i].sequence ?? 0;
                const between = sorted.filter(s =>
                    (s.sequence ?? 0) > prevSeq && (s.sequence ?? 0) < currSeq
                ).length;

                if (between >= GAP_THRESHOLD) {
                    warnings.push({
                        severity: 'warning',
                        category: 'Characters',
                        message: `"${char}" disappears for ${between} scenes (between "${apps[i - 1].title}" and "${apps[i].title}")`,
                        scenePaths: [apps[i - 1].filePath, apps[i].filePath],
                    });
                }
            }
        }
    }

    // ─── Plotline Checks ───────────────────────────────────────

    private static checkPlotlines(scenes: Scene[], warnings: PlotWarning[]): void {
        const sorted = [...scenes].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

        // Build per-tag scene lists
        const tagScenes = new Map<string, Scene[]>();
        for (const s of sorted) {
            s.tags?.forEach(t => {
                const list = tagScenes.get(t) || [];
                list.push(s);
                tagScenes.set(t, list);
            });
        }

        // Find the total act range
        const actsUsed = new Set<number>();
        scenes.forEach(s => {
            if (s.act !== undefined) actsUsed.add(Number(s.act));
        });
        const sortedActs = Array.from(actsUsed).sort((a, b) => a - b);

        if (sortedActs.length >= 2) {
            for (const [tag, taggedScenes] of tagScenes) {
                if (taggedScenes.length < 2) continue;

                const tagActs = new Set(taggedScenes.map(s => Number(s.act)));

                // Check if plotline starts but doesn't appear in later acts
                const firstAct = Math.min(...Array.from(tagActs));
                const lastAct = Math.max(...Array.from(tagActs));

                // Missing middle acts
                for (const act of sortedActs) {
                    if (act > firstAct && act < lastAct && !tagActs.has(act)) {
                        warnings.push({
                            severity: 'warning',
                            category: 'Plotlines',
                            message: `Plotline "${tag}" has no scenes in Act ${act} (present in Acts ${firstAct}–${lastAct})`,
                        });
                    }
                }

                // Plotline appears early but doesn't reach the final act
                if (lastAct < sortedActs[sortedActs.length - 1] && taggedScenes.length >= 3) {
                    warnings.push({
                        severity: 'info',
                        category: 'Plotlines',
                        message: `Plotline "${tag}" was last seen in Act ${lastAct} but story continues to Act ${sortedActs[sortedActs.length - 1]}`,
                    });
                }
            }
        }

        // Scenes with no tags at all
        const untagged = scenes.filter(s => !s.tags || s.tags.length === 0);
        if (untagged.length > 0 && untagged.length < scenes.length) {
            warnings.push({
                severity: 'info',
                category: 'Plotlines',
                message: `${untagged.length} scene(s) have no plotline tags`,
                scenePaths: untagged.map(s => s.filePath),
            });
        }
    }

    // ─── Structure Checks ──────────────────────────────────────

    private static checkStructure(scenes: Scene[], warnings: PlotWarning[]): void {
        // Missing titles
        const untitled = scenes.filter(s => !s.title || s.title === 'Untitled Scene' || s.title === 'Untitled');
        if (untitled.length > 0) {
            warnings.push({
                severity: 'info',
                category: 'Structure',
                message: `${untitled.length} scene(s) have no title`,
                scenePaths: untitled.map(s => s.filePath),
            });
        }

        // Scenes with no act assignment
        const noAct = scenes.filter(s => s.act === undefined);
        if (noAct.length > 0 && noAct.length < scenes.length) {
            warnings.push({
                severity: 'warning',
                category: 'Structure',
                message: `${noAct.length} scene(s) have no act assigned`,
                scenePaths: noAct.map(s => s.filePath),
            });
        }

        // Act balance — warn if one act has 3x the scenes of another
        const actCounts = new Map<number, number>();
        scenes.forEach(s => {
            if (s.act !== undefined) {
                const a = Number(s.act);
                actCounts.set(a, (actCounts.get(a) || 0) + 1);
            }
        });
        if (actCounts.size >= 2) {
            const counts = Array.from(actCounts.values());
            const maxCount = Math.max(...counts);
            const minCount = Math.min(...counts);
            if (minCount > 0 && maxCount / minCount >= 3) {
                const maxAct = Array.from(actCounts.entries()).find(([, v]) => v === maxCount)![0];
                const minAct = Array.from(actCounts.entries()).find(([, v]) => v === minCount)![0];
                warnings.push({
                    severity: 'info',
                    category: 'Structure',
                    message: `Act imbalance: Act ${maxAct} has ${maxCount} scenes vs Act ${minAct} with ${minCount} scenes (${(maxCount / minCount).toFixed(1)}× ratio)`,
                });
            }
        }
    }
}
/* eslint-enable @typescript-eslint/no-unnecessary-type-assertion -- end of file-wide suppression block opened at line 1 */
