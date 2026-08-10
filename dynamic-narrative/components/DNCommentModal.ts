/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unused-vars, no-unused-vars -- Obsidian's modal callbacks are event-driven */
import { App, Modal } from 'obsidian';

export class DNCommentModal extends Modal {
    private value: string;
    private onSave: (comment: string) => Promise<void> | void;

    constructor(
        app: App,
        currentComment: string,
        onSave: (comment: string) => Promise<void> | void,
    ) {
        super(app);
        this.value = currentComment;
        this.onSave = onSave;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dn-comment-modal');
        this.titleEl.setText(this.value ? 'Edit comment' : 'Add comment');

        const field = contentEl.createDiv('dn-comment-modal-field');
        field.createEl('label', { text: 'Comment', cls: 'dn-modal-label' });
        const textarea = field.createEl('textarea', {
            cls: 'dn-modal-textarea',
            attr: { rows: '6', placeholder: 'Add a note for this linked instance...' },
        });
        textarea.value = this.value;
        textarea.addEventListener('input', () => {
            this.value = textarea.value;
        });

        const actions = contentEl.createDiv('dn-comment-modal-actions');
        const cancelBtn = actions.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
        const saveBtn = actions.createEl('button', { text: 'Save', cls: 'mod-cta' });
        saveBtn.addEventListener('click', () => {
            void this.submit();
        });
        textarea.focus();
    }

    private async submit(): Promise<void> {
        await this.onSave(this.value);
        this.close();
    }
}

/* eslint-enable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unused-vars, no-unused-vars */
