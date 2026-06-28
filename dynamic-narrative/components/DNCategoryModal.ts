/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
import { Modal, App, setIcon } from 'obsidian';
import type { DNEntityType } from '../models/types';
import {
    DEFAULT_SCENARIO_CATEGORIES,
    DEFAULT_OBJECTIVE_CATEGORIES,
    DEFAULT_ARC_CATEGORIES,
    DEFAULT_QUEST_CATEGORIES,
} from '../models/types';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';

export class DNCategoryModal extends Modal {
    private manager: DynamicNarrativeManager;
    private entityType: DNEntityType;
    private onCloseCallback: () => void;

    constructor(
        app: App,
        manager: DynamicNarrativeManager,
        entityType: DNEntityType,
        onCloseCallback: () => void,
    ) {
        super(app);
        this.manager = manager;
        this.entityType = entityType;
        this.onCloseCallback = onCloseCallback;
    }

    onOpen(): void {
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dn-category-modal');

        const typeLabel = this.entityType.charAt(0).toUpperCase() + this.entityType.slice(1);
        contentEl.createEl('h3', { text: `Manage ${typeLabel} categories` });

        const categories = this.manager.getCategories(this.entityType);
        const defaults = this.getDefaults();

        const list = contentEl.createDiv('dn-category-list');

        for (const cat of categories) {
            const item = list.createDiv('dn-category-item');
            const isDefault = defaults.includes(cat);

            item.createSpan('dn-category-name').setText(cat);

            if (isDefault) {
                const badge = item.createSpan('dn-category-default-badge');
                badge.setText('default');
            } else {
                const deleteBtn = item.createEl('button', { cls: 'dn-category-delete-btn' });
                setIcon(deleteBtn, 'trash-2');
                deleteBtn.setAttribute('aria-label', `Remove ${cat}`);
                deleteBtn.addEventListener('click', () => {
                    this.manager.removeCategory(this.entityType, cat);
                    this.render();
                });
            }
        }

        const addSection = contentEl.createDiv('dn-category-add');
        const addInput = addSection.createEl('input', {
            type: 'text',
            cls: 'dn-category-add-input',
            placeholder: 'New category name...',
        });
        const addBtn = addSection.createEl('button', {
            text: 'Add',
            cls: 'dn-category-add-btn mod-cta',
        });
        addBtn.addEventListener('click', () => {
            const name = addInput.value.trim();
            if (!name) return;
            if (categories.includes(name)) return;
            this.manager.addCategory(this.entityType, name);
            addInput.value = '';
            this.render();
        });
        addInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                addBtn.click();
            }
        });

        const closeBtn = contentEl.createEl('button', {
            text: 'Close',
            cls: 'dn-category-close-btn',
        });
        closeBtn.addEventListener('click', () => this.close());
    }

    private getDefaults(): string[] {
        switch (this.entityType) {
            case 'scenario': return DEFAULT_SCENARIO_CATEGORIES;
            case 'objective': return DEFAULT_OBJECTIVE_CATEGORIES;
            case 'arc': return DEFAULT_ARC_CATEGORIES;
            case 'quest': return DEFAULT_QUEST_CATEGORIES;
        }
    }

    onClose(): void {
        this.contentEl.empty();
        this.onCloseCallback();
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
