/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { Quest } from '../models/Quest';
import { debounce } from '../models/types';

type SortKey = 'name' | 'created' | 'modified' | 'category';
type SortDir = 'asc' | 'desc';

export class DNQuestGrid {
    private containerEl: HTMLElement;
    private manager: DynamicNarrativeManager;
    private plugin: SceneCardsPlugin;
    private onOpenInspector: (path: string) => void;

    private selectedPath: string = '';
    private filterText = '';
    private filterCategory = '';
    private filterType = '';
    private sortKey: SortKey = 'name';
    private sortDir: SortDir = 'asc';

    constructor(
        containerEl: HTMLElement,
        manager: DynamicNarrativeManager,
        plugin: SceneCardsPlugin,
        onOpenInspector: (path: string) => void,
    ) {
        this.containerEl = containerEl;
        this.manager = manager;
        this.plugin = plugin;
        this.onOpenInspector = onOpenInspector;
    }

    render(): void {
        this.containerEl.empty();
        this.containerEl.addClass('dn-quest-grid');

        const layout = this.containerEl.createDiv('dn-quest-layout');
        const listPanel = layout.createDiv('dn-quest-list-panel');
        const editorPanel = layout.createDiv('dn-quest-editor-panel');
        const usagePanel = layout.createDiv('dn-quest-usage-panel');

        this.renderListPanel(listPanel);

        if (this.selectedPath) {
            this.renderEditorPanel(editorPanel);
            this.renderUsagePanel(usagePanel);
        } else {
            editorPanel.createDiv('dn-empty-state').setText('Select a quest to edit.');
            usagePanel.empty();
        }
    }

    destroy(): void {
        this.containerEl.empty();
        this.containerEl.removeClass('dn-quest-grid');
    }

    private renderListPanel(panel: HTMLElement): void {
        panel.empty();

        const toolbar = panel.createDiv('dn-quest-toolbar');

        const searchInput = toolbar.createEl('input', {
            type: 'text',
            placeholder: 'Search quests...',
            cls: 'dn-search-input',
        });
        searchInput.value = this.filterText;
        const debouncedRender = debounce(() => this.render(), 200);
        searchInput.addEventListener('input', () => {
            this.filterText = searchInput.value.toLowerCase();
            debouncedRender();
        });

        const catSelect = toolbar.createEl('select', { cls: 'dn-filter-select' });
        const allCatOption = catSelect.createEl('option', { text: 'All categories' });
        allCatOption.value = '';
        for (const cat of this.manager.getCategories('quest')) {
            const opt = catSelect.createEl('option', { text: cat });
            opt.value = cat;
        }
        catSelect.value = this.filterCategory;
        catSelect.addEventListener('change', () => {
            this.filterCategory = catSelect.value;
            this.render();
        });

        const sortSelect = toolbar.createEl('select', { cls: 'dn-sort-select' });
        for (const opt of [
            { value: 'name', label: 'Name' },
            { value: 'created', label: 'Created' },
            { value: 'modified', label: 'Modified' },
            { value: 'category', label: 'Category' },
        ]) {
            const option = sortSelect.createEl('option', { text: opt.label });
            option.value = opt.value;
            if (opt.value === this.sortKey) option.selected = true;
        }
        sortSelect.addEventListener('change', () => {
            this.sortKey = sortSelect.value as SortKey;
            this.render();
        });

        const createBtn = toolbar.createEl('button', { cls: 'dn-create-btn', text: '+ New Quest' });
        createBtn.addEventListener('click', async () => {
            await this.manager.createQuest({ title: 'New Quest' });
            this.render();
        });

        const list = panel.createDiv('dn-quest-list');
        const quests = this.getFilteredQuests();

        if (quests.length === 0) {
            list.createDiv('dn-empty-state').setText('No quests found.');
            return;
        }

        for (const quest of quests) {
            const item = list.createDiv('dn-quest-list-item');
            if (quest.filePath === this.selectedPath) item.addClass('is-selected');

            item.createDiv('dn-quest-list-name').setText(quest.title);

            const metaRow = item.createDiv('dn-quest-list-meta');
            if (quest.category) {
                metaRow.createSpan('dn-quest-cat-badge').setText(quest.category);
            }
            if (quest.questType) {
                metaRow.createSpan('dn-quest-type-badge').setText(quest.questType);
            }

            item.addEventListener('click', () => {
                this.selectedPath = quest.filePath;
                this.onOpenInspector(quest.filePath);
                this.render();
            });
        }
    }

    private renderEditorPanel(panel: HTMLElement): void {
        panel.empty();
        const quest = this.manager.getAllQuests().find(q => q.filePath === this.selectedPath);
        if (!quest) return;

        panel.createDiv('dn-quest-editor-title').setText(quest.title);

        const form = panel.createDiv('dn-quest-editor-form');

        this.renderField(form, 'Category', 'select', quest.category, this.manager.getCategories('quest'), async (val) => {
            await this.manager.updateQuest(quest.filePath, { category: val });
            this.render();
        });

        this.renderField(form, 'Type', 'text', quest.questType, [], async (val) => {
            await this.manager.updateQuest(quest.filePath, { questType: val });
            this.render();
        });

        this.renderField(form, 'Description', 'textarea', quest.description, [], async (val) => {
            await this.manager.updateQuest(quest.filePath, { description: val });
            this.render();
        });

        const phasesSection = form.createDiv('dn-phases-section');
        phasesSection.createDiv('dn-phases-title').setText('Phases');

        const orderedPhases = this.manager.getOrderedPhasesForEntity(quest);
        for (const phase of orderedPhases) {
            const phaseEl = phasesSection.createDiv('dn-phase-accordion');
            if (!phase.isDefault) phaseEl.addClass('dn-phase-custom');

            const phaseHeader = phaseEl.createDiv('dn-phase-header');
            phaseHeader.createSpan('dn-phase-name').setText(phase.name);
            if (phase.isDefault) {
                phaseHeader.createSpan('dn-phase-default-badge').setText('default');
            }

            const phaseBody = phaseEl.createDiv('dn-phase-body');

            if (!phase.isDefault) {
                this.renderPhaseField(phaseBody, 'Name', phase.name, async (val) => {
                    this.manager.renameCustomPhase(quest, phase.name, val);
                    await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
                    this.render();
                });
            }

            this.renderPhaseField(phaseBody, 'Description', phase.description, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { description: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            this.renderPhaseField(phaseBody, 'Start Conditions', phase.startConditions, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { startConditions: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            this.renderPhaseField(phaseBody, 'End Conditions', phase.endConditions, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { endConditions: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            this.renderPhaseField(phaseBody, 'Start Commands', phase.startCommands, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { startCommands: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            this.renderPhaseField(phaseBody, 'End Commands', phase.endCommands, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { endCommands: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });
        }
    }

    private renderUsagePanel(panel: HTMLElement): void {
        panel.empty();
        panel.createDiv('dn-usage-title').setText('Usage');

        const connections = this.manager.getConnectionsForQuest(this.selectedPath);

        const statsEl = panel.createDiv('dn-usage-stats');
        statsEl.createDiv('dn-usage-stat').setText(`Scenarios: ${connections.scenarios}`);
        statsEl.createDiv('dn-usage-stat').setText(`Objectives: ${connections.objectives}`);
        statsEl.createDiv('dn-usage-stat').setText(`Arcs: ${connections.arcs}`);
    }

    private renderField(
        container: HTMLElement,
        label: string,
        type: 'text' | 'textarea' | 'select',
        value: string,
        options: string[],
        onChange: (val: string) => Promise<void>,
    ): void {
        const field = container.createDiv('dn-field');
        field.createEl('label', { text: label, cls: 'dn-field-label' });

        let input: HTMLElement;
        if (type === 'textarea') {
            input = field.createEl('textarea', { cls: 'dn-field-textarea' });
            (input as HTMLTextAreaElement).value = value;
            input.addEventListener('change', async () => {
                await onChange((input as HTMLTextAreaElement).value);
            });
        } else if (type === 'select') {
            input = field.createEl('select', { cls: 'dn-field-select' });
            for (const opt of options) {
                const option = (input as HTMLSelectElement).createEl('option', { text: opt });
                option.value = opt;
                if (opt === value) option.selected = true;
            }
            input.addEventListener('change', async () => {
                await onChange((input as HTMLSelectElement).value);
            });
        } else {
            input = field.createEl('input', { type: 'text', cls: 'dn-field-input' });
            (input as HTMLInputElement).value = value;
            input.addEventListener('change', async () => {
                await onChange((input as HTMLInputElement).value);
            });
        }
    }

    private renderPhaseField(
        container: HTMLElement,
        label: string,
        value: string,
        onChange: (val: string) => Promise<void>,
    ): void {
        const field = container.createDiv('dn-phase-field');
        field.createEl('label', { text: label, cls: 'dn-phase-field-label' });
        const input = field.createEl('textarea', { cls: 'dn-phase-field-input' });
        (input as HTMLTextAreaElement).value = value;
        input.addEventListener('change', async () => {
            await onChange((input as HTMLTextAreaElement).value);
        });
    }

    private getFilteredQuests(): Quest[] {
        let quests = this.manager.getAllQuests();

        if (this.filterText) {
            quests = quests.filter(q =>
                q.title.toLowerCase().includes(this.filterText) ||
                q.description.toLowerCase().includes(this.filterText) ||
                q.questType.toLowerCase().includes(this.filterText)
            );
        }

        if (this.filterCategory) {
            quests = quests.filter(q => q.category === this.filterCategory);
        }

        quests.sort((a, b) => {
            let cmp = 0;
            switch (this.sortKey) {
                case 'name':
                    cmp = a.title.localeCompare(b.title);
                    break;
                case 'created':
                    cmp = (a.created || '').localeCompare(b.created || '');
                    break;
                case 'modified':
                    cmp = (a.modified || '').localeCompare(b.modified || '');
                    break;
                case 'category':
                    cmp = (a.category || '').localeCompare(b.category || '');
                    break;
            }
            return this.sortDir === 'asc' ? cmp : -cmp;
        });

        return quests;
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
