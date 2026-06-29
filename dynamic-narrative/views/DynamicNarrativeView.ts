/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import { DYNAMIC_NARRATIVE_VIEW_TYPE } from '../../constants';
import { renderViewSwitcher } from '../../components/ViewSwitcher';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { DNEntity, DNEntityType } from '../models/types';
import { DN_INSPECTOR_MIN_WIDTH, DN_INSPECTOR_MAX_WIDTH } from '../models/types';
import { DNOverview } from '../components/DNOverview';
import { DNKanban } from '../components/DNKanban';
import { DNQuestGrid } from '../components/DNQuestGrid';
import { DNInspector } from '../components/DNInspector';

type DNTab = 'overview' | 'scenarios' | 'objectives' | 'arcs' | 'quests';

let _dnInspectorWidth = 350;

export class DynamicNarrativeView extends ItemView {
    plugin: SceneCardsPlugin;
    private manager: DynamicNarrativeManager;
    private activeTab: DNTab = 'overview';
    private selectedEntityPath: string = '';
    private inspectorEntityPath: string = '';

    private tabContainerEl: HTMLElement | null = null;
    private _contentEl: HTMLElement | null = null;
    private inspectorEl: HTMLElement | null = null;
    private resizeHandleEl: HTMLElement | null = null;

    private overview: DNOverview | null = null;
    private kanban: DNKanban | null = null;
    private questGrid: DNQuestGrid | null = null;
    private inspector: DNInspector | null = null;

    private _onMouseMove: ((e: MouseEvent) => void) | null = null;
    private _onMouseUp: (() => void) | null = null;
    private _onTouchMove: ((e: TouchEvent) => void) | null = null;
    private _onTouchEnd: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SceneCardsPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.manager = plugin.dynamicNarrativeManager;
    }

    getViewType(): string {
        return DYNAMIC_NARRATIVE_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Dynamic Narrative';
    }

    getIcon(): string {
        return 'git-branch';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('dn-view');

        // Toolbar
        const toolbar = container.createDiv('story-line-toolbar');
        const titleRow = toolbar.createDiv('story-line-title-row');
        titleRow.createEl('h3', { cls: 'story-line-view-title', text: 'StoryLine' });
        renderViewSwitcher(toolbar, DYNAMIC_NARRATIVE_VIEW_TYPE, this.plugin, this.leaf);

        this.tabContainerEl = container.createDiv('dn-tabs');
        this.renderTabs();

        const mainLayout = container.createDiv('dn-main-layout');
        this._contentEl = mainLayout.createDiv('dn-content');

        this.resizeHandleEl = mainLayout.createDiv('dn-resize-handle');

        this.inspectorEl = mainLayout.createDiv('dn-inspector');
        this.inspectorEl.style.width = `${_dnInspectorWidth}px`;
        this.inspectorEl.addClass('dn-inspector-hidden');

        this.setupResizeHandle();

        this.inspector = new DNInspector(this.inspectorEl, this.manager, this.plugin);

        this.switchTab(this.activeTab);
    }

    async onClose(): Promise<void> {
        this.overview?.destroy();
        this.kanban?.destroy();
        this.questGrid?.destroy();
        this.inspector?.destroy();
        this.removeResizeListeners();
    }

    async refresh(): Promise<void> {
        this.switchTab(this.activeTab);
        if (this.activeTab === 'quests') {
            this.inspectorEntityPath = '';
            return;
        }
        if (this.inspectorEntityPath) {
            const entity = this.manager.getEntity(this.inspectorEntityPath);
            if (entity) {
                this.inspector?.render(entity);
            } else {
                this.inspector?.clear();
                this.inspectorEntityPath = '';
            }
        }
    }

    private renderTabs(): void {
        if (!this.tabContainerEl) return;
        this.tabContainerEl.empty();

        const tabs: { id: DNTab; label: string; icon: string }[] = [
            { id: 'overview', label: 'Overview', icon: 'list' },
            { id: 'scenarios', label: 'Scenarios', icon: 'map' },
            { id: 'objectives', label: 'Objectives', icon: 'target' },
            { id: 'arcs', label: 'Arcs', icon: 'git-branch' },
            { id: 'quests', label: 'Quests', icon: 'sword' },
        ];

        for (const tab of tabs) {
            const tabEl = this.tabContainerEl.createDiv('dn-tab');
            tabEl.addClass(`dn-tab-${tab.id}`);
            if (tab.id === this.activeTab) tabEl.addClass('is-active');

            const iconEl = tabEl.createSpan('dn-tab-icon');
            setIcon(iconEl, tab.icon);

            tabEl.createSpan('dn-tab-label').setText(tab.label);

            tabEl.addEventListener('click', () => {
                this.switchTab(tab.id);
            });
        }
    }

    private switchTab(tab: DNTab): void {
        this.activeTab = tab;
        this.renderTabs();

        if (!this._contentEl) return;
        this._contentEl.empty();

        this.overview?.destroy();
        this.kanban?.destroy();
        this.questGrid?.destroy();
        this.overview = null;
        this.kanban = null;
        this.questGrid = null;

        switch (tab) {
            case 'overview':
                this.overview = new DNOverview(
                    this._contentEl,
                    this.manager,
                    this.plugin,
                    (path) => this.openInInspector(path),
                    (path, entityType) => this.navigateToKanban(path, entityType),
                );
                this.overview.render();
                break;
            case 'scenarios':
                this.kanban = new DNKanban(
                    this._contentEl,
                    this.manager,
                    this.plugin,
                    'scenario',
                    (path) => this.openInInspector(path),
                );
                this.kanban.render(this.selectedEntityPath);
                break;
            case 'objectives':
                this.kanban = new DNKanban(
                    this._contentEl,
                    this.manager,
                    this.plugin,
                    'objective',
                    (path) => this.openInInspector(path),
                );
                this.kanban.render(this.selectedEntityPath);
                break;
            case 'arcs':
                this.kanban = new DNKanban(
                    this._contentEl,
                    this.manager,
                    this.plugin,
                    'arc',
                    (path) => this.openInInspector(path),
                );
                this.kanban.render(this.selectedEntityPath);
                break;
            case 'quests':
                this.inspectorEl?.addClass('dn-inspector-hidden');
                this.questGrid = new DNQuestGrid(
                    this._contentEl,
                    this.manager,
                    this.plugin,
                    (path) => this.openInInspector(path),
                );
                this.questGrid.render();
                break;
        }
    }

    openInInspector(path: string): void {
        this.inspectorEntityPath = path;
        const entity = this.manager.getEntity(path);
        if (!entity || entity.type === 'quest') return;
        if (this.inspector) {
            this.inspector.render(entity);
            this.inspectorEl?.removeClass('dn-inspector-hidden');
        }
    }

    private navigateToKanban(path: string, entityType: DNEntityType): void {
        this.selectedEntityPath = path;
        switch (entityType) {
            case 'scenario':
                this.switchTab('scenarios');
                break;
            case 'objective':
                this.switchTab('objectives');
                break;
            case 'arc':
                this.switchTab('arcs');
                break;
            case 'quest':
                this.switchTab('quests');
                break;
        }
    }

    private setupResizeHandle(): void {
        if (!this.resizeHandleEl || !this.inspectorEl) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        const onStart = (clientX: number): void => {
            isResizing = true;
            startX = clientX;
            startWidth = this.inspectorEl!.offsetWidth;
            document.body.addClass('dn-resizing');
        };

        const onMove = (clientX: number): void => {
            if (!isResizing) return;
            const diff = startX - clientX;
            const newWidth = startWidth + diff;
            this.inspectorEl!.style.width = `${Math.max(DN_INSPECTOR_MIN_WIDTH, Math.min(DN_INSPECTOR_MAX_WIDTH, newWidth))}px`;
        };

        const onEnd = (): void => {
            if (!isResizing) return;
            isResizing = false;
            document.body.removeClass('dn-resizing');
            _dnInspectorWidth = this.inspectorEl!.offsetWidth;
        };

        this.resizeHandleEl.addEventListener('mousedown', (e: MouseEvent) => {
            onStart(e.clientX);
            e.preventDefault();
        });

        this.resizeHandleEl.addEventListener('touchstart', (e: TouchEvent) => {
            onStart(e.touches[0].clientX);
            e.preventDefault();
        });

        this._onMouseMove = (e: MouseEvent) => onMove(e.clientX);
        this._onMouseUp = () => onEnd();
        this._onTouchMove = (e: TouchEvent) => onMove(e.touches[0].clientX);
        this._onTouchEnd = () => onEnd();

        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);
        document.addEventListener('touchmove', this._onTouchMove);
        document.addEventListener('touchend', this._onTouchEnd);
    }

    private removeResizeListeners(): void {
        if (this._onMouseMove) {
            document.removeEventListener('mousemove', this._onMouseMove);
            this._onMouseMove = null;
        }
        if (this._onMouseUp) {
            document.removeEventListener('mouseup', this._onMouseUp);
            this._onMouseUp = null;
        }
        if (this._onTouchMove) {
            document.removeEventListener('touchmove', this._onTouchMove);
            this._onTouchMove = null;
        }
        if (this._onTouchEnd) {
            document.removeEventListener('touchend', this._onTouchEnd);
            this._onTouchEnd = null;
        }
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
