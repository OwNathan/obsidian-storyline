 
/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion -- floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type SceneCardsPlugin from '../main';
import type { CommentsManager } from '../services/CommentsManager';
import type { Comment } from '../models/Comment';
import { renderViewSwitcher } from '../components/ViewSwitcher';
import { applyMobileClass } from '../components/MobileAdapter';
import { COMMENTS_VIEW_TYPE } from '../constants';

type SortField = 'created' | 'modified' | 'title';

export class CommentsView extends ItemView {
    private plugin: SceneCardsPlugin;
    private commentsManager: CommentsManager;
    private rootEl: HTMLElement | null = null;
    private selectedPath: string | null = null;
    private sortField: SortField = 'created';
    private sortDir: 'asc' | 'desc' = 'desc';
    private searchQuery = '';
    private saveTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SceneCardsPlugin, commentsManager: CommentsManager) {
        super(leaf);
        this.plugin = plugin;
        this.commentsManager = commentsManager;
    }

    getViewType(): string {
        return COMMENTS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Comments';
    }

    getIcon(): string {
        return 'message-square';
    }

    async onOpen(): Promise<void> {
        this.plugin.storyLeaf = this.leaf;
        const viewContent = this.containerEl.children[1] as HTMLElement;
        viewContent.empty();
        viewContent.addClasses(['sl-comments-view', 'story-line-comments-container']);
        applyMobileClass(viewContent);

        this.rootEl = viewContent.createDiv('sl-comments-board');
        this.render();
    }

    async onClose(): Promise<void> {
        this.rootEl = null;
    }

    refresh(): void {
        if (this.rootEl) this.render();
    }

    /**
     * Select a comment by file path — called externally from capsule clicks.
     */
    selectComment(filePath: string): void {
        this.selectedPath = filePath;
        if (this.rootEl) this.render();
    }

    private render(): void {
        if (!this.rootEl) return;
        this.rootEl.empty();

        // ── Toolbar (ViewSwitcher header) ───────────────
        const toolbar = this.rootEl.createDiv('story-line-toolbar');
        const titleRow = toolbar.createDiv('story-line-title-row');
        titleRow.createEl('h3', { cls: 'story-line-view-title', text: 'StoryLine' });
        renderViewSwitcher(toolbar, COMMENTS_VIEW_TYPE, this.plugin, this.leaf);

        // ── Board content ───────────────────────────────
        const content = this.rootEl.createDiv('sl-comments-content');
        const layout = content.createDiv('sl-comments-layout');

        // ── Left panel: list ──
        const leftPanel = layout.createDiv('sl-comments-left');
        this.renderList(leftPanel);

        // ── Right panel: detail ──
        const rightPanel = layout.createDiv('sl-comments-right');
        if (this.selectedPath) {
            const comment = this.commentsManager.getComment(this.selectedPath);
            if (comment) {
                this.renderDetail(rightPanel, comment);
            } else {
                this.selectedPath = null;
                rightPanel.createDiv('sl-comments-empty').setText('Select a comment to view.');
            }
        } else {
            rightPanel.createDiv('sl-comments-empty').setText('Select a comment to view.');
        }
    }

    // ── List ────────────────────────────────────────────

    private renderList(container: HTMLElement): void {
        // Header bar
        const header = container.createDiv('sl-comments-list-header');
        header.createDiv({ cls: 'sl-comments-list-title', text: 'Comments' });

        // Search
        const searchWrap = header.createDiv('sl-comments-search-wrap');
        const searchInput = searchWrap.createEl('input', {
            type: 'text',
            cls: 'sl-comments-search',
            attr: { placeholder: 'Search comments\u2026' },
        });
        searchInput.value = this.searchQuery;
        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value.toLowerCase();
            this.refreshList(container);
        });

        // Sort
        const sortWrap = header.createDiv('sl-comments-sort-wrap');
        sortWrap.createEl('label', { text: 'Sort:', cls: 'sl-comments-sort-label' });
        const sortSelect = sortWrap.createEl('select', { cls: 'sl-comments-sort-select' });

        const fields: Array<{ value: string; label: string }> = [
            { value: 'created-desc', label: 'Created (newest)' },
            { value: 'created-asc', label: 'Created (oldest)' },
            { value: 'modified-desc', label: 'Modified (recent)' },
            { value: 'modified-asc', label: 'Modified (oldest)' },
            { value: 'title-asc', label: 'Title (A-Z)' },
            { value: 'title-desc', label: 'Title (Z-A)' },
        ];

        for (const f of fields) {
            const opt = sortSelect.createEl('option', { text: f.label });
            opt.value = f.value;
            if (f.value === `${this.sortField}-${this.sortDir}`) opt.selected = true;
        }

        sortSelect.addEventListener('change', () => {
            const parts = sortSelect.value.split('-');
            this.sortField = parts[0] as SortField;
            this.sortDir = parts[1] as 'asc' | 'desc';
            this.refreshList(container);
        });

        // Comments list
        const listEl = container.createDiv('sl-comments-list');

        const comments = this.getFilteredSortedComments();
        if (comments.length === 0) {
            listEl.createDiv('sl-comments-list-empty').setText(
                this.searchQuery ? 'No comments match your search.' : 'No comments yet.',
            );
            return;
        }

        for (const comment of comments) {
            const card = listEl.createDiv('sl-comment-list-card');
            if (comment.filePath === this.selectedPath) {
                card.addClass('sl-comment-list-card-active');
            }

            const cardHeader = card.createDiv('sl-comment-list-card-header');
            cardHeader.createSpan({ cls: 'sl-comment-list-card-title', text: comment.title });

            const statusBadge = cardHeader.createSpan({
                cls: 'sl-comment-status-badge',
                text: comment.status,
            });
            statusBadge.setAttribute('data-status', comment.status.toLowerCase());

            const meta = card.createDiv('sl-comment-list-card-meta');
            meta.createSpan({ cls: 'sl-comment-list-card-related', text: comment.relatedName || comment.relatedFile });
            meta.createSpan({ cls: 'sl-comment-list-card-category', text: comment.category });
            meta.createSpan({ cls: 'sl-comment-list-card-date', text: comment.created });

            card.addEventListener('click', () => {
                this.selectedPath = comment.filePath;
                if (this.rootEl) this.render();
            });
        }
    }

    private refreshList(container: HTMLElement): void {
        const listEl = container.querySelector('.sl-comments-list') as HTMLElement | null;
        if (!listEl) return;
        listEl.empty();

        const comments = this.getFilteredSortedComments();
        if (comments.length === 0) {
            listEl.createDiv('sl-comments-list-empty').setText(
                this.searchQuery ? 'No comments match your search.' : 'No comments yet.',
            );
            return;
        }

        for (const comment of comments) {
            const card = listEl.createDiv('sl-comment-list-card');
            if (comment.filePath === this.selectedPath) {
                card.addClass('sl-comment-list-card-active');
            }

            const cardHeader = card.createDiv('sl-comment-list-card-header');
            cardHeader.createSpan({ cls: 'sl-comment-list-card-title', text: comment.title });

            const statusBadge = cardHeader.createSpan({
                cls: 'sl-comment-status-badge',
                text: comment.status,
            });
            statusBadge.setAttribute('data-status', comment.status.toLowerCase());

            const meta = card.createDiv('sl-comment-list-card-meta');
            meta.createSpan({ cls: 'sl-comment-list-card-related', text: comment.relatedName || comment.relatedFile });
            meta.createSpan({ cls: 'sl-comment-list-card-category', text: comment.category });
            meta.createSpan({ cls: 'sl-comment-list-card-date', text: comment.created });

            card.addEventListener('click', () => {
                this.selectedPath = comment.filePath;
                if (this.rootEl) this.render();
            });
        }
    }

    private getFilteredSortedComments(): Comment[] {
        let comments = this.commentsManager.getAllComments();

        if (this.searchQuery) {
            const q = this.searchQuery;
            comments = comments.filter(c =>
                c.title.toLowerCase().includes(q)
                || c.body.toLowerCase().includes(q)
                || c.relatedName.toLowerCase().includes(q)
                || c.status.toLowerCase().includes(q)
                || c.category.toLowerCase().includes(q),
            );
        }

        comments.sort((a, b) => {
            let cmp = 0;
            switch (this.sortField) {
                case 'created':
                    cmp = a.created.localeCompare(b.created);
                    break;
                case 'modified':
                    cmp = a.modified.localeCompare(b.modified);
                    break;
                case 'title':
                    cmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
                    break;
            }
            return this.sortDir === 'asc' ? cmp : -cmp;
        });

        return comments;
    }

    // ── Detail ──────────────────────────────────────────

    private renderDetail(container: HTMLElement, comment: Comment): void {
        const header = container.createDiv('sl-comments-detail-header');

        const backBtn = header.createSpan({ cls: 'sl-comments-back-btn' });
        setIcon(backBtn.createSpan(), 'chevron-left');
        backBtn.addEventListener('click', () => {
            this.selectedPath = null;
            if (this.rootEl) this.render();
        });

        header.createSpan({ cls: 'sl-comments-detail-title', text: comment.title });

        const headerActions = header.createDiv('sl-comments-detail-actions');

        // Open file
        const openBtn = headerActions.createEl('button', {
            cls: 'codex-detail-action-btn',
            attr: { 'aria-label': 'Open file' },
        });
        setIcon(openBtn.createSpan(), 'file');
        openBtn.addEventListener('click', () => {
            const file = this.app.vault.getAbstractFileByPath(comment.filePath);
            if (file) {
                this.app.workspace.openLinkText(comment.filePath, '', true);
            }
        });

        // Delete
        const deleteBtn = headerActions.createEl('button', {
            cls: 'codex-detail-action-btn codex-detail-delete-btn',
            attr: { 'aria-label': 'Delete' },
        });
        setIcon(deleteBtn.createSpan(), 'trash');
        deleteBtn.addEventListener('click', async () => {
            await this.commentsManager.deleteComment(comment.filePath);
            this.selectedPath = null;
            if (this.rootEl) this.render();
        });

        const form = container.createDiv('sl-comments-detail-form');

        // Related file
        const relatedSection = form.createDiv('sl-comments-field');
        relatedSection.createEl('label', { text: 'Related file', cls: 'sl-comments-field-label' });
        const relatedLink = relatedSection.createEl('a', {
            cls: 'sl-comments-related-link',
            text: comment.relatedName || comment.relatedFile,
        });
        relatedLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (comment.relatedFile) {
                const file = this.app.vault.getAbstractFileByPath(comment.relatedFile);
                if (file) {
                    this.app.workspace.openLinkText(comment.relatedFile, '', true);
                }
            }
        });

        // Category
        const catSection = form.createDiv('sl-comments-field');
        catSection.createEl('label', { text: 'Category', cls: 'sl-comments-field-label' });
        catSection.createSpan({ cls: 'sl-comments-field-value', text: comment.category });

        // Status
        const statusSection = form.createDiv('sl-comments-field');
        statusSection.createEl('label', { text: 'Status', cls: 'sl-comments-field-label' });
        const statusInput = statusSection.createEl('input', {
            type: 'text',
            cls: 'sl-comments-status-input',
            value: comment.status,
        });
        statusInput.addEventListener('change', () => {
            comment.status = statusInput.value;
            this.scheduleSave(comment);
        });

        // Body
        const bodySection = form.createDiv('sl-comments-field sl-comments-body-field');
        bodySection.createEl('label', { text: 'Comment', cls: 'sl-comments-field-label' });
        const bodyTextarea = bodySection.createEl('textarea', {
            cls: 'sl-comments-body-textarea',
            attr: { rows: '16' },
        });
        bodyTextarea.value = comment.body;
        bodyTextarea.addEventListener('input', () => {
            comment.body = (bodyTextarea as HTMLTextAreaElement).value;
            this.scheduleSave(comment);
        });

        // Metadata
        const metaSection = form.createDiv('sl-comments-field sl-comments-meta');
        metaSection.createSpan({ cls: 'sl-comments-meta-item', text: `Created: ${comment.created}` });
        metaSection.createSpan({ cls: 'sl-comments-meta-item', text: `Modified: ${comment.modified}` });
    }

    private scheduleSave(comment: Comment): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            this.commentsManager.saveComment(comment).then(() => {
                if (this.rootEl) this.render();
            }).catch(() => { /* silent */ });
        }, 600);
    }
}
/* eslint-enable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion -- end of file-wide suppression block opened at line 1 */
