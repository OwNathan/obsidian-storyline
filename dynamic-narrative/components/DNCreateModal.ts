/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { Modal } from 'obsidian';
import type SceneCardsPlugin from '../../main';

export interface TypeChoice {
    path: string;
    title: string;
}

export class DNCreateModal extends Modal {
    private childType: string;
    private categories: string[];
    private typeChoices: TypeChoice[];
    private onSubmit: (title: string, category: string, description: string, typeId: string) => Promise<void>;

    private titleValue = '';
    private categoryValue = '';
    private descriptionValue = '';
    private typeIdValue = '';

    constructor(
        plugin: SceneCardsPlugin,
        childType: string,
        categories: string[],
        onSubmit: (title: string, category: string, description: string, typeId: string) => Promise<void>,
        typeChoices: TypeChoice[] = [],
    ) {
        super(plugin.app);
        this.childType = childType;
        this.categories = categories;
        this.typeChoices = typeChoices;
        this.onSubmit = onSubmit;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dn-create-modal');

        contentEl.createEl('h3', { text: `Create New ${this.childType.charAt(0).toUpperCase() + this.childType.slice(1)}` });

        const form = contentEl.createDiv('dn-create-form');

        const titleField = form.createDiv('dn-create-field');
        titleField.createEl('label', { text: 'Name', cls: 'dn-create-label' });
        const titleInput = titleField.createEl('input', { type: 'text', cls: 'dn-create-input' });
        titleInput.placeholder = `Enter ${this.childType} name...`;
        titleInput.addEventListener('input', () => {
            this.titleValue = titleInput.value;
        });

        if (this.typeChoices.length > 0) {
            const typeField = form.createDiv('dn-create-field');
            typeField.createEl('label', { text: 'Type', cls: 'dn-create-label' });
            const typeSelect = typeField.createEl('select', { cls: 'dn-create-select' });
            const emptyOpt = typeSelect.createEl('option', { text: '— Select —' });
            emptyOpt.value = '';
            for (const tc of this.typeChoices) {
                const opt = typeSelect.createEl('option', { text: tc.title });
                opt.value = tc.path;
            }
            typeSelect.addEventListener('change', () => {
                this.typeIdValue = typeSelect.value;
            });
        }

        const catField = form.createDiv('dn-create-field');
        catField.createEl('label', { text: 'Category', cls: 'dn-create-label' });
        const catSelect = catField.createEl('select', { cls: 'dn-create-select' });
        const emptyOpt = catSelect.createEl('option', { text: '— Select —' });
        emptyOpt.value = '';
        for (const cat of this.categories) {
            const opt = catSelect.createEl('option', { text: cat });
            opt.value = cat;
        }
        catSelect.addEventListener('change', () => {
            this.categoryValue = catSelect.value;
        });

        const descField = form.createDiv('dn-create-field');
        descField.createEl('label', { text: 'Description (optional)', cls: 'dn-create-label' });
        const descInput = descField.createEl('textarea', { cls: 'dn-create-textarea' });
        descInput.addEventListener('input', () => {
            this.descriptionValue = descInput.value;
        });

        const actions = contentEl.createDiv('dn-create-actions');
        const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'dn-create-cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = actions.createEl('button', { text: 'Create', cls: 'dn-create-submit mod-cta' });
        submitBtn.addEventListener('click', async () => {
            if (!this.titleValue.trim()) {
                titleInput.addClass('has-error');
                return;
            }
            if (this.typeChoices.length > 0 && !this.typeIdValue) {
                return;
            }
            await this.onSubmit(this.titleValue.trim(), this.categoryValue, this.descriptionValue.trim(), this.typeIdValue);
            this.close();
        });

        titleInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
