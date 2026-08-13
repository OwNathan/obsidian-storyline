/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unused-vars, no-useless-escape -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { SceneManager } from '../services/SceneManager';
import { renderViewSwitcher } from '../components/ViewSwitcher';
import * as obsidian from 'obsidian';
import type SceneCardsPlugin from '../main';

import { STATS_VIEW_TYPE } from '../constants';
import { applyMobileClass } from '../components/MobileAdapter';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { Scene, getStatusOrder, resolveStatusCfg } from '../models/Scene';
import { getActDisplayLabel } from '../utils/actChapter';
import { PlotWarning, Validator } from '../services/Validator';

/**
 * Statistics Dashboard View
 */
export class StatsView extends ItemView {
    private plugin: SceneCardsPlugin;
    private sceneManager: SceneManager;
    private rootContainer: HTMLElement | null = null;
    private sprintTimerId: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SceneCardsPlugin, sceneManager: SceneManager) {
        super(leaf);
        this.plugin = plugin;
        this.sceneManager = sceneManager;
    }

    getViewType(): string {
        return STATS_VIEW_TYPE;
    }

    getDisplayText(): string {
        const title = this.plugin?.sceneManager?.activeProject?.title;
        return title ? `StoryLine - ${title}` : 'StoryLine';
    }

    getIcon(): string {
        return 'bar-chart-2';
    }

    async onOpen(): Promise<void> {
        this.plugin.storyLeaf = this.leaf;
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('story-line-stats-container');
        applyMobileClass(container);
        this.rootContainer = container;

        await this.sceneManager.initialize();
        this.renderView(container);
    }

    async onClose(): Promise<void> {
        if (this.sprintTimerId) { window.clearInterval(this.sprintTimerId); this.sprintTimerId = null; }
    }

    // ════════════════════════════════════════════════════
    //  Main render
    // ════════════════════════════════════════════════════

    private renderView(container: HTMLElement): void {
        container.empty();

        // Toolbar
        const toolbar = container.createDiv('story-line-toolbar');
        const titleRow = toolbar.createDiv('story-line-title-row');
        titleRow.createEl('h3', { cls: 'story-line-view-title', text: 'StoryLine' });

        renderViewSwitcher(toolbar, STATS_VIEW_TYPE, this.plugin, this.leaf);

        const content = container.createDiv('story-line-stats-content');
        const stats = this.sceneManager.queryService.getStatistics(this.plugin.settings.excludeArcAnchorFromWordcount ?? true);
        const allScenes = this.sceneManager.getAllScenes();

        // 1. Overview
        this.renderOverview(content, stats);

        // 2. Writing History (collapsible, default open)
        this.renderCollapsible(content, 'calendar', 'Writing History', true, body =>
            this.renderWritingHistory(body));

        // 3. Progress Breakdown (collapsible, default open)
        this.renderCollapsible(content, 'list-checks', 'Progress Breakdown', true, body =>
            this.renderProgressBreakdown(body, stats, allScenes));

        // 4. Characters & World (collapsible, default collapsed)
        this.renderCollapsible(content, 'users', 'Characters & World', false, body =>
            this.renderCharactersWorld(body, stats, allScenes));

        // 5. Warnings & Plot Holes (collapsible, default collapsed)
        this.renderCollapsible(content, 'alert-triangle', 'Warnings & Plot Holes', false, body =>
            this.renderWarnings(body, allScenes));
    }

    // ════════════════════════════════════════════════════
    //  Collapsible section helper
    // ════════════════════════════════════════════════════

    private renderCollapsible(
        parent: HTMLElement,
        icon: string,
        title: string,
        defaultOpen: boolean,
        renderFn: (body: HTMLElement) => void,
    ): void {
        const details = parent.createEl('details', { cls: 'stats-collapsible' });
        if (defaultOpen) details.setAttribute('open', '');
        const summary = details.createEl('summary', { cls: 'stats-collapsible-summary' });
        const iconEl = summary.createSpan({ cls: 'stats-collapsible-icon' });
        obsidian.setIcon(iconEl, icon);
        summary.createSpan({ text: title });
        const body = details.createDiv('stats-collapsible-body');
        renderFn(body);
    }

    // ════════════════════════════════════════════════════
    //  1. Overview
    // ════════════════════════════════════════════════════

    private renderOverview(
        parent: HTMLElement,
        stats: ReturnType<SceneManager['getStatistics']>,
    ): void {
        const section = parent.createDiv('stats-section');
        section.createEl('h4', { text: 'Overview' });

        const row = section.createDiv('stats-sprint-row');
        this.createStatCard(row, 'file-text', 'Scenes', String(stats.totalScenes));
    }

    // ════════════════════════════════════════════════════
    //  2. Writing History
    // ════════════════════════════════════════════════════

    private renderWritingHistory(parent: HTMLElement): void {
        const history = this.plugin.writingTracker.getFullHistory();
        const entries = Object.entries(history)
            .map(([date, words]) => ({ date, words }))
            .sort((a, b) => a.date.localeCompare(b.date));

        if (entries.length < 2) {
            parent.createEl('p', { cls: 'stats-empty', text: 'Not enough history yet. Keep writing!' });
            return;
        }

        // Range selector
        const rangeBar = parent.createDiv('stats-history-range-bar');
        const ranges = [7, 30, 90, 0];
        const labels = ['7d', '30d', '90d', 'All'];
        const defaultRange = entries.length <= 30 ? 0 : 30;

        const renderChart = (days: number) => {
            parent.querySelector('.stats-history-chart-wrap')?.remove();
            const sliced = days > 0 ? entries.slice(-days) : entries;
            const wrap = parent.createDiv('stats-history-chart-wrap');

            // Daily bar chart
            this.renderHistoryBarChart(wrap, sliced);


        };

        ranges.forEach((days, i) => {
            const btn = rangeBar.createSpan({
                cls: `stats-range-btn${days === defaultRange ? ' active' : ''}`,
                text: labels[i],
            });
            btn.addEventListener('click', () => {
                rangeBar.querySelectorAll('.stats-range-btn').forEach(b => b.removeClass('active'));
                btn.addClass('active');
                renderChart(days);
            });
        });

        renderChart(defaultRange);
    }

    private renderHistoryBarChart(parent: HTMLElement, data: { date: string; words: number }[]): void {
        const maxVal = Math.max(...data.map(d => d.words), 1);
        const chart = parent.createDiv('stats-history-chart');
        for (const entry of data) {
            const col = chart.createDiv('stats-history-col');
            const hPct = (entry.words / maxVal) * 100;
            const bar = col.createDiv('stats-history-bar');
            bar.setCssStyles({ height: `${Math.max(2, hPct)}%` });
            bar.setAttribute('title', `${entry.date}: ${entry.words.toLocaleString()} words`);
            if (data.length <= 31) {
                col.createDiv({ cls: 'stats-history-label', text: entry.date.slice(5) });
            }
        }
    }

    // ════════════════════════════════════════════════════
    //  3. Progress Breakdown
    // ════════════════════════════════════════════════════

    private renderProgressBreakdown(
        parent: HTMLElement,
        stats: ReturnType<SceneManager['getStatistics']>,
        allScenes: Scene[],
    ): void {
        // ── Status breakdown ──
        const statusSec = parent.createDiv('stats-subsection');
        statusSec.createEl('h5', { cls: 'stats-subsection-title', text: 'Status breakdown' });
        const statusList = statusSec.createEl('ul', { cls: 'stats-list' });

        const allStatuses = getStatusOrder();
        for (const status of allStatuses) {
            const count = stats.statusCounts[status] || 0;
            const pct = stats.totalScenes > 0 ? Math.round((count / stats.totalScenes) * 100) : 0;
            const cfg = resolveStatusCfg(status);
            const li = statusList.createEl('li');
            const lic = li.createSpan({ cls: 'stats-status-entry' });
            const ico = lic.createSpan({ cls: 'stats-status-icon' });
            obsidian.setIcon(ico, cfg.icon);
            lic.createSpan({ text: ` ${cfg.label}: ${count} (${pct}%)` });
            const bar = li.createDiv('stats-bar');
            const fill = bar.createDiv('stats-bar-fill');
            fill.setCssStyles({
                width: `${pct}%`,
                backgroundColor: cfg.color,
            });
        }

        // ── Act balance ──
        // Numeric-aware compare so "Act 2" sorts before "Act 10" and
        // hierarchical labels like "Act 1.1" / "Act 1.10" stay in order.
        const actEntries = Object.entries(stats.actCounts).sort(([a], [b]) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
        );
        if (actEntries.length > 0) {
            const actSec = parent.createDiv('stats-subsection');
            actSec.createEl('h5', { cls: 'stats-subsection-title', text: 'Act balance' });
            for (const [act, count] of actEntries) {
                const pct = stats.totalScenes > 0 ? Math.round(((Number(count) || 0) / stats.totalScenes) * 100) : 0;
                const row = actSec.createDiv('stats-row');
                row.createSpan({ text: `${act}: ${Number(count) || 0} scenes` });
                const bar = row.createDiv('stats-bar');
                const fill = bar.createDiv('stats-bar-fill');
                fill.setCssStyles({ width: `${pct}%` });
                row.createSpan({ cls: 'stats-percent', text: `${pct}%` });
            }
        }
    }

    // ════════════════════════════════════════════════════
    //  4. Characters & World
    // ════════════════════════════════════════════════════

    private renderCharactersWorld(
        parent: HTMLElement,
        stats: ReturnType<SceneManager['getStatistics']>,
        allScenes: Scene[],
    ): void {
        // Build alias map so "Flora" and "Flora Blomkvist" merge into one entry
        const aliasMap = this.plugin.characterManager.buildAliasMap(
            this.plugin.settings?.characterAliases,
        );
        const resolve = (name: string): string =>
            aliasMap.get(name.toLowerCase()) || name;

        // Helper: merge frontmatter characters + LinkScanner body detections
        const sceneChars = (scene: Scene): Set<string> => {
            const chars = new Set<string>();
            if (scene.characters) scene.characters.forEach(c => chars.add(resolve(c)));
            try {
                const scanResult = this.plugin.linkScanner?.getResult(scene.filePath);
                if (scanResult?.characters) {
                    for (const c of scanResult.characters) chars.add(resolve(c));
                }
            } catch { /* LinkScanner not ready yet */ }
            return chars;
        };

        // ── Character scene coverage (merge aliases + LinkScanner) ──
        const charCounts: Record<string, number> = {};
        for (const scene of allScenes) {
            for (const c of sceneChars(scene)) charCounts[c] = (charCounts[c] || 0) + 1;
        }
        const charEntries = Object.entries(charCounts).sort(([, a], [, b]) => b - a);
        if (charEntries.length > 0) {
            const sec = parent.createDiv('stats-subsection');
            sec.createEl('h5', { cls: 'stats-subsection-title', text: 'Character scene coverage' });
            const maxC = Math.max(...charEntries.map(([, c]) => c), 1);
            const LIMIT = 15;
            const renderRows = (entries: [string, number][], container: HTMLElement) => {
                for (const [name, count] of entries) {
                    const row = container.createDiv('stats-row');
                    row.createSpan({ text: `${name}: ${count} scene${count !== 1 ? 's' : ''}` });
                    const bar = row.createDiv('stats-bar');
                    bar.createDiv('stats-bar-fill').setCssStyles({ width: `${(count / maxC) * 100}%` });
                }
            };
            renderRows(charEntries.slice(0, LIMIT), sec);
            if (charEntries.length > LIMIT) {
                const btn = sec.createEl('button', {
                    cls: 'stats-show-more-btn',
                    text: `Show ${charEntries.length - LIMIT} more…`,
                });
                btn.addEventListener('click', () => {
                    btn.remove();
                    renderRows(charEntries.slice(LIMIT), sec);
                });
            }
        }

        // ── Location frequency ──
        const locEntries = Object.entries(stats.locationCounts).sort(([, a], [, b]) => b - a);
        if (locEntries.length > 0) {
            const sec = parent.createDiv('stats-subsection');
            sec.createEl('h5', { cls: 'stats-subsection-title', text: 'Location frequency' });
            const maxL = Math.max(...locEntries.map(([, c]) => Number(c) || 0), 1);
            for (const [loc, count] of locEntries.slice(0, 15)) {
                const n = Number(count) || 0;
                const row = sec.createDiv('stats-row');
                row.createSpan({ text: `${loc}: ${n} scene${n !== 1 ? 's' : ''}` });
                const bar = row.createDiv('stats-bar');
                bar.createDiv('stats-bar-fill').setCssStyles({ width: `${(n / maxL) * 100}%` });
            }
        } else {
            parent.createEl('p', { cls: 'stats-empty', text: 'No location data.' });
        }

        // ── Character Appearance Heatmap (character × chapter) ──
        this.renderCharacterHeatmap(parent, allScenes, resolve, sceneChars);
    }

    private renderCharacterHeatmap(
        parent: HTMLElement,
        allScenes: Scene[],
        _resolve: (name: string) => string,
        sceneChars: (scene: Scene) => Set<string>,
    ): void {
        // Build chapter list (sorted)
        const chapterSet = new Set<string>();
        for (const s of allScenes) {
            if (s.chapter !== undefined) chapterSet.add(String(s.chapter));
        }
        const chapters = Array.from(chapterSet).sort((a, b) =>
            // Numeric-aware string compare handles "2" vs "10" and "1.1" vs "1.10".
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
        );
        if (chapters.length < 2) return;

        // Build character × chapter matrix (includes LinkScanner detections)
        const charChapterMap: Record<string, Record<string, number>> = {};
        for (const s of allScenes) {
            const ch = s.chapter !== undefined ? String(s.chapter) : null;
            if (!ch) continue;
            for (const c of sceneChars(s)) {
                if (!charChapterMap[c]) charChapterMap[c] = {};
                charChapterMap[c][ch] = (charChapterMap[c][ch] || 0) + 1;
            }
        }

        // Sort characters by total appearances (descending), limit to top 15
        const charEntries = Object.entries(charChapterMap)
            .map(([name, counts]) => ({
                name,
                counts,
                total: Object.values(counts).reduce((s, c) => s + c, 0),
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 15);

        if (charEntries.length === 0) return;

        const maxCount = Math.max(...charEntries.flatMap(c => Object.values(c.counts)), 1);

        const sec = parent.createDiv('stats-subsection');
        sec.createEl('h5', { cls: 'stats-subsection-title', text: 'Character — chapter heatmap' });
        sec.createEl('p', { cls: 'stats-hint', text: 'Darker cells = more scene appearances in that chapter.' });

        // Issue #229 — wrap the heatmap in a horizontally scrollable
        // container so wide tables (many chapters) are clipped instead of
        // overflowing the Stats panel. A vertical max-height + scroll keeps
        // tall tables (many characters) readable too.
        const scrollWrap = sec.createDiv('stats-heatmap-scroll');
        const table = scrollWrap.createEl('table', { cls: 'stats-heatmap-table' });

        // Header row
        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');
        headerRow.createEl('th', { text: '' }); // empty corner
        for (const ch of chapters) {
            headerRow.createEl('th', { text: `Ch ${ch}`, cls: 'stats-heatmap-ch-header' });
        }

        // Data rows
        const tbody = table.createEl('tbody');
        for (const entry of charEntries) {
            const row = tbody.createEl('tr');
            row.createEl('td', { text: entry.name, cls: 'stats-heatmap-name' });
            for (const ch of chapters) {
                const count = entry.counts[ch] || 0;
                const cell = row.createEl('td', { cls: 'stats-heatmap-cell' });
                if (count > 0) {
                    const opacity = Math.max(0.15, count / maxCount);
                    cell.setCssStyles({ backgroundColor: `rgba(var(--sl-accent-rgb, 66, 150, 252), ${opacity})` });
                    cell.setAttribute('title', `${entry.name} in Ch ${ch}: ${count} scene${count !== 1 ? 's' : ''}`);
                    cell.textContent = String(count);
                }
            }
        }
    }

    // ════════════════════════════════════════════════════
    //  5. Warnings & Plot Holes
    // ════════════════════════════════════════════════════

    private renderWarnings(parent: HTMLElement, allScenes: Scene[]): void {
        if (this.plugin.settings.enablePlotHoleDetection && allScenes.length > 0) {
            const warnings = Validator.validate(allScenes);
            if (warnings.length === 0) {
                const ok = parent.createDiv('stats-ok');
                const ic = ok.createSpan();
                obsidian.setIcon(ic, 'check-circle');
                ok.createSpan({ text: ' No issues detected' });
            } else {
                const byCategory = new Map<string, PlotWarning[]>();
                for (const w of warnings) {
                    const arr = byCategory.get(w.category) || [];
                    arr.push(w);
                    byCategory.set(w.category, arr);
                }
                const errs = warnings.filter(w => w.severity === 'error').length;
                const warns = warnings.filter(w => w.severity === 'warning').length;
                const infos = warnings.filter(w => w.severity === 'info').length;

                const summary = parent.createDiv('stats-warning-summary');
                if (errs > 0) summary.createSpan({ cls: 'stats-severity-error', text: `${errs} error${errs > 1 ? 's' : ''}` });
                if (warns > 0) summary.createSpan({ cls: 'stats-severity-warning', text: `${warns} warning${warns > 1 ? 's' : ''}` });
                if (infos > 0) summary.createSpan({ cls: 'stats-severity-info', text: `${infos} info` });

                for (const [cat, cw] of byCategory) {
                    const catSec = parent.createDiv('stats-warning-category');
                    catSec.createEl('h5', { text: cat });
                    const list = catSec.createEl('ul', { cls: 'stats-list stats-warning-list' });
                    for (const w of cw) {
                        const li = list.createEl('li', { cls: `stats-severity-${w.severity}` });
                        const ic = li.createSpan({ cls: 'stats-warning-icon' });
                        switch (w.severity) {
                            case 'error': obsidian.setIcon(ic, 'x-circle'); break;
                            case 'warning': obsidian.setIcon(ic, 'alert-triangle'); break;
                            case 'info': obsidian.setIcon(ic, 'info'); break;
                        }
                        li.createSpan({ text: ` ${w.message}` });
                    }
                }
            }
        } else if (allScenes.length === 0) {
            parent.createEl('p', { text: 'No scenes to analyze.' });
        } else {
            parent.createEl('p', {
                cls: 'stats-ok',
                text: 'Plot hole detection is disabled. Enable it in settings — advanced.',
            });
        }
    }

    // ════════════════════════════════════════════════════
    //  Shared helpers
    // ════════════════════════════════════════════════════

    private createStatCard(parent: HTMLElement, icon: string, label: string, value: string): void {
        const card = parent.createDiv('stats-sprint-card');
        const iconEl = card.createSpan({ cls: 'stats-sprint-card-icon' });
        obsidian.setIcon(iconEl, icon);
        card.createDiv({ cls: 'stats-sprint-card-value', text: value });
        card.createDiv({ cls: 'stats-sprint-card-label', text: label });
    }

    private median(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0
            ? sorted[mid]
            : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }

    /**
     * Public refresh called by the plugin on file changes
     */
    refresh(): void {
        if (this.rootContainer) {
            this.renderView(this.rootContainer);
        }
    }
}
/* eslint-enable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unused-vars, no-useless-escape -- end of file-wide suppression block opened at line 1 */
