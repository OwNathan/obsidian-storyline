/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon, Menu, TFile, Modal } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { ObjectiveType } from '../models/Objective';
import type { ArcType } from '../models/Arc';
import { isDefaultPhase, debounce } from '../models/types';
import { DNPhaseModal } from './DNPhaseModal';

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
    }

    destroy(): void {
        this.containerEl.empty();
        this.containerEl.removeClass('dn-type-grid');
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
        const debouncedRender = debounce(() => this.render(), 200);
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
        createBtn.addEventListener('click', async () => {
            if (this.entityType === 'objective-type') {
                await this.manager.createObjectiveType({ title: `New ${label}` });
            } else {
                await this.manager.createArcType({ title: `New ${label}` });
            }
            this.render();
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
                metaRow.createSpan('dn-type-cat-badge').setText(entity.category);
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

        panel.createDiv('dn-type-editor-title').setText(entity.title);

        const form = panel.createDiv('dn-type-editor-form');

        this.renderField(form, 'Title', 'text', entity.title, [], async (val) => {
            if (this.entityType === 'objective-type') {
                await this.manager.updateObjectiveType(entity.filePath, { title: val });
            } else {
                await this.manager.updateArcType(entity.filePath, { title: val });
            }
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
                this.manager.addCustomPhase(entity, {
                    ...phase,
                    isDefault: false,
                });
                if (this.entityType === 'objective-type') {
                    await this.manager.updateObjectiveType(entity.filePath, { phases: entity.phases });
                } else {
                    await this.manager.updateArcType(entity.filePath, { phases: entity.phases });
                }
                this.render();
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
                    this.manager.removeCustomPhase(entity, phase.name);
                    if (this.entityType === 'objective-type') {
                        await this.manager.updateObjectiveType(entity.filePath, { phases: entity.phases });
                    } else {
                        await this.manager.updateArcType(entity.filePath, { phases: entity.phases });
                    }
                    this.render();
                });
            }

            const toggle = phaseHeader.createSpan('dn-phase-toggle');
            setIcon(toggle, 'chevron-down');

            const phaseBody = phaseEl.createDiv('dn-phase-body');

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

            let collapsed = false;
            phaseHeader.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                if (target.closest('.dn-phase-delete-btn')) return;
                collapsed = !collapsed;
                phaseBody.style.display = collapsed ? 'none' : '';
                toggle.empty();
                setIcon(toggle, collapsed ? 'chevron-right' : 'chevron-down');
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
            this.manager.renameCustomPhase(entity, currentName, val);
            if (this.entityType === 'objective-type') {
                await this.manager.updateObjectiveType(entity.filePath, { phases: entity.phases });
            } else {
                await this.manager.updateArcType(entity.filePath, { phases: entity.phases });
            }
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
