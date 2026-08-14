/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unused-vars -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { Notice } from 'obsidian';
import * as obsidian from 'obsidian';
import { openConfirmModal } from './ConfirmModal';
import { SplitSceneModal } from './SplitMergeModals';
import { isMobile } from './MobileAdapter';
import { WikilinkSuggest } from './WikilinkSuggest';
import { SceneManager } from '../services/SceneManager';
import type SceneCardsPlugin from '../main';
import { renderTagPillInput } from './InlineSuggest';
import { AddCommentModal } from './AddCommentModal';
import { renderCommentCapsule } from './CommentCapsule';
import {
    renderCustomSectionsAtSlot,
    renderMergedSection,
    renderAddCustomSectionButton,
    syncLinkedSections,
    type CustomSectionsHost,
} from './CustomSectionsRenderer';
import { ENTITY_TYPE_SCENE } from '../models/EntityTemplate';
import { renderSubcategoryPicker } from './SubcategoryPicker';
import { parseActChapterInput, actChapterHasIllegalPathChars, isPrologueAct, isEpilogueAct, PROLOGUE_ACT, EPILOGUE_ACT } from '../utils/actChapter';
import { Scene, SceneStatus, getStatusOrder, resolveStatusCfg, SceneCategory, getSceneCategoryOrder, resolveSceneCategoryCfg } from '../models/Scene';

/**
 * Scene inspector sidebar component
 */
export class InspectorComponent {
    private plugin: SceneCardsPlugin;
    private sceneManager: SceneManager;
    private container: HTMLElement;
    private currentScene: Scene | null = null;
    private onEdit: (scene: Scene) => void;
    private onDelete: (scene: Scene) => void;
    private onRefresh: () => void;
    private onStatusChange: (scene: Scene, newStatus: SceneStatus) => void;
    private onCategoryChange: (scene: Scene, newCategory: SceneCategory) => void;
    private onShow: (() => void) | undefined;
    private onHide: (() => void) | undefined;
    private collapsedSections = new Set<string>();
    private customSaveTimer: number | null = null;
    /** Key of the last-rendered scene — used to only restore scroll when
     *  re-rendering the same scene (not when switching scenes). */
    private lastRenderKey = '';

    constructor(
        container: HTMLElement,
        plugin: SceneCardsPlugin,
        sceneManager: SceneManager,
        callbacks: {
            onEdit: (scene: Scene) => void;
            onDelete: (scene: Scene) => void;
            onRefresh: () => void;
            onStatusChange: (scene: Scene, newStatus: SceneStatus) => void;
            onCategoryChange: (scene: Scene, newCategory: SceneCategory) => void;
            onShow?: () => void;
            onHide?: () => void;
        }
    ) {
        this.container = container;
        this.plugin = plugin;
        this.sceneManager = sceneManager;
        this.onEdit = callbacks.onEdit;
        this.onDelete = callbacks.onDelete;
        this.onRefresh = callbacks.onRefresh;
        this.onStatusChange = callbacks.onStatusChange;
        this.onCategoryChange = callbacks.onCategoryChange;
        this.onShow = callbacks.onShow;
        this.onHide = callbacks.onHide;
    }

    /**
     * Show inspector for a scene
     */
    show(scene: Scene): void {
        // If the user is actively editing inside the inspector, skip the
        // re-render to avoid destroying their in-progress input.  Just
        // update the backing scene reference so the next blur/change
        // handler writes to the correct object.
        if (this.container.querySelector('input:focus, textarea:focus, select:focus')) {
            this.currentScene = scene;
            return;
        }
        this.currentScene = scene;
        this.render();
        this.container.setCssStyles({ display: 'block' });
        this.onShow?.();
    }

    /**
     * Whether the inspector panel is currently visible
     */
    isVisible(): boolean {
        return this.container.style.display !== 'none';
    }

    /**
     * Return the scene currently shown in the inspector (if any).
     */
    getCurrentScene(): Scene | null {
        return this.currentScene;
    }

    /**
     * Hide inspector
     */
    hide(): void {
        this.currentScene = null;
        this.container.setCssStyles({ display: 'none' });
        this.onHide?.();
    }

    /**
     * Render the inspector content
     */
    private render(): void {
        const scene = this.currentScene;
        if (!scene) return;

        // Preserve scroll position across the full DOM rebuild so collapsing /
        // adding a section or saving the file doesn't jump the scrollbar. Only
        // restore when re-rendering the same scene — switching scenes resets.
        const renderKey = scene.filePath;
        const samePage = renderKey === this.lastRenderKey;
        const prevScrollTop = this.container.scrollTop;
        const prevScrollLeft = this.container.scrollLeft;

        this.container.empty();
        this.container.addClass('story-line-inspector');

        // Mobile: drag handle for bottom-sheet UX
        if (isMobile) {
            this.container.addClass('sl-mobile');
            this.container.createDiv('inspector-drag-handle');
        }

        // Header
        const header = this.container.createDiv('inspector-header');
        header.createEl('h3', { text: 'Scene details' });
        const closeBtn = header.createEl('button', {
            cls: 'clickable-icon inspector-close',
            text: '×'
        });
        closeBtn.addEventListener('click', () => this.hide());

        // ── Shared input style helper ──
        const styleInput = (el: HTMLElement) => {
            el.setCssStyles({
                width: '100%',
                marginTop: '4px',
                padding: '4px 8px',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '4px',
                background: 'var(--background-primary)',
                color: 'var(--text-normal)',
                font: 'inherit',
                fontSize: '13px',
                boxSizing: 'border-box',
            });
        };

        // ── Custom sections (entity template) — slot above title ──
        const customHost = this.buildCustomSectionsHost(scene);
        renderCustomSectionsAtSlot(this.container, customHost, 0);

        // ── Title (editable) ──
        const titleSection = this.container.createDiv('inspector-title-section');
        const titleInput = titleSection.createEl('input', {
            cls: 'inspector-title-input',
            attr: { type: 'text', placeholder: 'Scene title…' },
        });
        titleInput.value = scene.title || '';
        titleInput.setCssStyles({
            width: '100%',
            fontSize: '16px',
            fontWeight: '600',
            padding: '4px 8px',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '4px',
            background: 'var(--background-primary)',
            color: 'var(--text-normal)',
            boxSizing: 'border-box',
        });
        titleInput.addEventListener('change', async () => {
            const val = titleInput.value.trim();
            if (val && val !== scene.title) {
                const oldTitle = scene.title;
                const oldPath = scene.filePath;
                const newPath = await this.sceneManager.updateScene(oldPath, { title: val }) || oldPath;
                scene.title = val;
                scene.filePath = newPath;

                // Cascade rename: update cross-references in other scenes
                const updated = await this.plugin.cascadeRename.cascadeSceneTitleRename(oldTitle, val);
                if (updated > 0) {
                    new Notice(`Updated ${updated} scene reference${updated !== 1 ? 's' : ''}`);
                }
            }
        });

        // ── Subtitle (optional) ──
        const subtitleInput = titleSection.createEl('input', {
            cls: 'inspector-subtitle-input',
            attr: { type: 'text', placeholder: 'Subtitle (optional)…' },
        });
        subtitleInput.value = scene.subtitle || '';
        styleInput(subtitleInput);
        subtitleInput.setCssStyles({ fontStyle: 'italic' });
        subtitleInput.addEventListener('change', async () => {
            const val = subtitleInput.value.trim() || undefined;
            await this.sceneManager.updateScene(scene.filePath, { subtitle: val });
            scene.subtitle = val;
        });

        // Subcategory picker (only when the scene entity type has an axis)
        renderSubcategoryPicker({
            container: this.container,
            entityTemplates: this.plugin.entityTemplates,
            entityType: ENTITY_TYPE_SCENE,
            current: scene.templateSubcategory,
            onChange: async (value) => {
                scene.templateSubcategory = value;
                await this.sceneManager.updateScene(scene.filePath, { templateSubcategory: value });
                // Re-render immediately so the new subcategory's custom
                // sections show without waiting for the next refresh.
                this.render();
            },
        });

        // ── Act / Chapter / Sequence row ──
        const acRow = this.container.createDiv('inspector-section');
        acRow.setCssStyles({
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px',
        });

        // Act
        const actGroup = acRow.createDiv();
        actGroup.createSpan({ cls: 'inspector-label', text: 'Act' });
        // Use a free-text input (not a dropdown) so users can name acts
        // however they like — "1", "1.1", "Prologue", etc.  parseActChapterInput
        // keeps integers as numbers and anything else as a trimmed string.
        const actInput = actGroup.createEl('input', { attr: { type: 'text', placeholder: '#' } });
        styleInput(actInput);
        actInput.value = scene.act !== undefined ? String(scene.act) : '';
        actInput.addEventListener('change', async () => {
            const val = parseActChapterInput(actInput.value);
            // Warn (don't block) if the value would create a folder name with
            // characters that are illegal on Windows. SceneManager sanitizes
            // the folder name itself, but the user should know the on-disk
            // name will differ from what they typed.
            if (typeof val === 'string' && actChapterHasIllegalPathChars(val)) {
                new Notice(`Act name contains characters that aren't allowed in folder names; they'll be replaced with "-".`);
            }
            await this.sceneManager.updateScene(scene.filePath, { act: val });
            scene.act = val;
            // Update quick-select button states
            prologueBtn.classList.toggle('is-active', isPrologueAct(val));
            epilogueBtn.classList.toggle('is-active', isEpilogueAct(val));
        });

        // Prologue / Epilogue quick-select buttons
        const actQuickRow = actGroup.createDiv('sl-inspector-act-quick');
        const prologueBtn = actQuickRow.createEl('button', {
            cls: `sl-inspector-act-quick-btn ${isPrologueAct(scene.act) ? 'is-active' : ''}`,
            text: 'Prologue',
        });
        prologueBtn.addEventListener('click', async () => {
            const newVal = isPrologueAct(scene.act) ? undefined : PROLOGUE_ACT;
            actInput.value = newVal !== undefined ? String(newVal) : '';
            await this.sceneManager.updateScene(scene.filePath, { act: newVal });
            scene.act = newVal;
            prologueBtn.classList.toggle('is-active', isPrologueAct(newVal));
            epilogueBtn.classList.toggle('is-active', isEpilogueAct(newVal));
        });
        const epilogueBtn = actQuickRow.createEl('button', {
            cls: `sl-inspector-act-quick-btn ${isEpilogueAct(scene.act) ? 'is-active' : ''}`,
            text: 'Epilogue',
        });
        epilogueBtn.addEventListener('click', async () => {
            const newVal = isEpilogueAct(scene.act) ? undefined : EPILOGUE_ACT;
            actInput.value = newVal !== undefined ? String(newVal) : '';
            await this.sceneManager.updateScene(scene.filePath, { act: newVal });
            scene.act = newVal;
            prologueBtn.classList.toggle('is-active', isPrologueAct(newVal));
            epilogueBtn.classList.toggle('is-active', isEpilogueAct(newVal));
        });

        // Chapter
        const chGroup = acRow.createDiv();
        chGroup.createSpan({ cls: 'inspector-label', text: 'Chapter' });
        const chInput = chGroup.createEl('input', { attr: { type: 'text', placeholder: '#' } });
        styleInput(chInput);
        chInput.value = scene.chapter !== undefined ? String(scene.chapter) : '';
        chInput.addEventListener('change', async () => {
            const val = parseActChapterInput(chInput.value);
            if (typeof val === 'string' && actChapterHasIllegalPathChars(val)) {
                new Notice(`Chapter name contains characters that aren't allowed in folder names; they'll be replaced with "-".`);
            }
            await this.sceneManager.updateScene(scene.filePath, { chapter: val });
            scene.chapter = val;
        });

        // Sequence
        const seqGroup = acRow.createDiv();
        seqGroup.createSpan({ cls: 'inspector-label', text: 'Sequence' });
        const seqInput = seqGroup.createEl('input', { attr: { type: 'number', placeholder: '#' } });
        styleInput(seqInput);
        seqInput.value = scene.sequence !== undefined ? String(scene.sequence) : '';
        seqInput.addEventListener('change', async () => {
            const val = seqInput.value.trim() ? Number(seqInput.value) : undefined;
            await this.sceneManager.updateScene(scene.filePath, { sequence: val });
            scene.sequence = val;
        });

        // ── Status + Category dropdowns (side-by-side when categories enabled) ──
        const statusSection = this.container.createDiv('inspector-section');
        if (this.plugin.settings.sceneCategoriesEnabled) {
            statusSection.setCssStyles({ display: 'flex', alignItems: 'center', gap: '16px' });
        }

        // Status dropdown
        const statusWrap = statusSection.createSpan({ cls: 'inspector-dropdown-wrap' });
        statusWrap.setCssStyles({ display: 'inline-flex', alignItems: 'center', gap: '4px' });
        statusWrap.createSpan({ cls: 'inspector-label', text: 'Status: ' });

        const statusDropdown = statusWrap.createDiv('inspector-status-dropdown');
        const currentStatus = scene.status || 'idea';
        const currentCfg = resolveStatusCfg(currentStatus);

        const statusButton = statusDropdown.createEl('button', {
            cls: 'inspector-status-button',
        });
        const btnIcon = statusButton.createSpan({ cls: 'inspector-status-icon' });
        obsidian.setIcon(btnIcon, currentCfg.icon);
        const btnChevron = statusButton.createSpan({ cls: 'inspector-status-chevron' });
        obsidian.setIcon(btnChevron, 'chevron-down');

        const statusMenu = statusDropdown.createDiv('inspector-status-menu');
        statusMenu.setCssStyles({ display: 'none' });

        const statusValues = getStatusOrder();
        statusValues.forEach(s => {
            const cfg = resolveStatusCfg(s);
            const item = statusMenu.createDiv({
                cls: `inspector-status-item ${s === currentStatus ? 'active' : ''}`
            });
            const itemIcon = item.createSpan({ cls: 'inspector-status-icon' });
            obsidian.setIcon(itemIcon, cfg.icon);
            item.createSpan({ text: cfg.label });

            item.addEventListener('click', () => {
                statusMenu.setCssStyles({ display: 'none' });
                this.onStatusChange(scene, s);
            });
        });

        statusButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = statusMenu.style.display !== 'none';
            statusMenu.setCssStyles({ display: isVisible ? 'none' : 'block' });
        });

        const closeMenu = (e: MouseEvent) => {
            if (!statusDropdown.contains(e.target as Node)) {
                statusMenu.setCssStyles({ display: 'none' });
                activeDocument.removeEventListener('click', closeMenu);
            }
        };
        statusButton.addEventListener('click', () => {
            window.setTimeout(() => activeDocument.addEventListener('click', closeMenu), 0);
        });

        // Category dropdown (visible only when scene categories are enabled)
        if (this.plugin.settings.sceneCategoriesEnabled) {
            const catWrap = statusSection.createSpan({ cls: 'inspector-dropdown-wrap' });
            catWrap.setCssStyles({ display: 'inline-flex', alignItems: 'center', gap: '4px' });
            catWrap.createSpan({ cls: 'inspector-label', text: 'Category: ' });

            const categoryDropdown = catWrap.createDiv('inspector-status-dropdown');
            const currentCategory = scene.category || this.plugin.settings.defaultSceneCategory || 'generic';
            const currentCatCfg = resolveSceneCategoryCfg(currentCategory);

            const catButton = categoryDropdown.createEl('button', {
                cls: 'inspector-status-button',
            });
            const catBtnIcon = catButton.createSpan({ cls: 'inspector-status-icon' });
            obsidian.setIcon(catBtnIcon, currentCatCfg.icon);
            const catBtnChevron = catButton.createSpan({ cls: 'inspector-status-chevron' });
            obsidian.setIcon(catBtnChevron, 'chevron-down');

            const catMenu = categoryDropdown.createDiv('inspector-status-menu');
            catMenu.setCssStyles({ display: 'none' });

            const catValues = getSceneCategoryOrder();
            catValues.forEach(cat => {
                const cfg = resolveSceneCategoryCfg(cat);
                const item = catMenu.createDiv({
                    cls: `inspector-status-item ${cat === currentCategory ? 'active' : ''}`
                });
                const itemIcon = item.createSpan({ cls: 'inspector-status-icon' });
                obsidian.setIcon(itemIcon, cfg.icon);
                item.createSpan({ text: cfg.label });

                item.addEventListener('click', () => {
                    catMenu.setCssStyles({ display: 'none' });
                    this.onCategoryChange(scene, cat);
                });
            });

            catButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = catMenu.style.display !== 'none';
                catMenu.setCssStyles({ display: isVisible ? 'none' : 'block' });
            });

            const closeCatMenu = (e: MouseEvent) => {
                if (!categoryDropdown.contains(e.target as Node)) {
                    catMenu.setCssStyles({ display: 'none' });
                    activeDocument.removeEventListener('click', closeCatMenu);
                }
            };
            catButton.addEventListener('click', () => {
                window.setTimeout(() => activeDocument.addEventListener('click', closeCatMenu), 0);
            });
        }

        // ── Characters (autocomplete tag-pill input) ──
        const charSection = this.container.createDiv('inspector-section');
        charSection.createSpan({ cls: 'inspector-label', text: 'Characters:' });
        const charPillContainer = charSection.createDiv('inspector-chip-list');

        renderTagPillInput({
            container: charPillContainer,
            values: scene.characters || [],
            getSuggestions: () => {
                const allCharNames = this.sceneManager.queryService.getAllCharacters();
                const cm = this.plugin.characterManager;
                const names = new Map<string, string>();
                for (const c of allCharNames) names.set(c.toLowerCase(), c);
                if (cm) {
                    for (const ch of cm.getAllCharacters()) {
                        if (!names.has(ch.name.toLowerCase())) names.set(ch.name.toLowerCase(), ch.name);
                    }
                }
                return Array.from(names.values()).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
            },
            onChange: async (values) => {
                await this.sceneManager.updateScene(scene.filePath, { characters: values });
                scene.characters = values;
            },
            placeholder: 'Add character…',
        });

        // ── Locations (autocomplete tag-pill input) ──
        const locSection = this.container.createDiv('inspector-section');
        locSection.createSpan({ cls: 'inspector-label', text: 'Locations:' });
        const locPillContainer = locSection.createDiv('inspector-chip-list');

        renderTagPillInput({
            container: locPillContainer,
            values: scene.locations || [],
            getSuggestions: () => this.getLocationNames(),
            onChange: async (values) => {
                await this.sceneManager.updateScene(scene.filePath, { locations: values });
                scene.locations = values;
            },
            placeholder: 'Add location…',
            getDisplayLabel: this.getLocationDisplayLabel(),
        });

        // ── Scenarios (one-way link to Dynamic Narrative scenarios) ──
        const dnMgr = this.plugin.dynamicNarrativeManager;
        const scenarioSection = this.container.createDiv('inspector-section');
        scenarioSection.createSpan({ cls: 'inspector-label', text: 'Scenarios:' });
        const scenarioPillContainer = scenarioSection.createDiv('inspector-chip-list');

        renderTagPillInput({
            container: scenarioPillContainer,
            values: scene.scenarios || [],
            getSuggestions: () => {
                const names = new Map<string, string>();
                if (dnMgr) {
                    for (const s of dnMgr.getAllScenarios()) {
                        if (s.title) names.set(s.title.toLowerCase(), s.title);
                    }
                }
                // Keep existing values selectable even if the scenario was
                // deleted from the Dynamic Narrative.
                for (const v of scene.scenarios || []) {
                    if (!names.has(v.toLowerCase())) names.set(v.toLowerCase(), v);
                }
                return Array.from(names.values()).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
            },
            onChange: async (values) => {
                await this.sceneManager.updateScene(scene.filePath, { scenarios: values });
                scene.scenarios = values;
            },
            placeholder: 'Add scenario…',
        });

        // ── Dynamic Codex sections (categories with showInSidebar) ──
        this.renderCodexSections(scene);

        // ── Custom sections (entity template) — slot after Connected Entities ──
        renderCustomSectionsAtSlot(this.container, customHost, 1);
        renderMergedSection(this.container, customHost, 'Connected Entities');

        // ── Arc Point toggle ──
        const arcRow = this.container.createDiv('inspector-section');
        arcRow.addClass('inspector-arc-row');
        const arcCheckbox = arcRow.createEl('input', {
            attr: { type: 'checkbox', id: 'arc-anchor-toggle' },
        });
        arcCheckbox.checked = !!scene.arcAnchor;
        arcCheckbox.addClass('inspector-arc-checkbox');
        const arcLabel = arcRow.createEl('label', {
            attr: { for: 'arc-anchor-toggle' },
            text: 'Arc point',
        });
        arcLabel.addClass('inspector-arc-label');
        arcCheckbox.addEventListener('change', async () => {
            const val = arcCheckbox.checked;
            await this.sceneManager.updateScene(scene.filePath, { arcAnchor: val });
            scene.arcAnchor = val || undefined;
        });

        // ── Tags / Plotlines (autocomplete tag-pill input) ──
        const tagSection = this.container.createDiv('inspector-section');
        tagSection.createSpan({ cls: 'inspector-label', text: 'Plotlines / Tags:' });
        const tagPillContainer = tagSection.createDiv('inspector-chip-list');
        tagPillContainer.setCssStyles({
            marginTop: '4px',
        });

        const tagColors = this.plugin.settings.tagColors || {};
        const scheme = this.plugin.settings.colorScheme;
        const allTagsSorted = this.sceneManager.queryService.getAllTags().sort();

        renderTagPillInput({
            container: tagPillContainer,
            values: scene.tags || [],
            getSuggestions: () => allTagsSorted,
            onChange: async (values) => {
                await this.sceneManager.updateScene(scene.filePath, { tags: values });
                scene.tags = values;
            },
            placeholder: 'Add plotline…',
        });

        // ── Custom sections (entity template) — slot after General ──
        renderCustomSectionsAtSlot(this.container, customHost, 2);
        renderMergedSection(this.container, customHost, 'General');
        renderAddCustomSectionButton(this.container, customHost);

        // ── Detected in text (LinkScanner results) ──
        this.renderDetectedLinks(scene);

        // Editorial Notes / Revision Comments
        this.renderNotes(scene);

        // Comments
        this.renderCommentsContainer(scene);

        // Action buttons
        const actions = this.container.createDiv('inspector-actions');

        const editBtn = actions.createEl('button', {
            cls: 'mod-cta',
            text: 'Edit scene'
        });
        editBtn.addEventListener('click', () => this.onEdit(scene));

        const splitBtn = actions.createEl('button', {
            text: 'Split scene'
        });
        splitBtn.addEventListener('click', () => {
            new SplitSceneModal(this.plugin, scene, () => {
                // After split, hide inspector and refresh the board
                this.hide();
                this.onRefresh();
            }).open();
        });

        const deleteBtn = actions.createEl('button', {
            cls: 'mod-warning',
            text: 'Delete'
        });
        deleteBtn.addEventListener('click', () => {
            openConfirmModal(this.plugin.app, {
                title: 'Delete Scene',
                message: `Delete scene "${scene.title || 'Untitled'}"?`,
                confirmLabel: 'Delete',
                onConfirm: () => {
                    this.onDelete(scene);
                    this.hide();
                },
            });
        });

        this.container.scrollTop = samePage ? prevScrollTop : 0;
        this.container.scrollLeft = samePage ? prevScrollLeft : 0;
        this.lastRenderKey = renderKey;
    }

    /**
     * Build the {@link CustomSectionsHost} used to render entity-template
     * custom sections for the current scene. Structure changes persist via
     * {@link EntityTemplateService}; values live in scene.custom and are
     * saved through the normal scene update path.
     */
    private buildCustomSectionsHost(scene: Scene): CustomSectionsHost<Scene> {
        const subcategory = scene.templateSubcategory;
        const sections = this.plugin.entityTemplates.getCustomSections(ENTITY_TYPE_SCENE, subcategory);
        const defaultTitles = this.plugin.entityTemplates.getDefaultSectionTitles(ENTITY_TYPE_SCENE);
        return {
            app: this.plugin.app,
            draft: scene,
            sections,
            entityType: ENTITY_TYPE_SCENE,
            subcategory,
            entityTemplates: this.plugin.entityTemplates,
            remigrateLinkedKeys: (ops, subcats) => {
                void this.plugin.customKeyMigrator.remigrateCustomKeys(ENTITY_TYPE_SCENE, ops, subcats, scene.filePath);
            },
            builtinSectionCount: defaultTitles.length,
            collapsedSections: this.collapsedSections,
            collapseKeyPrefix: 'scene',
            cssPrefix: 'codex',
            isMergedSectionTitle: (title) => defaultTitles.includes(title),
            scheduleSave: (d) => this.scheduleSceneCustomSave(d),
            persistSections: () => {
                void this.plugin.entityTemplates.setCustomSections(ENTITY_TYPE_SCENE, subcategory, sections);
                void syncLinkedSections(this.plugin.entityTemplates, ENTITY_TYPE_SCENE, subcategory, sections);
            },
            requestRerender: () => {
                if (this.currentScene) this.render();
            },
        };
    }

    /** Debounced persistence of scene.custom after custom-field edits. */
    private scheduleSceneCustomSave(scene: Scene): void {
        if (this.customSaveTimer) window.clearTimeout(this.customSaveTimer);
        this.customSaveTimer = window.setTimeout(() => {
            this.customSaveTimer = null;
            void this.sceneManager.updateScene(scene.filePath, { custom: scene.custom });
        }, 400);
    }

    /**
     * Render dynamic Codex sections for categories that have showInSidebar enabled.
     * Each enabled category gets a tag-pill input populated with codex entry names.
     */
    private renderCodexSections(scene: Scene): void {
        const codexMgr = this.plugin.codexManager;
        if (!codexMgr) return;

        const sidebarCatIds = this.plugin.settings.codexSidebarCategories || [];
        if (sidebarCatIds.length === 0) return;

        for (const catId of sidebarCatIds) {
            const catDef = codexMgr.getCategoryDef(catId);
            if (!catDef) continue;

            const section = this.container.createDiv('inspector-section');
            const labelRow = section.createDiv();
            labelRow.setCssStyles({
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
            });
            const iconEl = labelRow.createSpan();
            obsidian.setIcon(iconEl, catDef.icon);
            labelRow.createSpan({ cls: 'inspector-label', text: `${catDef.label}:` });

            const pillContainer = section.createDiv('inspector-chip-list');

            const currentLinks = scene.codexLinks?.[catId] || [];
            renderTagPillInput({
                container: pillContainer,
                values: currentLinks,
                getSuggestions: () => codexMgr.getEntries(catId).map(e => e.name),
                onChange: async (values) => {
                    if (!scene.codexLinks) scene.codexLinks = {};
                    scene.codexLinks[catId] = values;
                    await this.sceneManager.updateScene(scene.filePath, { codexLinks: scene.codexLinks });
                },
                placeholder: `Add ${catDef.label.toLowerCase()}…`,
            });
        }
    }

    /**
     * Render detected wikilinks from scene body text (via LinkScanner).
     */
    private renderDetectedLinks(scene: Scene): void {
        const scanner = this.plugin.linkScanner;
        const result = scanner.getResult(scene.filePath) ?? scanner.scan(scene);

        if (result.links.length === 0) return;

        const overrides = this.plugin.settings.tagTypeOverrides;

        // Exclude links that are already listed in frontmatter characters / locations / codexLinks
        const fmChars = new Set((scene.characters || []).map(c => c.toLowerCase()));
        const fmLocs = new Set((scene.locations || []).map(l => l.toLowerCase()));
        const fmCodex = new Set<string>();
        if (scene.codexLinks) {
            for (const names of Object.values(scene.codexLinks)) {
                for (const n of names) fmCodex.add(n.toLowerCase());
            }
        }
        // Issue #89 — user-marked "ignore in this scene"
        const ignored = new Set((scene.ignored_detections || []).map(n => n.toLowerCase()));
        const novel = result.links.filter(l => {
            const key = l.name.toLowerCase();
            if (ignored.has(key)) return false;
            if (l.type === 'character' && fmChars.has(key)) return false;
            if (l.type === 'location' && fmLocs.has(key)) return false;
            if (fmCodex.has(key)) return false;
            return true;
        });

        if (novel.length === 0) return;

        const section = this.container.createDiv('inspector-section inspector-detected-links');
        const headerRow = section.createDiv('inspector-detected-header');
        const hdrIcon = headerRow.createSpan();
        obsidian.setIcon(hdrIcon, 'scan-search');
        headerRow.createSpan({ cls: 'inspector-label', text: ' Detected in text' });

        const pillContainer = section.createDiv('inspector-detected-pills');
        const typeIcons: Record<string, string> = {
            character: 'user',
            location: 'map-pin',
            prop: 'gem',
            other: 'file-text',
        };
        // Add codex category icons
        const codexMgr = this.plugin.codexManager;
        if (codexMgr) {
            for (const cat of codexMgr.getCategories()) {
                typeIcons[`codex:${cat.id}`] = cat.icon;
            }
        }

        for (const link of novel) {
            const low = link.name.toLowerCase();
            const resolvedType = overrides[low] || link.type;
            const pill = pillContainer.createDiv(`inspector-detected-pill detected-type-${resolvedType}`);
            if (overrides[low]) pill.addClass('tag-overridden');
            const icon = pill.createSpan({ cls: 'inspector-detected-icon' });
            obsidian.setIcon(icon, typeIcons[resolvedType] || 'file-text');
            pill.createSpan({ text: link.name });

            // Right-click to override type
            pill.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showTagTypeMenu(e, link.name, () => {
                    if (this.currentScene) this.render();
                });
            });
        }
    }

    /**
     * Show a context menu to override the type of a detected link / tag.
     */
    private showTagTypeMenu(e: MouseEvent, tagName: string, onUpdate: () => void): void {
        const low = tagName.toLowerCase();
        const current = this.plugin.settings.tagTypeOverrides[low];

        const types: { label: string; value: string | null; icon: string }[] = [
            { label: 'Prop', value: 'prop', icon: 'gem' },
            { label: 'Location', value: 'location', icon: 'map-pin' },
            { label: 'Character', value: 'character', icon: 'user' },
            { label: 'Other', value: 'other', icon: 'file-text' },
        ];

        // Add codex categories that are shown in sidebar
        const codexMgr = this.plugin.codexManager;
        const sidebarCatIds = this.plugin.settings.codexSidebarCategories || [];
        if (codexMgr) {
            for (const catId of sidebarCatIds) {
                const catDef = codexMgr.getCategoryDef(catId);
                if (catDef) {
                    types.push({ label: catDef.label, value: `codex:${catId}`, icon: catDef.icon });
                }
            }
        }

        types.push({ label: 'Reset to Auto', value: null, icon: 'rotate-ccw' });

        const menu = new obsidian.Menu();
        menu.addItem(item => item.setTitle(tagName).setDisabled(true));
        menu.addSeparator();
        // Issue #89 — Ignore this name in the current scene only
        const sceneForIgnore = this.currentScene;
        if (sceneForIgnore) {
            menu.addItem(item => {
                item.setTitle('Ignore in this scene')
                    .setIcon('eye-off')
                    .onClick(async () => {
                        const cur = sceneForIgnore.ignored_detections || [];
                        if (!cur.some(n => n.toLowerCase() === low)) {
                            const updated = [...cur, tagName];
                            await this.sceneManager.updateScene(sceneForIgnore.filePath, { ignored_detections: updated });
                            sceneForIgnore.ignored_detections = updated;
                        }
                        onUpdate();
                    });
            });
            menu.addSeparator();
        }
        for (const t of types) {
            menu.addItem(item => {
                item.setTitle(t.label)
                    .setIcon(t.icon)
                    .setChecked(t.value !== null && current === t.value)
                    .onClick(async () => {
                        if (t.value === null) {
                            delete this.plugin.settings.tagTypeOverrides[low];
                        } else if (t.value.startsWith('codex:')) {
                            // Add to scene.codexLinks for this category
                            const catId = t.value.slice(6);
                            const scene = this.currentScene;
                            if (scene) {
                                if (!scene.codexLinks) scene.codexLinks = {};
                                const arr = scene.codexLinks[catId] || [];
                                if (!arr.some(n => n.toLowerCase() === low)) {
                                    arr.push(tagName);
                                    scene.codexLinks[catId] = arr;
                                    await this.sceneManager.updateScene(scene.filePath, { codexLinks: scene.codexLinks });
                                }
                            }
                            // Also set the type override for display
                            this.plugin.settings.tagTypeOverrides[low] = t.value;
                        } else {
                            this.plugin.settings.tagTypeOverrides[low] = t.value;
                        }
                        await this.plugin.saveSettings();
                        onUpdate();
                    });
            });
        }
        menu.showAtMouseEvent(e);
    }

    /**
     * Render an editable editorial notes / revision comments section.
     * Uses an embedded CodeMirror editor for rich markdown editing,
     * plus an "Open notes file" button that creates/opens an external
     * .md file in the SceneNotes folder.
     */
    private renderNotes(scene: Scene): void {
        const section = this.container.createDiv('inspector-section inspector-notes');
        const labelRow = section.createDiv('inspector-notes-header');
        const icon = labelRow.createSpan();
        obsidian.setIcon(icon, 'message-square');
        labelRow.createSpan({ cls: 'inspector-label', text: ' Notes / Comments' });

        // "Open notes file" button — creates/opens an external .md file
        const openFileBtn = labelRow.createEl('button', {
            cls: 'clickable-icon',
            attr: { title: 'Open as separate notes file', 'aria-label': 'Open notes file' },
        });
        obsidian.setIcon(openFileBtn, 'file-text');
        openFileBtn.addEventListener('click', async () => {
            await this.sceneManager.openSceneNotes(scene);
        });

        const notesContainer = section.createDiv('inspector-notes-container');
        void this.renderInspectorNotesLive(notesContainer, scene);
    }

    /**
     * Live markdown notes: rendered preview by default.
     * Click to edit (textarea), blur to save & return to preview.
     * Checkboxes are interactive in preview mode.
     */
    private async renderInspectorNotesLive(container: HTMLElement, scene: Scene): Promise<void> {
        container.empty();
        const notesText = await this.getCurrentSceneNotesText(scene);
        scene.notes = notesText || undefined;

        if (!notesText) {
            // Empty state — show a clickable placeholder that opens the editor
            const placeholder = container.createDiv('inspector-notes-live is-empty');
            placeholder.createDiv({ cls: 'inspector-notes-placeholder', text: 'Click to add notes…' });
            placeholder.addEventListener('click', () => {
                this.renderInspectorNotesEditor(container, scene, '');
            });
            return;
        }

        // Rendered markdown preview
        const previewEl = container.createDiv('inspector-notes-live is-preview');
        obsidian.MarkdownRenderer.render(
            this.plugin.app,
            notesText,
            previewEl,
            scene.filePath,
            this,
        );

        // Click on preview → switch to editor (but not on links/checkboxes)
        previewEl.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'A' || target.tagName === 'INPUT') return;
            void this.getCurrentSceneNotesText(scene).then((currentNotes) => {
                this.renderInspectorNotesEditor(container, scene, currentNotes);
            });
        });

        // Interactive checkboxes
        previewEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            const checkbox = cb as HTMLInputElement;
            checkbox.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const checked = checkbox.checked;
                const notes = await this.getCurrentSceneNotesText(scene);
                const lines = notes.split('\n');
                let lineIdx = 0;
                let foundIdx = -1;
                for (const line of lines) {
                    const match = line.match(/^(\s*-\s*)\[([ xX])\]/);
                    if (match) {
                        if (previewEl.querySelectorAll('input[type="checkbox"]')[lineIdx] === checkbox) {
                            foundIdx = lines.indexOf(line);
                            break;
                        }
                        lineIdx++;
                    }
                }
                if (foundIdx >= 0) {
                    lines[foundIdx] = lines[foundIdx].replace(/- \[[ xX]\]/, checked ? '- [x]' : '- [ ]');
                    const newNotes = lines.join('\n');
                    await this.sceneManager.updateScene(scene.filePath, { notes: newNotes });
                    scene.notes = newNotes;
                    await this.sceneManager.writeSceneNotes(scene, newNotes ? `${newNotes}\n` : '');
                    void this.renderInspectorNotesLive(container, scene);
                }
            });
        });
    }

    private renderInspectorNotesEditor(container: HTMLElement, scene: Scene, currentNotes: string): void {
        container.empty();
        const editorEl = container.createDiv('inspector-notes-live is-editing');

        const textarea = editorEl.createEl('textarea', {
            cls: 'inspector-notes-textarea',
            attr: { placeholder: 'Write notes in markdown — use - [ ] for checkboxes, **bold**, [[wikilinks]]', rows: '4' },
        });
        textarea.value = currentNotes;

        // Issue #84 — attach a wikilink autocomplete (`[[…]]`) so users
        // can quickly link to other notes from the comments field.
        const suggest = new WikilinkSuggest({ app: this.plugin.app, textareaEl: textarea });
        // Tear down the dropdown when the inspector re-renders.
        this.plugin.register(() => suggest.destroy());

        // Auto-focus
        window.requestAnimationFrame(() => textarea.focus());

        // Save on blur → return to live preview
        textarea.addEventListener('blur', async () => {
            const val = textarea.value;
            const trimmed = val.trim();
            await this.sceneManager.updateScene(scene.filePath, { notes: trimmed || undefined });
            scene.notes = trimmed || undefined;
            await this.sceneManager.writeSceneNotes(scene, trimmed ? `${trimmed}\n` : '');
            void this.renderInspectorNotesLive(container, scene);
        });

        // Escape to finish editing
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                textarea.blur();
            }
        });
    }

    private stripRedundantNotesHeadings(content: string, scene: Scene): string {
        const title = (scene.title || 'Untitled').trim();
        const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
        let index = 0;
        while (index < lines.length && lines[index].trim() === '') index++;
        while (index < lines.length) {
            const trimmed = lines[index].trim();
            const text = trimmed.replace(/^#{1,6}\s+/, '').trim();
            const isHeading = /^#{1,6}\s+/.test(trimmed);
            const isRedundant = isHeading && (text === title || text === `Notes: ${title}` || text === 'Notes');
            if (!isRedundant) break;
            lines.splice(index, 1);
            while (index < lines.length && lines[index].trim() === '') lines.splice(index, 1);
        }
        return lines.join('\n').trimStart();
    }

    private async getCurrentSceneNotesText(scene: Scene): Promise<string> {
        // Issue #200 — read-only lookup so rendering a scene doesn't create an
        // empty notes file. The file is created lazily by writeSceneNotes()
        // when the user actually types something.
        const notesPath = this.sceneManager.getSceneNotesFile(scene);
        const notesFile = notesPath
            ? this.plugin.app.vault.getAbstractFileByPath(notesPath)
            : null;
        const fileNotes = notesFile instanceof obsidian.TFile
            ? await this.plugin.app.vault.read(notesFile)
            : (scene.notes ?? '');
        return this.stripRedundantNotesHeadings(fileNotes, scene).trim();
    }

    /**
     * Collect all known location names from LocationManager + scene metadata.
     */
    private getLocationNames(): string[] {
        const names = new Map<string, string>(); // lowercase → display

        // From LocationManager on the plugin
        const lm = this.plugin.locationManager;
        if (lm) {
            for (const loc of lm.getAllLocations()) {
                const key = loc.name.toLowerCase();
                if (!names.has(key)) names.set(key, loc.name);
            }
        }

        // From scene metadata (catches locations not yet profiled)
        const sceneLocations = this.sceneManager.queryService.getUniqueValues('location');
        for (const name of sceneLocations) {
            const key = name.toLowerCase();
            if (!names.has(key)) names.set(key, name);
        }

        return Array.from(names.values()).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
    }

    /**
     * Build a display-label function for locations (e.g., "Parent > Child").
     */
    private getLocationDisplayLabel(): (value: string) => string {
        const lm = this.plugin.locationManager;
        if (!lm) return (v) => v;
        const displayMap = lm.getDisplayNameMap();
        return (value: string) => displayMap.get(value) || value;
    }

    /**
     * Render connected Comments at the bottom of the inspector.
     * Container is only shown when at least one comment exists for the scene.
     */
    private renderCommentsContainer(scene: Scene): void {
        if (!this.plugin.commentsManager) return;
        const comments = this.plugin.commentsManager.getCommentsForFile(scene.filePath);
        if (!comments || comments.length === 0) return;

        const section = this.container.createDiv('inspector-section inspector-comments-section');

        const header = section.createDiv('inspector-comments-header');
        header.createSpan({ cls: 'inspector-section-title', text: 'Comments' });

        const addBtn = header.createEl('button', {
            cls: 'inspector-comments-add-btn',
            attr: { 'aria-label': 'Add comment' },
        });
        obsidian.setIcon(addBtn.createSpan(), 'plus');
        addBtn.addEventListener('click', () => {
            const commentsFolder = this.sceneManager.getCommentsFolder();
            if (!commentsFolder) return;
            new AddCommentModal(
                this.plugin.app,
                this.plugin.commentsManager,
                commentsFolder,
                scene.filePath,
                scene.title || 'Untitled',
                'scene',
                () => { this.onRefresh(); },
            ).open();
        });

        const capsuleRow = section.createDiv('sl-comments-capsule-row');
        for (const comment of comments) {
            renderCommentCapsule(
                capsuleRow,
                comment.title,
                comment.status,
                comment.filePath,
                (filePath: string) => {
                    this.plugin.activateView('story-line-comments');
                    const leaves = this.plugin.app.workspace.getLeavesOfType('story-line-comments');
                    for (const leaf of leaves) {
                        const view = leaf.view as unknown as { selectComment?: (path: string) => void };
                        if (view && typeof view.selectComment === 'function') {
                            view.selectComment(filePath);
                            this.plugin.app.workspace.revealLeaf(leaf);
                            break;
                        }
                    }
                },
            );
        }
    }
}
/* eslint-enable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unused-vars -- end of file-wide suppression block opened at line 1 */
