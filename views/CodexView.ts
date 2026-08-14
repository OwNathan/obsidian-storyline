/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { ItemView, WorkspaceLeaf, Modal, Setting, Notice, TFile } from 'obsidian';
import * as obsidian from 'obsidian';
import type SceneCardsPlugin from '../main';
import { SceneManager } from '../services/SceneManager';
import { CodexManager, MirroredSection } from '../services/CodexManager';
import { CodexEntry, CodexCategoryDef, CodexFieldCategory, CodexFieldDef, BUILTIN_CODEX_CATEGORIES, makeCustomCodexCategory, CODEX_ICON_OPTIONS } from '../models/Codex';
import { CODEX_VIEW_TYPE, CHARACTER_VIEW_TYPE, LOCATION_VIEW_TYPE, COMMENTS_VIEW_TYPE } from '../constants';
import { renderViewSwitcher } from '../components/ViewSwitcher';
import { applyMobileClass } from '../components/MobileAdapter';
import { pickImage as pickImageModal, resolveImagePath } from '../components/ImagePicker';
import { AddCommentModal } from '../components/AddCommentModal';
import { renderCommentCapsule } from '../components/CommentCapsule';
import { attachTooltip } from '../components/Tooltip';
import {
    renderCustomSectionsAtSlot,
    renderMergedSection,
    renderAddCustomSectionButton,
    syncLinkedSections,
    type CustomSectionsHost,
} from '../components/CustomSectionsRenderer';
import { entityTypeForCodex } from '../models/EntityTemplate';
import { renderSubcategoryPicker } from '../components/SubcategoryPicker';

/**
 * Codex View — central hub for all codex categories.
 *
 * Shows category tabs (Characters, Locations, Items, …) across the top,
 * with a grid of entry cards below.  Clicking a card opens a detail editor
 * panel (split into form + side panel), following the same pattern as
 * CharacterView and LocationView.
 *
 * Characters and Locations tabs simply switch to their dedicated views.
 */
export class CodexView extends ItemView {
    private plugin: SceneCardsPlugin;
    private sceneManager: SceneManager;
    private codexManager: CodexManager;
    private rootContainer: HTMLElement | null = null;

    /** File path of the currently-selected entry, or null for overview */
    private selectedEntry: string | null = null;
    /** Active category tab id */
    private activeCategory: string = '';
    private sortBy: 'name' | 'modified' | 'created' | 'type' = 'name';
    /** Sections collapsed in detail view */
    private collapsedSections: Set<string> = new Set();
    /** Search filter text */
    private searchText: string = '';
    /** Key of the last-rendered page — used to only restore scroll when
     *  re-rendering the same entity (not on navigation). */
    private _lastRenderKey: string = '';

    // ── Auto-save state ────────────────────────────────
    private _saveTimer: number | null = null;
    private _lastSaveTime = 0;
    private _pendingDraft: CodexEntry | null = null;
    private _undoSnapshot: CodexEntry | null = null;
    private static SAVE_DEBOUNCE_MS = 600;
    private static SAVE_REFRESH_GRACE_MS = 1500;

    /** Issue #102 — dropdowns portaled to <body> so position:fixed escapes
     *  ancestors with transform/contain. Cleaned up on each re-render. */
    private _portaledDropdowns: HTMLElement[] = [];
    private clearPortaledDropdowns(): void {
        for (const el of this._portaledDropdowns) { try { el.remove(); } catch { /* noop */ } }
        this._portaledDropdowns = [];
    }

    constructor(leaf: WorkspaceLeaf, plugin: SceneCardsPlugin, sceneManager: SceneManager) {
        super(leaf);
        this.plugin = plugin;
        this.sceneManager = sceneManager;
        this.codexManager = plugin.codexManager;
    }

    getViewType(): string { return CODEX_VIEW_TYPE; }
    getDisplayText(): string {
        const title = this.plugin?.sceneManager?.activeProject?.title;
        return title ? `StoryLine — ${title}` : 'StoryLine';
    }
    getIcon(): string { return 'book-open'; }

    async onOpen(): Promise<void> {
        this.plugin.storyLeaf = this.leaf;
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('story-line-codex-container');
        applyMobileClass(container);
        this.rootContainer = container;

        await this.sceneManager.initialize();

        // Load codex data (project folder + external source folders)
        this.codexManager.initCategories(
            this.plugin.settings.codexEnabledCategories,
            this.resolveCustomDefs(),
        );
        await this.plugin.reloadEntities();

        // Reset to hub state — no category pre-selected
        this.activeCategory = '';
        this.selectedEntry = null;

        this.renderView(container);
    }

    async onClose(): Promise<void> {
        await this.flushPendingSave();
        activeDocument.querySelectorAll('.gallery-lightbox-window').forEach(w => w.remove());
        this.clearPortaledDropdowns();
    }

    /**
     * Public method so the ViewSwitcher dropdown can navigate directly
     * to a specific codex category tab.
     */
    setActiveCategory(categoryId: string): void {
        this.activeCategory = categoryId;
        this.selectedEntry = null;
        if (this.rootContainer) this.renderView(this.rootContainer);
    }

    /**
     * Navigate directly to a codex entry's detail view by file path.
     */
    async navigateToEntry(filePath: string): Promise<void> {
        this.codexManager.initCategories(
            this.plugin.settings.codexEnabledCategories,
            this.resolveCustomDefs(),
        );
        await this.plugin.reloadEntities();
        const entry = this.codexManager.getEntry(filePath);
        if (!entry) {
            new Notice('Codex entry not found in the active project.');
            return;
        }
        this.activeCategory = entry.type;
        this.selectedEntry = filePath;
        if (this.rootContainer) {
            this.renderView(this.rootContainer);
        }
    }

    /** Called by refreshOpenViews */
    async refresh(): Promise<void> {
        // Grace period — skip re-render if we just saved ourselves
        if (this.selectedEntry && (Date.now() - this._lastSaveTime) < CodexView.SAVE_REFRESH_GRACE_MS) {
            this.codexManager.initCategories(
                this.plugin.settings.codexEnabledCategories,
                this.resolveCustomDefs(),
            );
            await this.plugin.reloadEntities();
            return;
        }
        this.codexManager.initCategories(
            this.plugin.settings.codexEnabledCategories,
            this.resolveCustomDefs(),
        );
        await this.plugin.reloadEntities();
        if (this.rootContainer) this.renderView(this.rootContainer);
    }

    // ══════════════════════════════════════════════════
    //  Render — main entry
    // ══════════════════════════════════════════════════

    private renderView(container: HTMLElement): void {
        // Preserve scroll position across the full DOM rebuild so collapsing /
        // adding a section or saving the file doesn't jump the scrollbar. Only
        // restore when re-rendering the same page — navigation resets to top.
        const renderKey = this.selectedEntry ?? `overview:${this.activeCategory}`;
        const samePage = renderKey === this._lastRenderKey;
        const prevScrollTop = container.scrollTop;
        const prevScrollLeft = container.scrollLeft;
        this.clearPortaledDropdowns(); // issue #102 — don't leak portaled popups across re-renders
        container.empty();

        // ── Toolbar ────────────────────────────────────
        const toolbar = container.createDiv('story-line-toolbar');
        const titleRow = toolbar.createDiv('story-line-title-row');
        titleRow.createEl('h3', { cls: 'story-line-view-title', text: 'StoryLine' });
        renderViewSwitcher(toolbar, CODEX_VIEW_TYPE, this.plugin, this.leaf);

        // ── Controls row ───────────────────────────────
        const controls = toolbar.createDiv('story-line-toolbar-controls');

        // Manage categories button (icon-only)
        const addCatBtn = controls.createEl('button', {
            cls: 'codex-toolbar-icon-btn',
        });
        obsidian.setIcon(addCatBtn, 'settings');
        attachTooltip(addCatBtn, 'Manage categories');
        addCatBtn.addEventListener('click', () => this.openManageCategoriesModal());

        // Add entry button (icon-only)
        const addBtn = controls.createEl('button', {
            cls: 'codex-toolbar-icon-btn codex-toolbar-add-btn',
        });
        obsidian.setIcon(addBtn, 'plus');
        attachTooltip(addBtn, 'New entry');
        addBtn.addEventListener('click', () => this.promptNewEntry());

        // ── Content area ───────────────────────────────
        const content = container.createDiv('story-line-codex-content');

        if (this.selectedEntry) {
            this.renderDetail(content);
        } else {
            this.renderOverview(content);
        }

        container.scrollTop = samePage ? prevScrollTop : 0;
        container.scrollLeft = samePage ? prevScrollLeft : 0;
        this._lastRenderKey = renderKey;
    }

    // ══════════════════════════════════════════════════
    //  Overview — category tabs + card grid
    // ══════════════════════════════════════════════════

    private renderOverview(container: HTMLElement): void {
        container.empty();

        // ── Category tabs ──────────────────────────────
        const tabs = container.createDiv('codex-category-tabs');

        // Built-in "Characters" pseudo-tab → switches to CharacterView
        this.renderPseudoTab(tabs, 'Characters', 'users', () => {
            this.switchToView(CHARACTER_VIEW_TYPE);
        });

        // Built-in "Locations" pseudo-tab → switches to LocationView
        this.renderPseudoTab(tabs, 'Locations', 'map-pin', () => {
            this.switchToView(LOCATION_VIEW_TYPE);
        });

        // Codex category tabs
        const cats = this.codexManager.getCategories();
        for (const cat of cats) {
            const tab = tabs.createEl('button', {
                cls: `codex-tab ${cat.id === this.activeCategory ? 'active' : ''}`,
                attr: { 'aria-label': cat.label },
            });
            const icon = tab.createSpan({ cls: 'codex-tab-icon' });
            obsidian.setIcon(icon, cat.icon);
            tab.createSpan({ cls: 'codex-tab-label', text: cat.label });

            tab.addEventListener('click', () => {
                this.activeCategory = cat.id;
                if (this.rootContainer) this.renderView(this.rootContainer);
            });
        }

        // ── Category heading (when a specific category is selected) ──
        if (this.activeCategory) {
            const catDef = this.codexManager.getCategoryDef(this.activeCategory);
            if (catDef) {
                container.createEl('h3', { text: catDef.label });
            }
        }

        // ── Search + Sort ──────────────────────────────
        const searchRow = container.createDiv('codex-search-row');
        const searchInput = searchRow.createEl('input', {
            cls: 'codex-search-input',
            attr: { type: 'text', placeholder: 'Search entries…' },
        });
        searchInput.value = this.searchText;
        searchInput.addEventListener('input', () => {
            this.searchText = searchInput.value;
            this.renderList(listContainer);
        });

        searchRow.createSpan({ cls: 'codex-sort-label', text: 'Sort by' });
        const sortSelect = searchRow.createEl('select', { cls: 'codex-sort-select' });
        const sortOptions: { value: string; label: string }[] = [
            { value: 'name', label: 'Name' },
            { value: 'modified', label: 'Last edited' },
            { value: 'created', label: 'Date created' },
            { value: 'type', label: 'Type' },
        ];
        for (const opt of sortOptions) {
            const el = sortSelect.createEl('option', { text: opt.label, value: opt.value });
            if (this.sortBy === opt.value) el.selected = true;
        }
        sortSelect.addEventListener('change', () => {
            this.sortBy = sortSelect.value as 'type' | 'name' | 'created' | 'modified';
            this.renderList(listContainer);
        });

        // ── List ───────────────────────────────────────
        const listContainer = container.createDiv('codex-list-container');
        this.renderList(listContainer);
    }

    private renderList(container: HTMLElement): void {
        container.empty();
        const isHub = !this.activeCategory;
        const catDef = isHub ? undefined : this.codexManager.getCategoryDef(this.activeCategory);

        // Hub mode: only show results when the user is actively searching
        if (isHub && !this.searchText) {
            container.createEl('p', { cls: 'codex-empty-state', text: 'Select a category or search for entries.' });
            return;
        }

        // Gather entries — all categories on hub search, single category otherwise
        let entries: CodexEntry[] = isHub
            ? this.codexManager.getAllEntries()
            : (catDef ? this.codexManager.getEntries(this.activeCategory) : []);

        // Filter by search query
        if (this.searchText) {
            const q = this.searchText.toLowerCase();
            entries = entries.filter(e => e.name.toLowerCase().includes(q));
        }

        // Resolve catDef per-entry helper for hub mode
        const getCatDef = (entry: CodexEntry) =>
            isHub ? this.codexManager.getCategoryDef(entry.type) : catDef;

        // Sort
        entries = [...entries].sort((a, b) => {
            switch (this.sortBy) {
                case 'modified':
                    return (b.modified ?? '').localeCompare(a.modified ?? '');
                case 'created':
                    return (b.created ?? '').localeCompare(a.created ?? '');
                case 'type': {
                    const cdA = getCatDef(a);
                    const cdB = getCatDef(b);
                    const tA = cdA ? this.getTypeField(a, cdA) : '';
                    const tB = cdB ? this.getTypeField(b, cdB) : '';
                    return tA.localeCompare(tB) || a.name.localeCompare(b.name);
                }
                default:
                    return a.name.localeCompare(b.name);
            }
        });

        // In hub search mode, also gather matching Characters and Locations
        interface HubResult { name: string; icon: string; badge: string; onClick: () => void }
        const hubExtras: HubResult[] = [];
        if (isHub && this.searchText) {
            const q = this.searchText.toLowerCase();
            // Characters
            if (this.plugin.characterManager) {
                for (const ch of this.plugin.characterManager.getAllCharacters()) {
                    if (ch.name.toLowerCase().includes(q)) {
                        hubExtras.push({
                            name: ch.name,
                            icon: 'users',
                            badge: 'Character',
                            onClick: () => this.switchToView(CHARACTER_VIEW_TYPE),
                        });
                    }
                }
            }
            // Locations
            if (this.plugin.locationManager) {
                for (const loc of this.plugin.locationManager.getAllLocations()) {
                    if (loc.name.toLowerCase().includes(q)) {
                        hubExtras.push({
                            name: loc.name,
                            icon: 'map-pin',
                            badge: 'Location',
                            onClick: () => this.switchToView(LOCATION_VIEW_TYPE),
                        });
                    }
                }
            }
        }

        if (entries.length === 0 && hubExtras.length === 0) {
            if (isHub) {
                container.createEl('p', { cls: 'codex-empty-state', text: 'No matching entries.' });
            } else if (catDef) {
                const empty = container.createDiv('codex-empty-state');
                empty.createEl('p', { text: `No ${catDef.label.toLowerCase()} yet.` });
                const createBtn = empty.createEl('button', {
                    cls: 'mod-cta',
                    text: `Create first ${catDef.label.toLowerCase().replace(/s$/, '')}`,
                });
                createBtn.addEventListener('click', () => this.promptNewEntry());
            }
            return;
        }

        const list = container.createDiv('codex-entry-list');
        for (const entry of entries) {
            const entryCatDef = getCatDef(entry);
            if (entryCatDef) this.renderListItem(list, entry, entryCatDef);
        }

        // Render character/location hub results
        for (const hr of hubExtras) {
            const row = list.createDiv('codex-entry-row');
            const iconEl = row.createSpan({ cls: 'codex-entry-icon' });
            obsidian.setIcon(iconEl, hr.icon);
            row.createSpan({ cls: 'codex-entry-name', text: hr.name });
            row.createSpan({ cls: 'codex-entry-type-badge', text: hr.badge });
            row.addEventListener('click', hr.onClick);
        }
    }

    private renderListItem(list: HTMLElement, entry: CodexEntry, catDef: CodexCategoryDef): void {
        const row = list.createDiv('codex-entry-row');

        // Category icon
        const icon = row.createSpan({ cls: 'codex-entry-icon' });
        obsidian.setIcon(icon, catDef.icon);

        // Name
        row.createSpan({ cls: 'codex-entry-name', text: entry.name });

        // Type badge
        const typeVal = this.getTypeField(entry, catDef);
        if (typeVal) {
            row.createSpan({ cls: 'codex-entry-type-badge', text: typeVal });
        }

        // Completeness indicator (compact)
        const filled = this.countFilledFields(entry, catDef);
        const total = catDef.fieldKeys.length;
        if (total > 0) {
            const pct = Math.round((filled / total) * 100);
            row.createSpan({ cls: 'codex-entry-pct', text: `${pct}%` });
        }

        row.addEventListener('click', () => {
            this.activeCategory = entry.type;
            this.selectedEntry = entry.filePath;
            if (this.rootContainer) this.renderView(this.rootContainer);
        });
    }

    // ══════════════════════════════════════════════════
    //  Detail — editor panel
    // ══════════════════════════════════════════════════

    private renderDetail(container: HTMLElement): void {
        container.empty();
        const entry = this.codexManager.getEntry(this.selectedEntry!);
        if (!entry) {
            this.selectedEntry = null;
            this.renderOverview(container);
            return;
        }

        const catDef = this.codexManager.getCategoryDef(entry.type);
        if (!catDef) {
            this.selectedEntry = null;
            this.renderOverview(container);
            return;
        }

        const draft: CodexEntry = { ...entry };
        this._undoSnapshot = { ...entry };
        this._pendingDraft = draft;

        // ── Header ─────────────────────────────────────
        const header = container.createDiv('codex-detail-header');

        const backBtn = header.createSpan({ cls: 'codex-back-link' });
        const backIcon = backBtn.createSpan();
        obsidian.setIcon(backIcon, 'circle-arrow-left');
        backBtn.createSpan({ text: ` All ${catDef.label}` });
        backBtn.addEventListener('click', async () => {
            await this.flushPendingSave();
            this.selectedEntry = null;
            if (this.rootContainer) this.renderView(this.rootContainer);
        });

        const headerRight = header.createDiv('codex-detail-header-right');

        // Open in editor
        const openBtn = headerRight.createEl('button', {
            cls: 'codex-detail-action-btn',
            attr: { 'aria-label': 'Open file' },
        });
        const openIcon = openBtn.createSpan();
        obsidian.setIcon(openIcon, 'file');
        attachTooltip(openBtn, 'Open file');
        openBtn.addEventListener('click', () => {
            const file = this.app.vault.getAbstractFileByPath(entry.filePath);
            if (file) this.app.workspace.openLinkText(entry.filePath, '', true);
        });

        // Delete
        const deleteBtn = headerRight.createEl('button', {
            cls: 'codex-detail-action-btn codex-detail-delete-btn',
            attr: { 'aria-label': 'Delete' },
        });
        const deleteIcon = deleteBtn.createSpan();
        obsidian.setIcon(deleteIcon, 'trash');
        attachTooltip(deleteBtn, 'Delete');
        deleteBtn.addEventListener('click', () => this.confirmDeleteEntry(entry));

        // Add Comment
        const commentBtn = headerRight.createEl('button', {
            cls: 'codex-detail-action-btn',
            attr: { 'aria-label': 'Add comment' },
        });
        const commentIcon = commentBtn.createSpan();
        obsidian.setIcon(commentIcon, 'message-square');
        attachTooltip(commentBtn, 'Add comment');
        commentBtn.addEventListener('click', () => {
            const commentsFolder = this.sceneManager.getCommentsFolder();
            if (!commentsFolder) return;
            new AddCommentModal(
                this.app,
                this.plugin.commentsManager,
                commentsFolder,
                entry.filePath,
                entry.name,
                'codex',
                () => { if (this.rootContainer) this.renderView(this.rootContainer); },
            ).open();
        });

        // ── Type label ─────────────────────────────────
        const typeLabel = container.createDiv('codex-detail-type-label');
        const typeIcon = typeLabel.createSpan({ cls: 'codex-detail-type-icon' });
        obsidian.setIcon(typeIcon, catDef.icon);
        typeLabel.createSpan({ text: catDef.label.replace(/s$/, '') });

        // ── Portrait / image ───────────────────────────
        const portraitArea = container.createDiv('codex-detail-portrait');
        if (draft.image) {
            const file = this.app.vault.getAbstractFileByPath(draft.image);
            if (file instanceof TFile) {
                const img = portraitArea.createEl('img', {
                    attr: { src: this.app.vault.getResourcePath(file) },
                });
                img.addClass('codex-detail-img');
            }
        } else {
            const placeholder = portraitArea.createDiv('codex-detail-portrait-placeholder');
            obsidian.setIcon(placeholder, 'image');
            placeholder.createSpan({ text: 'Click to add image' });
        }
        portraitArea.addEventListener('click', () => {
            const sceneFolder = this.sceneManager.getSceneFolder();
            pickImageModal(this.app, sceneFolder, draft.image).then(async (picked) => {
                if (picked !== undefined) {
                    draft.image = picked;
                    this.scheduleSave(draft);
                    if (this.rootContainer) this.renderView(this.rootContainer);
                }
            });
        });

        // ── Layout: form + side ────────────────────────
        const layout = container.createDiv('codex-detail-layout');
        const formPanel = layout.createDiv('codex-detail-form');
        const sidePanel = layout.createDiv('codex-detail-side');

        // Subcategory picker (only when the codex category has an axis)
        renderSubcategoryPicker({
            container: formPanel,
            entityTemplates: this.plugin.entityTemplates,
            entityType: entityTypeForCodex(draft.type),
            current: draft.templateSubcategory,
            onChange: async (value) => {
                draft.templateSubcategory = value;
                this.scheduleSave(draft);
                // Flush the save so the in-memory cache reflects the new
                // subcategory, then re-render immediately so the new
                // subcategory's custom sections appear without a manual reload.
                await this.flushPendingSave();
                if (this.rootContainer) this.renderView(this.rootContainer);
            },
        });

        // Render entity-template default sections interleaved with
        // user-defined custom sections (#114)
        const defaultSections = this.plugin.entityTemplates.getCodexDefaultSections();
        const customHost = this.buildCustomSectionsHost(draft, defaultSections.length);
        renderCustomSectionsAtSlot(formPanel, customHost, 0);
        for (let i = 0; i < defaultSections.length; i++) {
            this.renderFieldCategory(formPanel, defaultSections[i], draft);
            // Custom sections sharing this default section's title render
            // inline (fields only, no duplicate header).
            renderMergedSection(formPanel, customHost, defaultSections[i].title);
            renderCustomSectionsAtSlot(formPanel, customHost, i + 1);
        }

        // "+ Add custom section" button at the bottom
        renderAddCustomSectionButton(formPanel, customHost);

        // Books (series-ready)
        this.renderBooksField(formPanel, draft);

        // Side panel — gallery + comments + references
        this.renderGallerySection(sidePanel, draft);
        this.renderCommentsSection(sidePanel, entry);
        this.renderReferencesPanel(sidePanel, entry.name);

        // Show stale-entry warning if codex content changed since last review
        void this.renderStaleWarning(sidePanel, entry);
    }

    // ── Field category rendering ───────────────────────

    /**
     * Render a locked default section: header + its immutable fields in
     * order. Defaults cannot be hidden, reordered, or extended with
     * universal fields — custom fields live in custom sections (which may
     * share this section's title to merge inline via renderMergedSection).
     */
    private renderFieldCategory(
        container: HTMLElement,
        cat: CodexFieldCategory,
        draft: CodexEntry,
    ): void {
        const sectionKey = `${draft.type}-${cat.title}`;
        const isCollapsed = this.collapsedSections.has(sectionKey);

        const section = container.createDiv('codex-section');
        const sectionHeader = section.createDiv('codex-section-header');
        sectionHeader.addEventListener('click', () => {
            if (this.collapsedSections.has(sectionKey)) {
                this.collapsedSections.delete(sectionKey);
            } else {
                this.collapsedSections.add(sectionKey);
            }
            if (this.rootContainer) this.renderView(this.rootContainer);
        });

        const chevron = sectionHeader.createSpan({ cls: 'codex-section-chevron' });
        obsidian.setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');

        const catIcon = sectionHeader.createSpan({ cls: 'codex-section-icon' });
        obsidian.setIcon(catIcon, cat.icon);

        sectionHeader.createSpan({ cls: 'codex-section-title', text: cat.title });

        if (!isCollapsed) {
            const body = section.createDiv('codex-section-body');
            for (const field of cat.fields) {
                this.renderField(body, field, draft);
            }
        }
    }

    private renderField(
        container: HTMLElement,
        field: CodexFieldDef,
        draft: CodexEntry,
    ): void {
        const { key, label, placeholder, multiline, characterRef, toggle } = field;
        const row = container.createDiv('codex-field-row');
        row.createEl('label', { cls: 'codex-field-label', text: label });

        const currentValue = draft[key] != null ? String(draft[key]) : '';

        if (toggle) {
            // Issue #223 — render an on/off toggle for boolean fields
            // (e.g. case-sensitive matching). Stored as a boolean in frontmatter.
            const toggleWrap = row.createDiv({ cls: 'codex-field-toggle-wrap' });
            const cb = toggleWrap.createEl('input', { type: 'checkbox' });
            cb.checked = draft[key] === true || currentValue === 'true';
            cb.addEventListener('change', () => {
                draft[key] = cb.checked;
                this.scheduleSave(draft);
            });
            return;
        }

        if (characterRef) {
            // Render a character dropdown
            const select = row.createEl('select', { cls: 'codex-field-input dropdown' });
            select.createEl('option', { text: placeholder || 'Select character…', value: '' });

            const characters = this.plugin.characterManager
                .getAllCharacters()
                .map(c => c.name)
                .sort((a, b) => a.localeCompare(b));

            for (const name of characters) {
                const opt = select.createEl('option', { text: name, value: name });
                if (currentValue === name) opt.selected = true;
            }
            // If current value is set but not in characters list, keep it
            if (currentValue && !characters.includes(currentValue)) {
                const opt = select.createEl('option', { text: currentValue, value: currentValue });
                opt.selected = true;
            }
            select.addEventListener('change', () => {
                draft[key] = select.value;
                this.scheduleSave(draft);
            });
        } else if (multiline) {
            const textarea = row.createEl('textarea', {
                cls: 'codex-field-textarea',
                attr: { placeholder, rows: '3' },
            });
            textarea.value = currentValue;
            textarea.addEventListener('input', () => {
                draft[key] = textarea.value;
                this.scheduleSave(draft);
                // Auto-grow
                textarea.setCssStyles({ height: "auto" });

                textarea.setCssStyles({ height: textarea.scrollHeight + 'px' });
            });
            // Initial auto-grow
            window.requestAnimationFrame(() => {
                textarea.setCssStyles({ height: "auto" });

                textarea.setCssStyles({ height: textarea.scrollHeight + 'px' });
            });
        } else {
            const input = row.createEl('input', {
                cls: 'codex-field-input',
                attr: { type: 'text', placeholder },
            });
            input.value = currentValue;
            input.addEventListener('input', () => {
                draft[key] = input.value;
                this.scheduleSave(draft);
            });

            // Name field: cascade rename on blur
            if (key === 'name') {
                input.addEventListener('blur', async () => {
                    const newName = input.value.trim();
                    if (newName && newName !== draft.name) {
                        try {
                            const codexFolder = this.sceneManager.getCodexFolder();
                            const renamed = await this.codexManager.renameEntry(draft, newName, codexFolder);
                            this.selectedEntry = renamed.filePath;
                            if (this.rootContainer) this.renderView(this.rootContainer);
                        } catch (err) {
                            new Notice(`Rename failed: ${err}`);
                        }
                    }
                });
            }
        }
    }

    // ── User-defined custom sections (#114) ────────────

    /**
     * Build the {@link CustomSectionsHost} used to interleave user-defined
     * custom sections with the entity-template default sections. The host
     * is rebuilt per-render so it always reflects the latest template state
     * for the current Codex category; structure changes persist via
     * {@link EntityTemplateService}.
     */
    private buildCustomSectionsHost(
        draft: CodexEntry,
        builtinSectionCount: number,
    ): CustomSectionsHost<CodexEntry> {
        const entityType = entityTypeForCodex(draft.type);
        const subcategory = draft.templateSubcategory;
        const sections = this.plugin.entityTemplates.getCustomSections(entityType, subcategory);
        const defaultTitles = this.plugin.entityTemplates.getDefaultSectionTitles(entityType);
        return {
            app: this.app,
            draft,
            sections,
            entityType,
            subcategory,
            entityTemplates: this.plugin.entityTemplates,
            remigrateLinkedKeys: (ops, subcats) => {
                void this.plugin.customKeyMigrator.remigrateCustomKeys(entityType, ops, subcats, draft.filePath);
            },
            builtinSectionCount,
            collapsedSections: this.collapsedSections,
            collapseKeyPrefix: `codex::${draft.type}`,
            cssPrefix: 'codex',
            isMergedSectionTitle: (title: string) => defaultTitles.includes(title),
            scheduleSave: (d) => this.scheduleSave(d),
            persistSections: () => {
                void this.plugin.entityTemplates.setCustomSections(entityType, subcategory, sections);
                void syncLinkedSections(this.plugin.entityTemplates, entityType, subcategory, sections);
            },
            requestRerender: () => {
                if (this.rootContainer) this.renderView(this.rootContainer);
            },
        };
    }

    // ── Books (series-ready) ───────────────────────────

    private renderBooksField(container: HTMLElement, draft: CodexEntry): void {
        const series = this.plugin.settings.series;
        if (!series) return; // Only show if project is part of a series

        const section = container.createDiv('codex-section');
        const header = section.createDiv('codex-section-header');
        const chevron = header.createSpan({ cls: 'codex-section-chevron' });

        const sectionKey = 'books';
        const isCollapsed = this.collapsedSections.has(sectionKey);
        obsidian.setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');

        const icon = header.createSpan({ cls: 'codex-section-icon' });
        obsidian.setIcon(icon, 'library');
        header.createSpan({ cls: 'codex-section-title', text: 'Appears In (Books)' });

        header.addEventListener('click', () => {
            if (this.collapsedSections.has(sectionKey)) {
                this.collapsedSections.delete(sectionKey);
            } else {
                this.collapsedSections.add(sectionKey);
            }
            if (this.rootContainer) this.renderView(this.rootContainer);
        });

        if (isCollapsed) return;

        const body = section.createDiv('codex-section-body');
        const books = draft.books || [];

        for (let i = 0; i < books.length; i++) {
            const row = body.createDiv('codex-field-row');
            const input = row.createEl('input', {
                cls: 'codex-field-input',
                attr: { type: 'text', placeholder: 'Book title' },
            });
            input.value = books[i];
            const idx = i;
            input.addEventListener('input', () => {
                if (!draft.books) draft.books = [];
                draft.books[idx] = input.value;
                this.scheduleSave(draft);
            });
        }

        const addBtn = body.createEl('button', { cls: 'codex-add-custom-btn', text: '+ add book' });
        addBtn.addEventListener('click', () => {
            if (!draft.books) draft.books = [];
            draft.books.push('');
            this.scheduleSave(draft);
            if (this.rootContainer) this.renderView(this.rootContainer);
        });
    }

    // ── Gallery section ────────────────────────────────

    private renderGallerySection(container: HTMLElement, draft: CodexEntry): void {
        const MAX_GALLERY = 10;
        const SECTION_KEY = '__Gallery';

        const wrapper = container.createDiv('character-gallery');
        const gallery = draft.gallery ?? [];

        // Collapsible header with add button
        const isCollapsed = this.collapsedSections.has(SECTION_KEY);
        const header = wrapper.createDiv('character-gallery-header');
        const chevron = header.createSpan('location-section-chevron');
        obsidian.setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');
        header.createEl('h4', { text: 'Gallery' });

        // Add button in header
        if (gallery.length < MAX_GALLERY) {
            const addBtn = header.createEl('button', {
                cls: 'character-section-add-field-btn',
                attr: { title: `Add image (${gallery.length}/${MAX_GALLERY})`, 'aria-label': 'Add gallery image' },
            });
            obsidian.setIcon(addBtn, 'plus');
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sceneFolder = this.sceneManager.getSceneFolder();
                pickImageModal(this.app, sceneFolder).then(async (picked) => {
                    if (picked !== undefined) {
                        if (!draft.gallery) draft.gallery = [];
                        draft.gallery.push({ path: picked, caption: '' });
                        this.scheduleSave(draft);
                        if (this.rootContainer) this.renderView(this.rootContainer);
                    }
                });
            });
        }

        const body = wrapper.createDiv('character-gallery-body');
        if (isCollapsed) body.setCssStyles({ display: 'none' });

        header.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.character-section-add-field-btn')) return;
            if (this.collapsedSections.has(SECTION_KEY)) {
                this.collapsedSections.delete(SECTION_KEY);
                body.setCssStyles({ display: '' });
                obsidian.setIcon(chevron, 'chevron-down');
            } else {
                this.collapsedSections.add(SECTION_KEY);
                body.setCssStyles({ display: 'none' });
                obsidian.setIcon(chevron, 'chevron-right');
            }
        });

        // Active (large) image display
        const viewer = body.createDiv('character-gallery-viewer');
        const captionEl = body.createDiv('character-gallery-caption');
        let activeIndex = gallery.length > 0 ? 0 : -1;

        const renderViewer = () => {
            viewer.empty();
            captionEl.empty();
            if (activeIndex >= 0 && activeIndex < gallery.length) {
                const entry = gallery[activeIndex];
                const src = resolveImagePath(this.app, entry.path);
                if (src) {
                    const img = viewer.createEl('img', {
                        cls: 'character-gallery-img',
                        attr: { src, alt: entry.caption || 'Gallery image' },
                    });
                    img.setCssStyles({ cursor: 'pointer' });
                    img.addEventListener('click', () => {
                        const galleryWidth = wrapper.offsetWidth;
                        this.openGalleryLightbox(gallery, activeIndex, galleryWidth);
                    });
                    img.onerror = () => {
                        img.remove();
                        const ph = viewer.createDiv('character-gallery-placeholder');
                        obsidian.setIcon(ph, 'image-off');
                    };
                } else {
                    const ph = viewer.createDiv('character-gallery-placeholder');
                    obsidian.setIcon(ph, 'image-off');
                }

                // Editable caption
                const captionInput = captionEl.createEl('input', {
                    cls: 'character-gallery-caption-input',
                    attr: { type: 'text', placeholder: 'Add caption\u2026', value: entry.caption || '' },
                });
                const idx = activeIndex;
                captionInput.addEventListener('input', () => {
                    gallery[idx].caption = captionInput.value;
                    draft.gallery = gallery.length ? [...gallery] : undefined;
                    this.scheduleSave(draft);
                });

                // Remove button for active image
                const removeBtn = captionEl.createEl('button', {
                    cls: 'character-gallery-remove-btn',
                    attr: { title: 'Remove this image' },
                });
                obsidian.setIcon(removeBtn, 'x');
                removeBtn.addEventListener('click', () => {
                    gallery.splice(idx, 1);
                    draft.gallery = gallery.length ? [...gallery] : undefined;
                    this.scheduleSave(draft);
                    activeIndex = gallery.length > 0 ? Math.min(idx, gallery.length - 1) : -1;
                    renderViewer();
                    renderThumbs();
                });
            } else {
                const ph = viewer.createDiv('character-gallery-empty');
                ph.textContent = 'No images yet';
            }
        };

        // Navigation row: prev | thumbs | next
        const nav = body.createDiv('character-gallery-nav');
        const prevBtn = nav.createEl('button', { cls: 'character-gallery-arrow', attr: { title: 'Previous' } });
        obsidian.setIcon(prevBtn, 'chevron-left');
        prevBtn.addEventListener('click', () => {
            if (gallery.length === 0) return;
            activeIndex = (activeIndex - 1 + gallery.length) % gallery.length;
            renderViewer();
            renderThumbs();
        });

        const thumbStrip = nav.createDiv('character-gallery-thumbs');

        const nextBtn = nav.createEl('button', { cls: 'character-gallery-arrow', attr: { title: 'Next' } });
        obsidian.setIcon(nextBtn, 'chevron-right');
        nextBtn.addEventListener('click', () => {
            if (gallery.length === 0) return;
            activeIndex = (activeIndex + 1) % gallery.length;
            renderViewer();
            renderThumbs();
        });

        const renderThumbs = () => {
            thumbStrip.empty();
            for (let i = 0; i < gallery.length; i++) {
                const thumb = thumbStrip.createDiv(`character-gallery-thumb-item ${i === activeIndex ? 'active' : ''}`);
                const src = resolveImagePath(this.app, gallery[i].path);
                if (src) {
                    thumb.createEl('img', { attr: { src } });
                } else {
                    obsidian.setIcon(thumb, 'image-off');
                }
                thumb.addEventListener('click', () => {
                    activeIndex = i;
                    renderViewer();
                    renderThumbs();
                });
            }
        };

        renderViewer();
        renderThumbs();
    }

    // ── Comments section ────────────────────────────────

    private renderCommentsSection(container: HTMLElement, entry: CodexEntry): void {
        const comments = this.plugin.commentsManager.getCommentsForFile(entry.filePath);
        if (!comments || comments.length === 0) return;

        const section = container.createDiv('codex-side-section');
        section.createEl('h4', { text: 'Comments' });

        const capsuleRow = section.createDiv('sl-comments-capsule-row');
        for (const comment of comments) {
            renderCommentCapsule(
                capsuleRow,
                comment.title,
                comment.status,
                comment.filePath,
                (filePath: string) => {
                    this.plugin.activateView(COMMENTS_VIEW_TYPE);
                    // Attempt to select the comment in the CommentsView
                    const leaves = this.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
                    for (const leaf of leaves) {
                        const view = leaf.view as unknown as { selectComment?: (path: string) => void };
                        if (view && typeof view.selectComment === 'function') {
                            view.selectComment(filePath);
                            this.app.workspace.revealLeaf(leaf);
                            break;
                        }
                    }
                },
            );
        }
    }

    // ══════════════════════════════════════════════════
    //  Actions
    // ══════════════════════════════════════════════════

    private promptNewEntry(): void {
        const catDef = this.codexManager.getCategoryDef(this.activeCategory);
        if (!catDef) {
            new Notice('Select a category first');
            return;
        }

        const modal = new Modal(this.app);
        modal.titleEl.setText(`New ${catDef.label.replace(/s$/, '')}`);

        let nameValue = '';
        new Setting(modal.contentEl)
            .setName('Name')
            .addText(text => {
                text.setPlaceholder(`Enter ${catDef.label.toLowerCase().replace(/s$/, '')} name`);
                text.onChange(v => { nameValue = v; });
                // Allow Enter to create
                text.inputEl.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter' && nameValue.trim()) {
                        e.preventDefault();
                        modal.close();
                        await this.createEntry(nameValue.trim());
                    }
                });
                // Auto-focus
                window.setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(modal.contentEl)
            .addButton(btn => btn
                .setButtonText('Create')
                .setCta()
                .onClick(async () => {
                    if (!nameValue.trim()) return;
                    modal.close();
                    await this.createEntry(nameValue.trim());
                }));

        modal.open();
    }

    private async createEntry(name: string): Promise<void> {
        try {
            const codexFolder = this.sceneManager.getCodexFolder();
            const entry = await this.codexManager.createEntry(codexFolder, this.activeCategory, name);
            this.selectedEntry = entry.filePath;
            new Notice(`Created ${name}`);
            if (this.rootContainer) this.renderView(this.rootContainer);
        } catch (err) {
            new Notice(`Failed to create entry: ${err}`);
        }
    }

    private confirmDeleteEntry(entry: CodexEntry): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Delete entry');
        modal.contentEl.createEl('p', {
            text: `Are you sure you want to delete "${entry.name}"? This cannot be undone.`,
        });
        new Setting(modal.contentEl)
            .addButton(btn => btn
                .setButtonText('Delete')
                .setClass('mod-warning')
                .onClick(async () => {
                    modal.close();
                    try {
                        await this.codexManager.deleteEntry(entry.filePath);
                        this.selectedEntry = null;
                        if (this.rootContainer) this.renderView(this.rootContainer);
                    } catch (err) {
                        new Notice(`Delete failed: ${err}`);
                    }
                }))
            .addButton(btn => btn.setButtonText('Cancel').onClick(() => modal.close()));
        modal.open();
    }

    private renderReferencesPanel(container: HTMLElement, entityName: string): void {
        const index = this.plugin.linkScanner.buildEntityIndex();
        const refs = index.get(entityName.toLowerCase());
        if (!refs || refs.length === 0) return;

        const section = container.createDiv('codex-references-panel');
        section.createEl('h3', { text: 'Referenced by' });

        const groups: Record<string, typeof refs> = {};
        for (const ref of refs) {
            const label = ref.type === 'codex' && ref.codexCategory
                ? ref.codexCategory
                : ref.type;
            if (!groups[label]) groups[label] = [];
            groups[label].push(ref);
        }

        for (const [groupLabel, groupRefs] of Object.entries(groups)) {
            const groupEl = section.createDiv('reference-group');
            groupEl.createEl('h4', { text: groupLabel.charAt(0).toUpperCase() + groupLabel.slice(1) });
            const list = groupEl.createEl('ul', { cls: 'reference-list' });
            for (const ref of groupRefs) {
                const li = list.createEl('li');
                const link = li.createEl('a', { text: ref.name, cls: 'reference-link' });
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.app.workspace.openLinkText(ref.filePath, '', false);
                });
            }
        }
    }

    // ── Stale codex entry warning ──────────────────────

    private async renderStaleWarning(container: HTMLElement, entry: CodexEntry): Promise<void> {
        const staleEntries = await this.plugin.getStaleCodexEntries();
        const match = staleEntries.find(s => s.entry.filePath === entry.filePath);
        if (!match || match.affectedScenes.length === 0) return;

        const section = container.createDiv('codex-stale-warning');
        const header = section.createDiv('codex-stale-header');
        const icon = header.createSpan();
        obsidian.setIcon(icon, 'alert-triangle');
        header.createSpan({ text: ` Modified — ${match.affectedScenes.length} scene${match.affectedScenes.length !== 1 ? 's' : ''} may need review` });

        const list = section.createEl('ul', { cls: 'codex-stale-scene-list' });
        for (const ref of match.affectedScenes) {
            const li = list.createEl('li');
            const link = li.createEl('a', { text: ref.name, cls: 'reference-link' });
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.app.workspace.openLinkText(ref.filePath, '', false);
            });
        }

        const reviewBtn = section.createEl('button', {
            text: 'Mark as reviewed',
            cls: 'codex-stale-reviewed-btn',
        });
        reviewBtn.addEventListener('click', async () => {
            await this.plugin.markCodexEntryReviewed(entry.filePath);
            section.remove();
            new Notice('Entry marked as reviewed');
        });
    }

    // ══════════════════════════════════════════════════
    //  Category management modal
    // ══════════════════════════════════════════════════

    private openManageCategoriesModal(): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Manage codex categories');
        this.renderCategoryManager(modal.contentEl, modal);
        modal.open();
    }

    private renderCategoryManager(el: HTMLElement, modal: Modal): void {
        el.empty();
        el.addClass('codex-category-manager');

        el.createEl('h4', { text: 'Enabled categories' });
        el.createEl('p', { cls: 'setting-item-description', text: 'Toggle categories to show in the codex. Use the sidebar toggle to also show them in the scene inspector.' });

        const enabled = new Set(this.plugin.settings.codexEnabledCategories);
        const sidebarSet = new Set(this.plugin.settings.codexSidebarCategories || []);

        // Built-in categories
        for (const cat of BUILTIN_CODEX_CATEGORIES) {
            const row = el.createDiv('codex-category-manager-row');
            const toggle = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
            toggle.checked = enabled.has(cat.id);
            const iconSpan = row.createSpan({ cls: 'codex-category-manager-icon' });
            obsidian.setIcon(iconSpan, cat.icon);
            row.createSpan({ text: cat.label });

            // Sidebar toggle
            const sidebarLabel = row.createEl('label', { cls: 'codex-sidebar-toggle' });
            sidebarLabel.setCssStyles({
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                opacity: '0.7',
            });
            const sidebarCheck = sidebarLabel.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
            sidebarCheck.checked = sidebarSet.has(cat.id);
            sidebarLabel.createSpan({ text: 'Inspector' });
            sidebarCheck.addEventListener('change', () => {
                if (sidebarCheck.checked) sidebarSet.add(cat.id);
                else sidebarSet.delete(cat.id);
            });

            toggle.addEventListener('change', () => {
                if (toggle.checked) {
                    enabled.add(cat.id);
                } else {
                    enabled.delete(cat.id);
                    sidebarSet.delete(cat.id);
                    sidebarCheck.checked = false;
                }
            });
        }

        // Custom categories
        const customCats = this.plugin.settings.codexCustomCategories;
        if (customCats.length > 0) {
            el.createEl('h4', { text: 'Custom categories' });
            for (const cc of customCats) {
                const row = el.createDiv('codex-category-manager-row');
                const toggle = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
                toggle.checked = enabled.has(cc.id);
                const iconSpan = row.createSpan({ cls: 'codex-category-manager-icon' });
                obsidian.setIcon(iconSpan, cc.icon);
                row.createSpan({ text: cc.label });

                // Sidebar toggle
                const sidebarLabel = row.createEl('label', { cls: 'codex-sidebar-toggle' });
                sidebarLabel.setCssStyles({
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    opacity: '0.7',
                });
                const sidebarCheck = sidebarLabel.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
                sidebarCheck.checked = sidebarSet.has(cc.id);
                sidebarLabel.createSpan({ text: 'Inspector' });
                sidebarCheck.addEventListener('change', () => {
                    if (sidebarCheck.checked) sidebarSet.add(cc.id);
                    else sidebarSet.delete(cc.id);
                });

                toggle.addEventListener('change', () => {
                    if (toggle.checked) {
                        enabled.add(cc.id);
                    } else {
                        enabled.delete(cc.id);
                        sidebarSet.delete(cc.id);
                        sidebarCheck.checked = false;
                    }
                });

                // Delete custom category
                const deleteBtn = row.createEl('button', { cls: 'codex-category-delete-btn' });
                obsidian.setIcon(deleteBtn, 'trash');
                deleteBtn.addEventListener('click', () => {
                    const idx = this.plugin.settings.codexCustomCategories.findIndex(c => c.id === cc.id);
                    if (idx >= 0) this.plugin.settings.codexCustomCategories.splice(idx, 1);
                    enabled.delete(cc.id);
                    this.renderCategoryManager(el, modal);
                });
            }
        }

        // Add custom category
        el.createEl('h4', { text: 'Add custom category' });
        let newLabel = '';
        let newIcon = 'file-text';
        let newLabelInput: HTMLInputElement | null = null;

        new Setting(el)
            .setName('Label')
            .addText(text => {
                text.setPlaceholder('E.g. Factions, artifacts, magic???');
                text.onChange(v => { newLabel = v; });
                newLabelInput = text.inputEl;
            });

        new Setting(el)
            .setName('Icon')
            .addDropdown(dd => {
                for (const opt of CODEX_ICON_OPTIONS) {
                    dd.addOption(opt.value, opt.label);
                }
                dd.setValue(newIcon);
                dd.onChange(v => { newIcon = v; });
            });

        new Setting(el)
            .addButton(btn => btn
                .setButtonText('Add category')
                .setCta()
                .onClick(() => {
                    // Read value directly from input as a fallback in case the change
                    // event hasn't fired yet (issue #115)
                    if (newLabelInput && newLabelInput.value && !newLabel) {
                        newLabel = newLabelInput.value;
                    } else if (newLabelInput) {
                        newLabel = newLabelInput.value || newLabel;
                    }
                    if (!newLabel.trim()) {
                        new Notice('Please enter a label');
                        return;
                    }
                    const id = newLabel.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                    if (!id) {
                        new Notice('Invalid label');
                        return;
                    }
                    // Check duplicates
                    if (BUILTIN_CODEX_CATEGORIES.some(c => c.id === id) ||
                        this.plugin.settings.codexCustomCategories.some(c => c.id === id)) {
                        new Notice('Category already exists');
                        return;
                    }
                    this.plugin.settings.codexCustomCategories.push({
                        id,
                        label: newLabel.trim(),
                        icon: newIcon,
                    });
                    enabled.add(id);
                    this.renderCategoryManager(el, modal);
                }));

        // Save & close
        new Setting(el)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.codexEnabledCategories = Array.from(enabled);
                    this.plugin.settings.codexSidebarCategories = Array.from(sidebarSet);
                    await this.plugin.saveSettings();
                    // Reinitialise codex manager with new categories
                    this.codexManager.initCategories(
                        this.plugin.settings.codexEnabledCategories,
                        this.resolveCustomDefs(),
                    );
                    await this.plugin.reloadEntities();
                    // Reset to first available category if current is disabled
                    const cats = this.codexManager.getCategories();
                    if (!cats.find(c => c.id === this.activeCategory) && cats.length > 0) {
                        this.activeCategory = cats[0].id;
                    }
                    modal.close();
                    if (this.rootContainer) this.renderView(this.rootContainer);
                }));
    }

    // ══════════════════════════════════════════════════
    //  Helpers
    // ══════════════════════════════════════════════════

    private resolveCustomDefs() {
        return this.plugin.settings.codexCustomCategories.map(cc =>
            makeCustomCodexCategory(cc.id, cc.label, cc.icon)
        );
    }

    private switchToView(viewType: string): void {
        try {
            this.leaf.setViewState({ type: viewType, active: true, state: {} });
            this.plugin.app.workspace.revealLeaf(this.leaf);
        } catch {
            this.plugin.activateView(viewType);
        }
    }

    private getTypeField(entry: CodexEntry, catDef: CodexCategoryDef): string {
        // Issue #209 — prefer the shared `entryType` field (available on all
        // categories via the Linking & Matching section) so custom categories
        // and entries without a category-specific Type field still show a badge.
        if (entry.entryType && typeof entry.entryType === 'string') {
            return entry.entryType;
        }
        // Look for fields ending in 'Type' (itemType, creatureType, etc.)
        for (const key of catDef.fieldKeys) {
            if (key.endsWith('Type') && entry[key]) return String(entry[key]);
        }
        return '';
    }

    private countFilledFields(entry: CodexEntry, catDef: CodexCategoryDef): number {
        let count = 0;
        for (const key of catDef.fieldKeys) {
            const val = entry[key];
            if (val !== undefined && val !== null && val !== '' &&
                !(Array.isArray(val) && val.length === 0)) {
                count++;
            }
        }
        return count;
    }

    private renderPseudoTab(
        tabs: HTMLElement,
        label: string,
        icon: string,
        onClick: () => void,
    ): void {
        const tab = tabs.createEl('button', {
            cls: 'codex-tab codex-pseudo-tab',
            attr: { 'aria-label': label },
        });
        const iconSpan = tab.createSpan({ cls: 'codex-tab-icon' });
        obsidian.setIcon(iconSpan, icon);
        tab.createSpan({ cls: 'codex-tab-label', text: label });
        tab.addEventListener('click', onClick);
    }

    // ── Mirror helper ──────────────────────────────────

    /**
     * Build the {@link MirroredSection} list for the current entry.
     *
     * Per the unified mirroring rule (Issue #228 phase 2), every custom field
     * of type Text or Text block is mirrored to the note body automatically —
     * there is no per-field toggle. Default fields are never mirrored.
     */
    private buildMirroredSections(draft: CodexEntry): MirroredSection[] {
        return this.plugin.entityTemplates.buildAutoMirroredSections(
            entityTypeForCodex(draft.type),
            draft.templateSubcategory,
            draft.custom,
        );
    }

    // ── Auto-save ──────────────────────────────────────

    private scheduleSave(draft: CodexEntry): void {
        this._pendingDraft = draft;
        if (this._saveTimer) window.clearTimeout(this._saveTimer);
        this._saveTimer = window.setTimeout(async () => {
            this._saveTimer = null;
            await this.executeSave(draft);
        }, CodexView.SAVE_DEBOUNCE_MS);
    }

    private async executeSave(draft: CodexEntry): Promise<void> {
        try {
            // Build mirrored section info (every custom text / text-block
            // field is mirrored automatically — see buildMirroredSections).
            await this.codexManager.saveEntry(draft, this.buildMirroredSections(draft));
            this._lastSaveTime = Date.now();
            this._pendingDraft = null;
        } catch (err) {
            console.error('StoryLine Codex: save failed', err);
        }
    }

    private async flushPendingSave(): Promise<void> {
        if (this._saveTimer) {
            window.clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (this._pendingDraft) {
            await this.executeSave(this._pendingDraft);
        }
    }

    /**
     * Open a non-modal, draggable/resizable floating window showing a gallery image.
     * Mirrors the lightbox in CharacterView / LocationView so codex entries
     * (items, etc.) can also expand thumbnails to a larger view.
     */
    private openGalleryLightbox(
        gallery: Array<{ path: string; caption: string }>,
        startIndex: number,
        galleryWidth: number,
    ): void {
        activeDocument.querySelector('.gallery-lightbox-window')?.remove();

        let currentIndex = startIndex;
        const winWidth = Math.min(Math.round(galleryWidth * 2), window.innerWidth - 40);
        const winHeight = Math.round((winWidth * 3) / 4) + 36 + 28;

        const win = activeDocument.body.createDiv('gallery-lightbox-window');
        win.setCssStyles({
            width: `${winWidth}px`,
            height: `${winHeight}px`,
        });

        const titlebar = win.createDiv('gallery-lightbox-titlebar');
        const titleText = titlebar.createSpan({ cls: 'gallery-lightbox-title' });
        const closeBtn = titlebar.createEl('button', { cls: 'gallery-lightbox-close', attr: { title: 'Close' } });
        obsidian.setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', () => { cleanup(); win.remove(); });

        const contentRow = win.createDiv('gallery-lightbox-content-row');

        const prevBtn = contentRow.createEl('button', { cls: 'gallery-lightbox-nav-btn', attr: { title: 'Previous' } });
        obsidian.setIcon(prevBtn, 'chevron-left');
        prevBtn.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + gallery.length) % gallery.length;
            renderContent();
        });

        const imgContainer = contentRow.createDiv('gallery-lightbox-content');

        const nextBtn = contentRow.createEl('button', { cls: 'gallery-lightbox-nav-btn', attr: { title: 'Next' } });
        obsidian.setIcon(nextBtn, 'chevron-right');
        nextBtn.addEventListener('click', () => {
            currentIndex = (currentIndex + 1) % gallery.length;
            renderContent();
        });

        const captionEl = win.createDiv('gallery-lightbox-caption');
        const resizeHandle = win.createDiv('gallery-lightbox-resize-handle');

        const zoomLevels = new Map<number, number>();
        const getZoom = () => zoomLevels.get(currentIndex) ?? 1;
        const setZoom = (z: number) => { zoomLevels.set(currentIndex, z); };

        const renderContent = () => {
            const entry = gallery[currentIndex];
            const src = resolveImagePath(this.app, entry.path);
            titleText.textContent = entry.caption || `Image ${currentIndex + 1} of ${gallery.length}`;
            imgContainer.empty();
            if (src) {
                const img = imgContainer.createEl('img', { attr: { src, alt: entry.caption || 'Gallery image' } });
                img.setCssStyles({ transformOrigin: 'center center' });
                const z = getZoom();
                if (z !== 1) img.setCssStyles({ transform: `scale(${z})` });
            }
            captionEl.textContent = entry.caption || '';
            captionEl.setCssStyles({ display: entry.caption ? '' : 'none' });
            prevBtn.setCssStyles({ display: gallery.length > 1 ? '' : 'none' });
            nextBtn.setCssStyles({ display: gallery.length > 1 ? '' : 'none' });
        };
        renderContent();

        imgContainer.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newZoom = Math.max(0.5, Math.min(5, getZoom() + delta));
            setZoom(newZoom);
            const img = imgContainer.querySelector('img');
            if (img) img.setCssStyles({ transform: `scale(${newZoom})` });
        }, { passive: false });

        let pinchStartDist = 0;
        let pinchStartZoom = 1;
        imgContainer.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchStartDist = Math.hypot(dx, dy);
                pinchStartZoom = getZoom();
            }
        }, { passive: true });
        imgContainer.addEventListener('touchmove', (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                const scale = dist / pinchStartDist;
                const newZoom = Math.max(0.5, Math.min(5, pinchStartZoom * scale));
                setZoom(newZoom);
                const img = imgContainer.querySelector('img');
                if (img) img.setCssStyles({ transform: `scale(${newZoom})` });
            }
        }, { passive: false });

        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        titlebar.addEventListener('pointerdown', (e: PointerEvent) => {
            if ((e.target as HTMLElement).closest('.gallery-lightbox-close')) return;
            isDragging = true;
            const rect = win.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            win.setCssStyles({
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                transform: 'none',
            });
            titlebar.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        titlebar.addEventListener('pointermove', (e: PointerEvent) => {
            if (!isDragging) return;
            win.setCssStyles({
                left: `${e.clientX - dragOffsetX}px`,
                top: `${e.clientY - dragOffsetY}px`,
            });
        });
        titlebar.addEventListener('pointerup', () => { isDragging = false; });
        titlebar.addEventListener('lostpointercapture', () => { isDragging = false; });

        let isResizing = false;
        let resizeStartX = 0;
        let resizeStartY = 0;
        let startW = 0;
        let startH = 0;
        resizeHandle.addEventListener('pointerdown', (e: PointerEvent) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            startW = win.offsetWidth;
            startH = win.offsetHeight;
            resizeHandle.setPointerCapture(e.pointerId);
            e.preventDefault();
            e.stopPropagation();
        });
        resizeHandle.addEventListener('pointermove', (e: PointerEvent) => {
            if (!isResizing) return;
            const newW = Math.max(200, startW + (e.clientX - resizeStartX));
            const newH = Math.max(150, startH + (e.clientY - resizeStartY));
            win.setCssStyles({
                width: `${newW}px`,
                height: `${newH}px`,
            });
        });
        resizeHandle.addEventListener('pointerup', () => { isResizing = false; });
        resizeHandle.addEventListener('lostpointercapture', () => { isResizing = false; });

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { cleanup(); win.remove(); }
        };
        activeDocument.addEventListener('keydown', onKey);
        const cleanup = () => { activeDocument.removeEventListener('keydown', onKey); };
    }
}

/* eslint-enable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion -- end of file-wide suppression block opened at line 1 */
