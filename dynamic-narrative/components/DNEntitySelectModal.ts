/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
import { App, Modal, Notice } from 'obsidian';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';

interface SelectableEntity {
    path: string;
    title: string;
    category: string;
    typeLabel: string;
}

export class DNEntitySelectModal extends Modal {
    private manager: DynamicNarrativeManager;
    private entityType: 'objective-variant' | 'arc-variant' | 'quest';
    private onSelect: (path: string, copies: number) => Promise<number> | number;
    private items: SelectableEntity[] = [];
    private listEl: HTMLElement | null = null;
    private searchText = '';
    private copies = 1;
    private isAdding = false;

    constructor(
        app: App,
        manager: DynamicNarrativeManager,
        entityType: 'objective-variant' | 'arc-variant' | 'quest',
        onSelect: (path: string, copies: number) => Promise<number> | number,
    ) {
        super(app);
        this.manager = manager;
        this.entityType = entityType;
        this.onSelect = onSelect;
    }

    private getLabel(): string {
        switch (this.entityType) {
            case 'objective-variant': return 'Objective Variant';
            case 'arc-variant': return 'Arc Variant';
            case 'quest': return 'Quest';
        }
    }

    private getItems(): SelectableEntity[] {
        const results: SelectableEntity[] = [];
        switch (this.entityType) {
            case 'objective-variant': {
                for (const v of this.manager.getAllObjectiveVariants()) {
                    const type = this.manager.getObjectiveType(v.objectiveTypeId);
                    results.push({
                        path: v.filePath,
                        title: v.title,
                        category: v.category,
                        typeLabel: type ? `Type: ${type.title}` : '',
                    });
                }
                break;
            }
            case 'arc-variant': {
                for (const v of this.manager.getAllArcVariants()) {
                    const type = this.manager.getArcType(v.arcTypeId);
                    results.push({
                        path: v.filePath,
                        title: v.title,
                        category: v.category,
                        typeLabel: type ? `Type: ${type.title}` : '',
                    });
                }
                break;
            }
            case 'quest': {
                for (const q of this.manager.getAllQuests()) {
                    results.push({
                        path: q.filePath,
                        title: q.title,
                        category: q.category,
                        typeLabel: '',
                    });
                }
                break;
            }
        }
        return results;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dn-entity-select-modal');
        this.titleEl.setText(`Add ${this.getLabel()}`);
        this.items = this.getItems();

        const controls = contentEl.createDiv('dn-entity-select-controls');
        const searchField = controls.createDiv('dn-entity-select-search-field');
        searchField.createEl('label', { text: 'Filter', cls: 'dn-modal-label' });
        const searchInput = searchField.createEl('input', {
            type: 'text',
            cls: 'dn-modal-input',
            attr: { placeholder: `Search ${this.getLabel().toLowerCase()}s...`, autocomplete: 'off' },
        });
        searchInput.value = this.searchText;
        searchInput.addEventListener('input', () => {
            this.searchText = searchInput.value;
            this.renderList();
        });

        const copiesField = controls.createDiv('dn-entity-select-copies-field');
        copiesField.createEl('label', { text: 'Number of copies', cls: 'dn-modal-label' });
        const copiesInput = copiesField.createEl('input', {
            type: 'number',
            cls: 'dn-modal-input',
            attr: { min: '1', step: '1', inputmode: 'numeric' },
        });
        copiesInput.value = String(this.copies);
        copiesInput.addEventListener('input', () => {
            const value = Number.parseInt(copiesInput.value, 10);
            this.copies = Number.isInteger(value) && value > 0 ? value : 1;
        });

        this.listEl = contentEl.createDiv('dn-entity-select-list');
        this.renderList();

        const actions = contentEl.createDiv('dn-entity-select-actions');
        const doneBtn = actions.createEl('button', { text: 'Done', cls: 'mod-cta' });
        doneBtn.addEventListener('click', () => this.close());
        searchInput.focus();
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.empty();
        const query = this.searchText.trim().toLowerCase();
        const filtered = query
            ? this.items.filter(item => `${item.title} ${item.category} ${item.typeLabel} ${item.path}`.toLowerCase().includes(query))
            : this.items;

        if (filtered.length === 0) {
            this.listEl.createDiv('dn-entity-select-empty').setText('No matching entities.');
            return;
        }

        for (const item of filtered) {
            const itemEl = this.listEl.createEl('button', {
                cls: 'dn-entity-select-item',
                attr: { type: 'button' },
            });
            const titleEl = itemEl.createSpan('dn-select-title');
            titleEl.setText(item.title);
            if (item.category) itemEl.createSpan('dn-select-category').setText(item.category);
            if (item.typeLabel) itemEl.createSpan('dn-select-type').setText(item.typeLabel);
            itemEl.addEventListener('click', () => {
                void this.addCopies(item.path);
            });
        }
    }

    private async addCopies(path: string): Promise<void> {
        if (this.isAdding) return;
        this.isAdding = true;
        try {
            const added = await this.onSelect(path, this.copies);
            const label = added === 1 ? 'copy' : 'copies';
            new Notice(`Added ${added} ${label}.`);
        } finally {
            this.isAdding = false;
        }
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
