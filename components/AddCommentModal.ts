 
import { Modal, Setting, App } from 'obsidian';import type { CommentsManager } from '../services/CommentsManager';
import type { CommentCategory } from '../models/Comment';

export class AddCommentModal extends Modal {
    private relatedFile: string;
    private relatedName: string;
    private category: CommentCategory;
    private commentsManager: CommentsManager;
    private commentsFolder: string;
    private onCreated: (() => void) | null;
    private titleValue = '';
    private bodyValue = '';

    constructor(
        app: App,
        commentsManager: CommentsManager,
        commentsFolder: string,
        relatedFile: string,
        relatedName: string,
        category: CommentCategory,
        onCreated?: () => void,
    ) {
        super(app);
        this.commentsManager = commentsManager;
        this.commentsFolder = commentsFolder;
        this.relatedFile = relatedFile;
        this.relatedName = relatedName;
        this.category = category;
        this.onCreated = onCreated ?? null;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('sl-add-comment-modal');

        this.titleEl.setText('Add comment');

        new Setting(contentEl)
            .setName('Related file')
            .setDesc('This comment will be linked to the file shown below.')
            .addText(text => {
                text.setValue(this.relatedName);
                text.setDisabled(true);
                text.inputEl.addClass('sl-comment-related-input');
            });

        new Setting(contentEl)
            .setName('Title')
            .setDesc('A short title for your comment.')
            .addText(text => {
                text.setPlaceholder('Comment title');
                text.inputEl.addClass('sl-comment-title-input');
                text.onChange(v => { this.titleValue = v; });
            });

        const bodySection = contentEl.createDiv('sl-comment-body-section');
        bodySection.createEl('label', { text: 'Comment', cls: 'setting-item-name' });
        bodySection.createDiv({ text: 'Write your thoughts here.', cls: 'setting-item-description' });

        const textarea = bodySection.createEl('textarea', {
            cls: 'sl-comment-body-textarea',
            attr: { placeholder: 'Write your comment\u2026', rows: '12' },
        });
        textarea.addEventListener('input', () => {
            this.bodyValue = textarea.value;
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('Create')
                .setCta()
                .onClick(() => this.submit()));
    }

    private async submit(): Promise<void> {
        if (!this.titleValue.trim()) {
            return;
        }

        const safeTitle = this.titleValue.trim().replace(/[\\/:*?"<>|]/g, '-');
        if (!safeTitle) return;

        try {
            await this.commentsManager.createComment(
                this.commentsFolder,
                safeTitle,
                this.bodyValue,
                this.relatedFile,
                this.relatedName,
                this.category,
            );
        } catch (e) {
            // file already exists is caught silently
            void e;
        }

        this.close();
        this.onCreated?.();
    }
}
