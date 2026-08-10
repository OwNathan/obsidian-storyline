/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { App, Modal } from 'obsidian';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { DNEntity } from '../models/types';

export class DNCloneModal extends Modal {
    private manager: DynamicNarrativeManager;
    private entity: DNEntity;
    private onSubmit: (newTitle: string) => Promise<void>;
    private submitting = false;

    constructor(
        app: App,
        manager: DynamicNarrativeManager,
        entity: DNEntity,
        onSubmit: (newTitle: string) => Promise<void>,
    ) {
        super(app);
        this.manager = manager;
        this.entity = entity;
        this.onSubmit = onSubmit;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dn-clone-modal');
        this.titleEl.setText(`Clone ${this.entity.type.replace(/-/g, ' ')}`);

        const field = contentEl.createDiv('dn-clone-field');
        field.createEl('label', { text: 'Name', cls: 'dn-clone-label' });
        const input = field.createEl('input', {
            type: 'text',
            cls: 'dn-clone-input',
            attr: { autocomplete: 'off' },
        });
        input.value = this.entity.title;

        const error = field.createDiv('dn-clone-error');
        const actions = contentEl.createDiv('dn-clone-actions');
        const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'dn-clone-cancel' });
        cancelBtn.addEventListener('click', () => this.close());
        const cloneBtn = actions.createEl('button', {
            text: 'Clone',
            cls: 'dn-clone-submit mod-cta',
            attr: { disabled: 'true' },
        });
        cloneBtn.disabled = true;

        const validate = (): string => {
            const value = input.value.trim();
            if (!value) return 'Enter a name.';
            if (value.toLowerCase() === this.entity.title.trim().toLowerCase()) {
                return 'Choose a name different from the original.';
            }
            if (this.manager.entityTitleExists(this.entity.type, value, this.entity.filePath)) {
                return 'An entity with this name already exists.';
            }
            return '';
        };

        const updateValidity = (): void => {
            const message = validate();
            error.setText(message);
            error.toggleClass('is-visible', Boolean(message));
            cloneBtn.disabled = Boolean(message) || this.submitting;
        };

        input.addEventListener('input', updateValidity);
        cloneBtn.addEventListener('click', async () => {
            if (this.submitting) return;
            const message = validate();
            if (message) {
                updateValidity();
                return;
            }
            this.submitting = true;
            cloneBtn.disabled = true;
            try {
                await this.onSubmit(input.value.trim());
                this.close();
            } finally {
                this.submitting = false;
            }
        });

        updateValidity();
        input.focus();
        input.select();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
