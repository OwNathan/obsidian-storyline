/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon, Notice, TFile, Modal } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { Quest } from '../models/Quest';
import { debounce } from '../models/types';
import { DNPhaseModal } from './DNPhaseModal';
import { DNCreateModal } from './DNCreateModal';
import { getCategoryColorClass } from '../../utils/categoryColor';
import { AddCommentModal } from '../../components/AddCommentModal';
import { renderCommentCapsule } from '../../components/CommentCapsule';
import { openConfirmModal } from '../../components/ConfirmModal';
import { attachTooltip } from '../../components/Tooltip';
import { COMMENTS_VIEW_TYPE } from '../../constants';

type SortKey = 'name' | 'created' | 'modified' | 'category';
type SortDir = 'asc' | 'desc';

export class DNQuestGrid {
    private containerEl: HTMLElement;
    private manager: DynamicNarrativeManager;
    private plugin: SceneCardsPlugin;

    private selectedPath: string = '';
    private filterText = '';
    private filterCategory = '';
    private sortKey: SortKey = 'name';
    private sortDir: SortDir = 'asc';
    private collapsedPhases: Set<string> = new Set();

    constructor(
        containerEl: HTMLElement,
        manager: DynamicNarrativeManager,
        plugin: SceneCardsPlugin,
    ) {
        this.containerEl = containerEl;
        this.manager = manager;
        this.plugin = plugin;
    }

    render(): void {
        if (this.selectedPath && !this.manager.getEntity(this.selectedPath)) {
            this.selectedPath = '';
        }
        const prevScrollTop = this.getListScrollTop();
        const searchFocus = this.getSearchFocusState();
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

        this.restoreListState(prevScrollTop, searchFocus);
    }

    destroy(): void {
        this.containerEl.empty();
        this.containerEl.removeClass('dn-quest-grid');
    }

    private getListScrollTop(): number {
        const list = this.containerEl.querySelector('.dn-quest-list');
        return list ? list.scrollTop : 0;
    }

    private getSearchFocusState(): { caret: number } | null {
        const input = this.containerEl.querySelector('.dn-search-input') as HTMLInputElement | null;
        if (input && document.activeElement === input) {
            return { caret: input.selectionStart ?? input.value.length };
        }
        return null;
    }

    private restoreListState(prevScrollTop: number, searchFocus: { caret: number } | null): void {
        const list = this.containerEl.querySelector('.dn-quest-list');
        if (list) {
            if (prevScrollTop > 0) list.scrollTop = prevScrollTop;
            const selectedItem = list.querySelector('.dn-quest-list-item.is-selected') as HTMLElement | null;
            if (selectedItem) {
                const lr = list.getBoundingClientRect();
                const sr = selectedItem.getBoundingClientRect();
                if (sr.top < lr.top || sr.bottom > lr.bottom) {
                    selectedItem.scrollIntoView({ block: 'nearest' });
                }
            }
        }
        if (searchFocus) {
            const input = this.containerEl.querySelector('.dn-search-input') as HTMLInputElement | null;
            if (input) {
                input.focus();
                input.setSelectionRange(searchFocus.caret, searchFocus.caret);
            }
        }
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
        const debouncedRender = debounce(() => this.render(), 100);
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
        createBtn.addEventListener('click', () => {
            const modal = new DNCreateModal(
                this.plugin,
                'quest',
                this.manager.getCategories('quest'),
                async (title, category, description) => {
                    const quest = await this.manager.createQuest({ title, category, description });
                    this.selectedPath = quest.filePath;
                    this.render();
                },
            );
            modal.open();
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
                const badge = metaRow.createSpan('dn-quest-cat-badge');
                badge.setText(quest.category);
                badge.addClass(getCategoryColorClass(quest.category, this.manager.getCategories('quest')));
            }
            const phaseCount = quest.phases.length;
            metaRow.createSpan('dn-quest-phase-count').setText(`${phaseCount} phase${phaseCount !== 1 ? 's' : ''}`);

            item.addEventListener('click', () => {
                this.selectedPath = quest.filePath;
                this.render();
            });
        }
    }

    private renderEditorPanel(panel: HTMLElement): void {
        panel.empty();
        const quest = this.manager.getAllQuests().find(q => q.filePath === this.selectedPath);
        if (!quest) return;

        const titleRow = panel.createDiv('dn-quest-editor-title');
        titleRow.createSpan('dn-quest-editor-title-text').setText(quest.title);
        const actions = titleRow.createDiv('dn-editor-actions');

        const openBtn = actions.createEl('button', {
            cls: 'codex-detail-action-btn',
            attr: { 'aria-label': 'Open file' },
        });
        setIcon(openBtn.createSpan(), 'file');
        attachTooltip(openBtn, 'Open file');
        openBtn.addEventListener('click', () => this.openEntityFile(quest));

        const deleteBtn = actions.createEl('button', {
            cls: 'codex-detail-action-btn codex-detail-delete-btn',
            attr: { 'aria-label': 'Delete' },
        });
        setIcon(deleteBtn.createSpan(), 'trash');
        attachTooltip(deleteBtn, 'Delete');
        deleteBtn.addEventListener('click', () => this.confirmDeleteEntity(quest));

        const commentBtn = actions.createEl('button', {
            cls: 'codex-detail-action-btn',
            attr: { 'aria-label': 'Add comment' },
        });
        setIcon(commentBtn.createSpan(), 'message-square');
        attachTooltip(commentBtn, 'Add comment');
        commentBtn.addEventListener('click', () => this.openAddCommentModal(quest));

        const form = panel.createDiv('dn-quest-editor-form');

        this.renderField(form, 'Title', 'text', quest.title, [], async (val) => {
            const updated = await this.manager.updateQuest(quest.filePath, { title: val });
            if (updated) this.selectedPath = updated.filePath;
            this.render();
        });

        this.renderField(form, 'Category', 'select', quest.category, this.manager.getCategories('quest'), async (val) => {
            await this.manager.updateQuest(quest.filePath, { category: val });
            this.render();
        });

        this.renderField(form, 'Description', 'textarea', quest.description, [], async (val) => {
            await this.manager.updateQuest(quest.filePath, { description: val });
            this.render();
        });

        const phasesSection = form.createDiv('dn-phases-section');
        const phasesHeader = phasesSection.createDiv('dn-phases-header');
        phasesHeader.createDiv('dn-phases-title').setText('Phases');

        const addPhaseBtn = phasesHeader.createEl('button', { cls: 'dn-add-phase-btn', text: '+ add phase' });
        addPhaseBtn.addEventListener('click', () => {
            const modal = new DNPhaseModal(this.plugin.app, null, async (phase) => {
                this.manager.addCustomPhase(quest, {
                    ...phase,
                    isDefault: false,
                });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
                this.render();
            });
            modal.open();
        });

        const orderedPhases = this.manager.getOrderedPhasesForEntity(quest);
        for (const phase of orderedPhases) {
            const phaseEl = phasesSection.createDiv('dn-phase-accordion');
            if (!phase.isDefault) phaseEl.addClass('dn-phase-custom');

            const phaseHeader = phaseEl.createDiv('dn-phase-header');
            phaseHeader.createSpan('dn-phase-name').setText(phase.name);
            if (phase.isDefault) {
                phaseHeader.createSpan('dn-phase-default-badge').setText('default');
            } else {
                const renameBtn = phaseHeader.createEl('button', { cls: 'dn-phase-rename-btn' });
                setIcon(renameBtn, 'pencil');
                renameBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openRenamePhaseModal(quest, phase.name);
                });

                const deleteBtn = phaseHeader.createEl('button', { cls: 'dn-phase-delete-btn' });
                setIcon(deleteBtn, 'trash-2');
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    this.manager.removeCustomPhase(quest, phase.name);
                    await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
                    this.render();
                });
            }

            const toggle = phaseHeader.createSpan('dn-phase-toggle');
            const phaseKey = `${quest.filePath}::${phase.name}`;
            const isCollapsed = this.collapsedPhases.has(phaseKey);
            setIcon(toggle, isCollapsed ? 'chevron-right' : 'chevron-down');

            const phaseBody = phaseEl.createDiv('dn-phase-body');
            phaseBody.style.display = isCollapsed ? 'none' : '';

            this.renderCollapsiblePhaseField(phaseBody, 'Description', phase.description, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { description: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            this.renderCollapsiblePhaseField(phaseBody, 'Start Conditions', phase.startConditions, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { startConditions: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            this.renderCollapsiblePhaseField(phaseBody, 'End Conditions', phase.endConditions, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { endConditions: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            this.renderCollapsiblePhaseField(phaseBody, 'Start Commands', phase.startCommands, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { startCommands: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            this.renderCollapsiblePhaseField(phaseBody, 'End Commands', phase.endCommands, async (val) => {
                this.manager.updatePhaseFields(quest, phase.name, { endCommands: val });
                await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            });

            phaseHeader.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                if (target.closest('.dn-phase-delete-btn') || target.closest('.dn-phase-rename-btn')) return;
                if (this.collapsedPhases.has(phaseKey)) {
                    this.collapsedPhases.delete(phaseKey);
                } else {
                    this.collapsedPhases.add(phaseKey);
                }
                const isNowCollapsed = this.collapsedPhases.has(phaseKey);
                phaseBody.style.display = isNowCollapsed ? 'none' : '';
                toggle.empty();
                setIcon(toggle, isNowCollapsed ? 'chevron-right' : 'chevron-down');
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

        this.renderCommentsSection(panel);
    }

    private renderCommentsSection(panel: HTMLElement): void {
        if (!this.plugin.commentsManager) return;
        const comments = this.plugin.commentsManager.getCommentsForFile(this.selectedPath);
        if (!comments || comments.length === 0) return;

        const section = panel.createDiv('dn-usage-comments');
        section.createDiv('dn-section-title').setText('Comments');

        const capsuleRow = section.createDiv('sl-comments-capsule-row');
        for (const comment of comments) {
            renderCommentCapsule(
                capsuleRow,
                comment.title,
                comment.status,
                comment.filePath,
                (filePath: string) => {
                    this.plugin.activateView(COMMENTS_VIEW_TYPE);
                    const leaves = this.plugin.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
                    for (const leaf of leaves) {
                        const view = leaf.view as unknown as { selectComment?: (path: string) => void };
                        if (view && typeof view.selectComment === 'function') {
                            view.selectComment(filePath);
                            this.plugin.app.workspace.revealLeaf(leaf);
                            break;
                        }
                    }
                },
            );
        }
    }

    private openAddCommentModal(quest: Quest): void {
        if (!this.plugin.commentsManager) return;
        const commentsFolder = this.plugin.sceneManager.getCommentsFolder();
        if (!commentsFolder) return;
        new AddCommentModal(
            this.plugin.app,
            this.plugin.commentsManager,
            commentsFolder,
            quest.filePath,
            quest.title,
            'quest',
            () => this.render(),
        ).open();
    }

    private openEntityFile(quest: Quest): void {
        const file = this.plugin.app.vault.getAbstractFileByPath(quest.filePath);
        if (file instanceof TFile) {
            const leaf = this.plugin.app.workspace.getLeaf('tab');
            leaf.openFile(file, { state: { mode: 'source', source: false } });
        } else {
            new Notice(`Could not find file: ${quest.filePath}`);
        }
    }

    private confirmDeleteEntity(quest: Quest): void {
        openConfirmModal(this.plugin.app, {
            title: 'Delete quest',
            message: `Are you sure you want to delete "${quest.title}"? The file will be moved to trash.`,
            confirmLabel: 'Delete',
            onConfirm: async () => {
                await this.manager.deleteQuest(quest.filePath);
                this.selectedPath = '';
                this.render();
                new Notice(`"${quest.title}" deleted`);
            },
        });
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
            const emptyOpt = (input as HTMLSelectElement).createEl('option', { text: '— select —' });
            emptyOpt.value = '';
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

    private renderCollapsiblePhaseField(
        container: HTMLElement,
        label: string,
        value: string,
        onChange: (val: string) => Promise<void>,
    ): void {
        const wrapper = container.createDiv('dn-collapsible-field');
        const header = wrapper.createDiv('dn-collapsible-header');
        const toggle = header.createSpan('dn-collapsible-toggle');
        const labelEl = header.createSpan('dn-collapsible-label');

        const isEmpty = !value;
        labelEl.setText(isEmpty ? `${label} (empty)` : label);
        setIcon(toggle, isEmpty ? 'chevron-right' : 'chevron-down');

        const body = wrapper.createDiv('dn-collapsible-body');
        body.style.display = isEmpty ? 'none' : '';

        const input = body.createEl('textarea', { cls: 'dn-collapsible-input' });
        (input as HTMLTextAreaElement).value = value;
        this.autoResizeTextarea(input as HTMLTextAreaElement);
        input.addEventListener('input', () => {
            this.autoResizeTextarea(input as HTMLTextAreaElement);
        });
        input.addEventListener('change', async () => {
            await onChange((input as HTMLTextAreaElement).value);
        });

        header.addEventListener('click', () => {
            const isCollapsed = body.style.display === 'none';
            body.style.display = isCollapsed ? '' : 'none';
            toggle.empty();
            setIcon(toggle, isCollapsed ? 'chevron-down' : 'chevron-right');
            if (!isCollapsed) {
                this.autoResizeTextarea(input as HTMLTextAreaElement);
            }
        });
    }

    private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    private openRenamePhaseModal(quest: Quest, currentName: string): void {
        const modal = new Modal(this.plugin.app);
        modal.titleEl.setText('Rename phase');
        const content = modal.contentEl.createDiv('dn-rename-modal');
        const input = content.createEl('input', {
            type: 'text',
            cls: 'dn-rename-input',
            value: currentName,
        });
        const actions = content.createDiv('dn-modal-actions');
        const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'dn-modal-cancel' });
        cancelBtn.addEventListener('click', () => modal.close());
        const submitBtn = actions.createEl('button', { text: 'Rename', cls: 'dn-modal-submit mod-cta' });
        submitBtn.addEventListener('click', async () => {
            const val = input.value.trim();
            if (!val || val === currentName) { modal.close(); return; }
            this.manager.renameCustomPhase(quest, currentName, val);
            await this.manager.updateQuest(quest.filePath, { phases: quest.phases });
            modal.close();
            this.render();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitBtn.click();
        });
        input.focus();
        modal.open();
    }

    private getFilteredQuests(): Quest[] {
        let quests = this.manager.getAllQuests();

        if (this.filterText) {
            quests = quests.filter(q =>
                q.title.toLowerCase().includes(this.filterText) ||
                q.description.toLowerCase().includes(this.filterText)
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
