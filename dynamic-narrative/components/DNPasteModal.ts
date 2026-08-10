/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { App, Modal } from 'obsidian';
import type { DNPasteMode } from '../models/types';

export class DNPasteModal extends Modal {
    private targetLabel: string;
    private targetCount: number;
    private clipboardCount: number;
    private onSelect: (mode: DNPasteMode) => Promise<void>;
    private submitting = false;

    constructor(
        app: App,
        targetLabel: string,
        targetCount: number,
        clipboardCount: number,
        onSelect: (mode: DNPasteMode) => Promise<void>,
    ) {
        super(app);
        this.targetLabel = targetLabel;
        this.targetCount = targetCount;
        this.clipboardCount = clipboardCount;
        this.onSelect = onSelect;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dn-paste-modal');
        this.titleEl.setText(`Paste into ${this.targetLabel}`);

        contentEl.createEl('p', {
            text: `${this.targetLabel} already contains ${this.targetCount} ${this.targetCount === 1 ? 'entity' : 'entities'}. The clipboard contains ${this.clipboardCount} ${this.clipboardCount === 1 ? 'entity' : 'entities'}.`,
            cls: 'dn-paste-summary',
        });

        const options = contentEl.createDiv('dn-paste-options');
        this.createOption(options, 'Overwrite', 'Replace the current contents.', 'overwrite', 'mod-warning');
        this.createOption(options, 'Add missing', 'Add entries not already present.', 'merge', 'mod-cta');
        this.createOption(options, 'Add only unique', 'Add entities whose name is not present, ignoring comments.', 'unique', 'mod-cta');

        const cancelBtn = contentEl.createEl('button', { text: 'Cancel', cls: 'dn-paste-cancel' });
        cancelBtn.addEventListener('click', () => this.close());
    }

    private createOption(
        container: HTMLElement,
        label: string,
        description: string,
        mode: DNPasteMode,
        buttonClass: string,
    ): void {
        const option = container.createDiv('dn-paste-option');
        option.createDiv('dn-paste-option-description').setText(description);
        const button = option.createEl('button', { text: label, cls: buttonClass });
        button.addEventListener('click', async () => {
            if (this.submitting) return;
            this.submitting = true;
            button.disabled = true;
            try {
                this.close();
                await this.onSelect(mode);
            } finally {
                this.submitting = false;
            }
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
