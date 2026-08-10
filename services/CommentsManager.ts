 
/* eslint-disable @typescript-eslint/no-unsafe-return -- parseYaml returns `any`; casting the result to Record<string, unknown> triggers the unsafe-return rule */
import { App, normalizePath, parseYaml, stringifyYaml, TFile } from 'obsidian';
import type { Comment, CommentCategory } from '../models/Comment';
import { coerceString } from '../utils/narrow';

const COMMENT_FRONTMATTER_KEYS = ['type', 'name', 'status', 'category', 'relatedFile', 'relatedName', 'created', 'modified'];
const RESERVED_KEYS = new Set(COMMENT_FRONTMATTER_KEYS);

export class CommentsManager {
    private app: App;

    /** In-memory index: relatedFilePath → Comment[] (O(1) lookup by entity) */
    private _byRelatedFile: Map<string, Comment[]> = new Map();
    /** In-memory index: filePath → Comment */
    private _byFilePath: Map<string, Comment> = new Map();
    /** Cached flat list for the board */
    private _allComments: Comment[] = [];

    /** Guard flag set during plugin-initiated saves to prevent modify-loop */
    private _isSaving = false;

    constructor(app: App) {
        this.app = app;
    }

    isSelfWrite(): boolean {
        return this._isSaving;
    }

    // ── Load ───────────────────────────────────────────

    async loadAll(commentsFolder: string): Promise<void> {
        this._byRelatedFile.clear();
        this._byFilePath.clear();
        this._allComments = [];

        const adapter = this.app.vault.adapter;
        const normalized = normalizePath(commentsFolder);

        if (!await adapter.exists(normalized)) {
            await this.ensureFolder(normalized);
            return;
        }

        await this.scanFolder(normalized);
    }

    private async scanFolder(folderPath: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        const listing = await adapter.list(folderPath);
        for (const f of listing.files) {
            if (f.endsWith('.md')) {
                try {
                    const fp = normalizePath(f);
                    const content = await adapter.read(fp);
                    const comment = this.parseComment(content, fp);
                    if (comment) {
                        this._byFilePath.set(fp, comment);
                        this._addToRelatedIndex(comment);
                        this._allComments.push(comment);
                    }
                } catch { /* skip unreadable */ }
            }
        }
        for (const sub of listing.folders) {
            await this.scanFolder(normalizePath(sub));
        }
    }

    // ── Single-file reparse (called from vault events) ──

    handleFileChange(filePath: string): void {
        if (this._isSaving) return;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        this.app.vault.read(file).then((content: string) => {
            const comment = this.parseComment(content, filePath);
            if (comment) {
                const old = this._byFilePath.get(filePath);
                if (old) {
                    this._removeFromRelatedIndex(old);
                    this._allComments = this._allComments.filter(c => c.filePath !== filePath);
                }
                this._byFilePath.set(filePath, comment);
                this._addToRelatedIndex(comment);
                this._allComments.push(comment);
            }
        }).catch(() => { /* silent */ });
    }

    handleFileDelete(filePath: string): void {
        const existing = this._byFilePath.get(filePath);
        if (existing) {
            this._removeFromRelatedIndex(existing);
            this._byFilePath.delete(filePath);
            this._allComments = this._allComments.filter(c => c.filePath !== filePath);
        }
    }

    handleFileRename(file: TFile, oldPath: string): void {
        const existing = this._byFilePath.get(oldPath);
        if (existing) {
            this._removeFromRelatedIndex(existing);
            this._byFilePath.delete(oldPath);

            const newPath = file.path;
            try {
                this.app.vault.read(file).then((content: string) => {
                    const comment = this.parseComment(content, newPath);
                    if (comment) {
                        this._byFilePath.set(newPath, comment);
                        this._addToRelatedIndex(comment);
                        this._allComments = this._allComments
                            .filter(c => c.filePath !== oldPath)
                            .concat(comment);
                    }
                }).catch(() => { /* silent */ });
            } catch { /* silent */ }
        }
    }

    // ── Query ──────────────────────────────────────────

    getCommentsForFile(relatedPath: string): Comment[] {
        return this._byRelatedFile.get(relatedPath) ?? [];
    }

    getAllComments(): Comment[] {
        return this._allComments;
    }

    getComment(filePath: string): Comment | undefined {
        return this._byFilePath.get(filePath);
    }

    getByCategory(category: CommentCategory): Comment[] {
        return this._allComments.filter(c => c.category === category);
    }

    // ── Create ─────────────────────────────────────────

    async createComment(
        commentsFolder: string,
        title: string,
        body: string,
        relatedFile: string,
        relatedName: string,
        category: CommentCategory,
    ): Promise<Comment> {
        await this.ensureFolder(normalizePath(commentsFolder));

        const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-');
        let filePath = normalizePath(`${commentsFolder}/${safeTitle}.md`);

        if (this.app.vault.getAbstractFileByPath(filePath)) {
            let counter = 2;
            while (this.app.vault.getAbstractFileByPath(
                normalizePath(`${commentsFolder}/${safeTitle}-${counter}.md`))
            ) {
                counter++;
            }
            filePath = normalizePath(`${commentsFolder}/${safeTitle}-${counter}.md`);
        }

        const now = new Date().toISOString().split('T')[0];
        const fm: Record<string, unknown> = {
            type: 'comment',
            name: safeTitle,
            status: 'Open',
            category,
            relatedFile,
            relatedName,
            created: now,
            modified: now,
        };

        const yaml = stringifyYaml(fm);
        await this.app.vault.create(filePath, `---\n${yaml}---\n\n${body}`);

        const comment: Comment = {
            filePath,
            title: safeTitle,
            body,
            status: 'Open',
            category,
            relatedFile,
            relatedName,
            created: now,
            modified: now,
        };

        this._byFilePath.set(filePath, comment);
        this._addToRelatedIndex(comment);
        this._allComments.push(comment);

        return comment;
    }

    // ── Save ───────────────────────────────────────────

    async saveComment(comment: Comment): Promise<void> {
        const normalizedPath = normalizePath(comment.filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);
        const existingFm = this._extractFrontmatter(content) ?? {};

        const fm: Record<string, unknown> = {};
        for (const key of Object.keys(existingFm)) {
            if (!RESERVED_KEYS.has(key)) {
                fm[key] = existingFm[key];
            }
        }

        fm.type = 'comment';
        fm.name = comment.title;
        fm.status = comment.status;
        fm.category = comment.category;
        fm.relatedFile = comment.relatedFile;
        fm.relatedName = comment.relatedName;
        fm.created = comment.created;
        fm.modified = new Date().toISOString().split('T')[0];

        const newContent = `---\n${stringifyYaml(fm)}---\n${comment.body ? '\n' + comment.body : ''}`;

        this._isSaving = true;
        try {
            await this.app.vault.modify(file, newContent);
        } finally {
            this._isSaving = false;
        }

        const updated: Comment = {
            ...comment,
            modified: fm.modified as string,
            filePath: normalizedPath,
        };

        const old = this._byFilePath.get(normalizedPath);
        if (old) {
            this._removeFromRelatedIndex(old);
        }
        this._byFilePath.set(normalizedPath, updated);
        this._addToRelatedIndex(updated);

        const idx = this._allComments.findIndex(c => c.filePath === normalizedPath);
        if (idx >= 0) this._allComments[idx] = updated;
        else this._allComments.push(updated);
    }

    // ── Delete ─────────────────────────────────────────

    async deleteComment(filePath: string): Promise<void> {
        const normalizedPath = normalizePath(filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file);
        }

        const existing = this._byFilePath.get(normalizedPath);
        if (existing) {
            this._removeFromRelatedIndex(existing);
            this._byFilePath.delete(normalizedPath);
            this._allComments = this._allComments.filter(c => c.filePath !== normalizedPath);
        }
    }

    // ── Cascade rename of related file ─────────────────

    async cascadeRelatedRename(oldPath: string, newPath: string, newName?: string): Promise<void> {
        const comments = this._byRelatedFile.get(oldPath);
        if (!comments || comments.length === 0) return;

        const normalizedOld = normalizePath(oldPath);
        const normalizedNew = normalizePath(newPath);

        const updated: Comment[] = [];
        for (const comment of comments) {
            const newComment: Comment = {
                ...comment,
                relatedFile: normalizedNew,
                relatedName: newName ?? comment.relatedName,
            };
            updated.push(newComment);

            try {
                await this.saveComment(newComment);
            } catch {
                // If save fails, update the in-memory index anyway
                const existing = this._byFilePath.get(comment.filePath);
                if (existing) {
                    existing.relatedFile = normalizedNew;
                    if (newName) existing.relatedName = newName;
                }
            }
        }

        this._byRelatedFile.delete(normalizedOld);
        this._byRelatedFile.set(normalizedNew, updated);
    }

    // ── Cascade delete of related file ─────────────────

    async cascadeRelatedDelete(relatedPath: string): Promise<void> {
        const comments = this._byRelatedFile.get(relatedPath);
        if (!comments || comments.length === 0) return;

        for (const comment of comments) {
            try {
                await this.deleteComment(comment.filePath);
            } catch {
                this._removeFromRelatedIndex(comment);
                this._byFilePath.delete(comment.filePath);
            }
        }

        this._byRelatedFile.delete(relatedPath);
    }

    // ── Internal helpers ────────────────────────────────

    private parseComment(content: string, filePath: string): Comment | null {
        const fm = this._extractFrontmatter(content);
        if (!fm) return null;
        if (fm.type !== 'comment') return null;

        const body = this._extractBody(content);

        return {
            filePath,
            title: coerceString(fm.name),
            body: body ?? '',
            status: coerceString(fm.status, 'Open'),
            category: (fm.category as CommentCategory) ?? 'scene',
            relatedFile: coerceString(fm.relatedFile),
            relatedName: coerceString(fm.relatedName),
            created: coerceString(fm.created),
            modified: coerceString(fm.modified),
        };
    }

    private _addToRelatedIndex(comment: Comment): void {
        if (!comment.relatedFile) return;
        const arr = this._byRelatedFile.get(comment.relatedFile) ?? [];
        arr.push(comment);
        this._byRelatedFile.set(comment.relatedFile, arr);
    }

    private _removeFromRelatedIndex(comment: Comment): void {
        if (!comment.relatedFile) return;
        const arr = this._byRelatedFile.get(comment.relatedFile);
        if (!arr) return;
        const filtered = arr.filter(c => c.filePath !== comment.filePath);
        if (filtered.length > 0) {
            this._byRelatedFile.set(comment.relatedFile, filtered);
        } else {
            this._byRelatedFile.delete(comment.relatedFile);
        }
    }

    private _extractFrontmatter(content: string): Record<string, unknown> | null {
        const clean = content.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
        const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match) return null;
        try {
            return parseYaml(match[1]);
        } catch {
            return null;
        }
    }

    private _extractBody(content: string): string {
        const clean = content.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
        const match = clean.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        if (match) return match[1].trim();
        return clean.trim();
    }

    private async ensureFolder(folderPath: string): Promise<void> {
        const normalized = normalizePath(folderPath);
        if (this.app.vault.getAbstractFileByPath(normalized)) return;
        await this.app.vault.createFolder(normalized);
    }
}
/* eslint-enable @typescript-eslint/no-unsafe-return -- end of file-wide suppression block opened at line 1 */
