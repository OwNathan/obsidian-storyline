/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon, Menu, TFile, Modal, Notice } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { ObjectiveType } from '../models/Objective';
import type { ArcType } from '../models/Arc';
import { isDefaultPhase, debounce } from '../models/types';
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

export class DNTypeGrid {
    private containerEl: HTMLElement;
    private manager: DynamicNarrativeManager;
    private plugin: SceneCardsPlugin;
    private entityType: 'objective-type' | 'arc-type';

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
        entityType: 'objective-type' | 'arc-type',
    ) {
        this.containerEl = containerEl;
        this.manager = manager;
        this.plugin = plugin;
        this.entityType = entityType;
    }

    render(): void {
        if (this.selectedPath && !this.manager.getEntity(this.selectedPath)) {
            this.selectedPath = '';
        }
        const prevScrollTop = this.getListScrollTop();
        const searchFocus = this.getSearchFocusState();
        this.containerEl.empty();
        this.containerEl.addClass('dn-type-grid');

        const layout = this.containerEl.createDiv('dn-type-layout');
        const listPanel = layout.createDiv('dn-type-list-panel');
        const editorPanel = layout.createDiv('dn-type-editor-panel');
        const usagePanel = layout.createDiv('dn-type-usage-panel');

        this.renderListPanel(listPanel);

        if (this.selectedPath) {
            this.renderEditorPanel(editorPanel);
            this.renderUsagePanel(usagePanel);
        } else {
            editorPanel.createDiv('dn-empty-state').setText('Select a type to edit.');
            usagePanel.empty();
        }

        this.restoreListState(prevScrollTop, searchFocus);
    }

    destroy(): void {
        this.containerEl.empty();
        this.containerEl.removeClass('dn-type-grid');
    }

    private getListScrollTop(): number {
        const list = this.containerEl.querySelector('.dn-type-list');
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
        const list = this.containerEl.querySelector('.dn-type-list');
        if (list) {
            if (prevScrollTop > 0) list.scrollTop = prevScrollTop;
            const selectedItem = list.querySelector('.dn-type-list-item.is-selected') as HTMLElement | null;
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

    private getEntities(): Array<ObjectiveType | ArcType> {
        if (this.entityType === 'objective-type') {
            return this.manager.getAllObjectiveTypes();
        }
        return this.manager.getAllArcTypes();
    }

    private getTypeLabel(): string {
        if (this.entityType === 'objective-type') return 'Objective Type';
        return 'Arc Type';
    }

    private getVariantLabel(): string {
        if (this.entityType === 'objective-type') return 'Objective Variant';
        return 'Arc Variant';
    }

    private getCategories(): string[] {
        return this.manager.getCategories(this.entityType);
    }

    private getVariantCount(entity: ObjectiveType | ArcType): number {
        return this.entityType === 'objective-type'
            ? this.manager.getObjectiveVariantsOfType(entity.filePath).length
            : this.manager.getArcVariantsOfType(entity.filePath).length;
    }

    private renderListPanel(panel: HTMLElement): void {
        panel.empty();
        const label = this.getTypeLabel();

        const toolbar = panel.createDiv('dn-type-toolbar');

        const searchInput = toolbar.createEl('input', {
            type: 'text',
            placeholder: `Search ${label.toLowerCase()}s...`,
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
        for (const cat of this.getCategories()) {
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

        const createBtn = toolbar.createEl('button', { cls: 'dn-create-btn', text: `+ New ${label}` });
        createBtn.addEventListener('click', () => {
            const modal = new DNCreateModal(
                this.plugin,
                this.entityType === 'objective-type' ? 'objective type' : 'arc type',
                this.getCategories(),
                async (title, category, description) => {
                    if (this.entityType === 'objective-type') {
                        const created = await this.manager.createObjectiveType({ title, category, description });
                        this.selectedPath = created.filePath;
                    } else {
                        const created = await this.manager.createArcType({ title, category, description });
                        this.selectedPath = created.filePath;
                    }
                    this.render();
                },
            );
            modal.open();
        });

        const list = panel.createDiv('dn-type-list');
        const entities = this.getFiltered();

        if (entities.length === 0) {
            list.createDiv('dn-empty-state').setText(`No ${label.toLowerCase()}s found.`);
            return;
        }

        for (const entity of entities) {
            const item = list.createDiv('dn-type-list-item');
            if (entity.filePath === this.selectedPath) item.addClass('is-selected');

            item.createDiv('dn-type-list-name').setText(entity.title);

            const metaRow = item.createDiv('dn-type-list-meta');
            if (entity.category) {
                const badge = metaRow.createSpan('dn-type-cat-badge');
                badge.setText(entity.category);
                badge.addClass(getCategoryColorClass(entity.category, this.getCategories()));
            }
            const phaseCount = entity.phases.length;
            metaRow.createSpan('dn-type-phase-count').setText(`${phaseCount} phase${phaseCount !== 1 ? 's' : ''}`);

            item.addEventListener('click', () => {
                this.selectedPath = entity.filePath;
                this.render();
            });
        }
    }

    private renderEditorPanel(panel: HTMLElement): void {
        panel.empty();
        const entities = this.getEntities();
        const entity = entities.find(e => e.filePath === this.selectedPath);
        if (!entity) return;

        const titleRow = panel.createDiv('dn-type-editor-title');
        titleRow.createSpan('dn-type-editor-title-text').setText(entity.title);
        const actions = titleRow.createDiv('dn-editor-actions');

        const openBtn = actions.createEl('button', {
            cls: 'codex-detail-action-btn',
            attr: { 'aria-label': 'Open file' },
        });
        setIcon(openBtn.createSpan(), 'file');
        attachTooltip(openBtn, 'Open file');
        openBtn.addEventListener('click', () => this.openEntityFile(entity));

        const deleteBtn = actions.createEl('button', {
            cls: 'codex-detail-action-btn codex-detail-delete-btn',
            attr: { 'aria-label': 'Delete' },
        });
        setIcon(deleteBtn.createSpan(), 'trash');
        attachTooltip(deleteBtn, 'Delete');
        deleteBtn.addEventListener('click', () => this.confirmDeleteEntity(entity));

        const commentBtn = actions.createEl('button', {
            cls: 'codex-detail-action-btn',
            attr: { 'aria-label': 'Add comment' },
        });
        setIcon(commentBtn.createSpan(), 'message-square');
        attachTooltip(commentBtn, 'Add comment');
        commentBtn.addEventListener('click', () => this.openAddCommentModal(entity));

        const form = panel.createDiv('dn-type-editor-form');

        this.renderField(form, 'Title', 'text', entity.title, [], async (val) => {
            const updated = this.entityType === 'objective-type'
                ? await this.manager.updateObjectiveType(entity.filePath, { title: val })
                : await this.manager.updateArcType(entity.filePath, { title: val });
            if (updated) this.selectedPath = updated.filePath;
            this.render();
        });

        this.renderField(form, 'Category', 'select', entity.category, this.getCategories(), async (val) => {
            if (this.entityType === 'objective-type') {
                await this.manager.updateObjectiveType(entity.filePath, { category: val });
            } else {
                await this.manager.updateArcType(entity.filePath, { category: val });
            }
            this.render();
        });

        this.renderField(form, 'Description', 'textarea', entity.description, [], async (val) => {
            if (this.entityType === 'objective-type') {
                await this.manager.updateObjectiveType(entity.filePath, { description: val });
            } else {
                await this.manager.updateArcType(entity.filePath, { description: val });
            }
            this.render();
        });

        const phasesSection = form.createDiv('dn-phases-section');
        const phasesHeader = phasesSection.createDiv('dn-phases-header');
        phasesHeader.createDiv('dn-phases-title').setText('Phases');

        const addPhaseBtn = phasesHeader.createEl('button', { cls: 'dn-add-phase-btn', text: '+ Add Phase' });
        addPhaseBtn.addEventListener('click', () => {
            const modal = new DNPhaseModal(this.plugin.app, null, async (phase) => {
                const variantCount = this.getVariantCount(entity);
                if (variantCount > 0) {
                    openConfirmModal(this.plugin.app, {
                        title: `Add phase to ${variantCount} variant${variantCount !== 1 ? 's' : ''}`,
                        message: `This type has ${variantCount} variant${variantCount !== 1 ? 's' : ''}. The phase "${phase.name}" will be added to all of them. Continue?`,
                        confirmLabel: 'Add & Propagate',
                        onConfirm: async () => {
                            await this.manager.addTypePhase(entity, { ...phase, isDefault: false });
                            this.render();
                        },
                    });
                } else {
                    await this.manager.addTypePhase(entity, { ...phase, isDefault: false });
                    this.render();
                }
            });
            modal.open();
        });

        const orderedPhases = this.manager.getOrderedPhasesForEntity(entity);
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
                    this.openRenamePhaseModal(entity, phase.name);
                });

                const deleteBtn = phaseHeader.createEl('button', { cls: 'dn-phase-delete-btn' });
                setIcon(deleteBtn, 'trash-2');
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const variantCount = this.getVariantCount(entity);
                    if (variantCount > 0) {
                        openConfirmModal(this.plugin.app, {
                            title: `Remove phase from ${variantCount} variant${variantCount !== 1 ? 's' : ''}`,
                            message: `This type has ${variantCount} variant${variantCount !== 1 ? 's' : ''}. The phase "${phase.name}" and its content in each variant will be removed. Continue?`,
                            confirmLabel: 'Remove & Propagate',
                            onConfirm: async () => {
                                await this.manager.removeTypePhase(entity, phase.name);
                                this.render();
                            },
                        });
                    } else {
                        await this.manager.removeTypePhase(entity, phase.name);
                        this.render();
                    }
                });
            }

            const toggle = phaseHeader.createSpan('dn-phase-toggle');
            const phaseKey = `${entity.filePath}::${phase.name}`;
            const isCollapsed = this.collapsedPhases.has(phaseKey);
            setIcon(toggle, isCollapsed ? 'chevron-right' : 'chevron-down');

            const phaseBody = phaseEl.createDiv('dn-phase-body');
            phaseBody.style.display = isCollapsed ? 'none' : '';

            this.renderCollapsiblePhaseField(phaseBody, 'Description', phase.description, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { description: val });
                if (this.entityType === 'objective-type') {
                    await this.manager.updateObjectiveType(entity.filePath, { phases: entity.phases });
                } else {
                    await this.manager.updateArcType(entity.filePath, { phases: entity.phases });
                }
            });

            this.renderCollapsiblePhaseField(phaseBody, 'Start Conditions', phase.startConditions, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { startConditions: val });
                if (this.entityType === 'objective-type') {
                    await this.manager.updateObjectiveType(entity.filePath, { phases: entity.phases });
                } else {
                    await this.manager.updateArcType(entity.filePath, { phases: entity.phases });
                }
            });

            this.renderCollapsiblePhaseField(phaseBody, 'End Conditions', phase.endConditions, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { endConditions: val });
                if (this.entityType === 'objective-type') {
                    await this.manager.updateObjectiveType(entity.filePath, { phases: entity.phases });
                } else {
                    await this.manager.updateArcType(entity.filePath, { phases: entity.phases });
                }
            });

            this.renderCollapsiblePhaseField(phaseBody, 'Start Commands', phase.startCommands, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { startCommands: val });
                if (this.entityType === 'objective-type') {
                    await this.manager.updateObjectiveType(entity.filePath, { phases: entity.phases });
                } else {
                    await this.manager.updateArcType(entity.filePath, { phases: entity.phases });
                }
            });

            this.renderCollapsiblePhaseField(phaseBody, 'End Commands', phase.endCommands, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { endCommands: val });
                if (this.entityType === 'objective-type') {
                    await this.manager.updateObjectiveType(entity.filePath, { phases: entity.phases });
                } else {
                    await this.manager.updateArcType(entity.filePath, { phases: entity.phases });
                }
            });

            phaseHeader.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                if (target.closest('.dn-phase-delete-btn')) return;
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
        panel.createDiv('dn-usage-title').setText('Variants');

        const variants = this.entityType === 'objective-type'
            ? this.manager.getObjectiveVariantsOfType(this.selectedPath)
            : this.manager.getArcVariantsOfType(this.selectedPath);

        if (variants.length === 0) {
            panel.createDiv('dn-usage-empty').setText(`No ${this.getVariantLabel().toLowerCase()}s reference this type.`);
            return;
        }

        const list = panel.createDiv('dn-usage-list');
        for (const variant of variants) {
            const item = list.createDiv('dn-usage-item');
            item.createSpan('dn-usage-item-name').setText(variant.title);
            if (variant.category) {
                item.createSpan('dn-usage-item-cat').setText(variant.category);
            }
        }

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

    private openAddCommentModal(entity: ObjectiveType | ArcType): void {
        if (!this.plugin.commentsManager) return;
        const commentsFolder = this.plugin.sceneManager.getCommentsFolder();
        if (!commentsFolder) return;
        const category = this.entityType === 'objective-type' ? 'objective' : 'arc';
        new AddCommentModal(
            this.plugin.app,
            this.plugin.commentsManager,
            commentsFolder,
            entity.filePath,
            entity.title,
            category,
            () => this.render(),
        ).open();
    }

    private openEntityFile(entity: ObjectiveType | ArcType): void {
        const file = this.plugin.app.vault.getAbstractFileByPath(entity.filePath);
        if (file instanceof TFile) {
            const leaf = this.plugin.app.workspace.getLeaf('tab');
            leaf.openFile(file, { state: { mode: 'source', source: false } });
        } else {
            new Notice(`Could not find file: ${entity.filePath}`);
        }
    }

    private confirmDeleteEntity(entity: ObjectiveType | ArcType): void {
        openConfirmModal(this.plugin.app, {
            title: `Delete ${this.getTypeLabel().toLowerCase()}`,
            message: `Are you sure you want to delete "${entity.title}"? The file will be moved to trash.`,
            confirmLabel: 'Delete',
            onConfirm: async () => {
                if (this.entityType === 'objective-type') {
                    const ok = await this.manager.deleteObjectiveType(entity.filePath);
                    if (!ok) return;
                } else {
                    const ok = await this.manager.deleteArcType(entity.filePath);
                    if (!ok) return;
                }
                this.selectedPath = '';
                this.render();
                new Notice(`"${entity.title}" deleted`);
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
            const emptyOpt = (input as HTMLSelectElement).createEl('option', { text: '— Select —' });
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

    private openRenamePhaseModal(entity: ObjectiveType | ArcType, currentName: string): void {
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
            await this.manager.renameTypePhase(entity, currentName, val);
            modal.close();
            this.render();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitBtn.click();
        });
        input.focus();
        modal.open();
    }

    private getFiltered(): Array<ObjectiveType | ArcType> {
        let entities = this.getEntities();

        if (this.filterText) {
            entities = entities.filter(e =>
                e.title.toLowerCase().includes(this.filterText) ||
                e.description.toLowerCase().includes(this.filterText)
            );
        }

        if (this.filterCategory) {
            entities = entities.filter(e => e.category === this.filterCategory);
        }

        entities.sort((a, b) => {
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

        return entities;
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
