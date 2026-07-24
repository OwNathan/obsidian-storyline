/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon, Menu } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { DNEntityType, DNPhase, DNLinkedChild } from '../models/types';
import { getOrderedPhases, deriveShortDesc, resolveWikilinkPath, debounce } from '../models/types';
import type { Scenario, ScenarioPhase } from '../models/Scenario';
import type { Objective, ObjectivePhase } from '../models/Objective';
import type { Arc, ArcPhase } from '../models/Arc';
import { DNCreateModal } from './DNCreateModal';

export class DNKanban {
    private containerEl: HTMLElement;
    private manager: DynamicNarrativeManager;
    private plugin: SceneCardsPlugin;
    private entityType: 'scenario' | 'objective' | 'arc';
    private onOpenInspector: (path: string) => void;

    private selectedPath: string = '';
    private sidebarSearchText = '';

    constructor(
        containerEl: HTMLElement,
        manager: DynamicNarrativeManager,
        plugin: SceneCardsPlugin,
        entityType: 'scenario' | 'objective' | 'arc',
        onOpenInspector: (path: string) => void,
    ) {
        this.containerEl = containerEl;
        this.manager = manager;
        this.plugin = plugin;
        this.entityType = entityType;
        this.onOpenInspector = onOpenInspector;
    }

    render(preselectedPath?: string): void {
        this.containerEl.empty();
        this.containerEl.addClass('dn-kanban');

        const layout = this.containerEl.createDiv('dn-kanban-layout');
        const sidebar = layout.createDiv('dn-kanban-sidebar');
        const board = layout.createDiv('dn-kanban-board');

        this.renderSidebar(sidebar);

        if (preselectedPath) {
            this.selectedPath = preselectedPath;
        } else if (!this.selectedPath) {
            const entities = this.getEntities();
            if (entities.length > 0) {
                this.selectedPath = entities[0].filePath;
            }
        }

        if (this.selectedPath) {
            this.renderBoard(board);
        } else {
            board.createDiv('dn-empty-state').setText(`No ${this.entityType}s found. Create one from the Overview tab.`);
        }
    }

    destroy(): void {
        this.containerEl.empty();
        this.containerEl.removeClass('dn-kanban');
    }

    private getEntities(): Array<Scenario | Objective | Arc> {
        switch (this.entityType) {
            case 'scenario': return this.manager.getAllScenarios();
            case 'objective': return this.manager.getAllObjectives();
            case 'arc': return this.manager.getAllArcs();
        }
    }

    private renderSidebar(sidebar: HTMLElement): void {
        sidebar.empty();
        sidebar.addClass('dn-kanban-sidebar');

        const searchInput = sidebar.createEl('input', {
            type: 'text',
            placeholder: `Filter ${this.entityType}s...`,
            cls: 'dn-sidebar-search',
        });
        searchInput.value = this.sidebarSearchText;
        const debouncedRender = debounce(() => this.render(), 200);
        searchInput.addEventListener('input', () => {
            this.sidebarSearchText = searchInput.value.toLowerCase();
            debouncedRender();
        });

        const list = sidebar.createDiv('dn-sidebar-list');
        const entities = this.getEntities();
        const filtered = this.sidebarSearchText
            ? entities.filter(e => e.title.toLowerCase().includes(this.sidebarSearchText))
            : entities;

        for (const entity of filtered) {
            const item = list.createDiv('dn-sidebar-item');
            if (entity.filePath === this.selectedPath) item.addClass('is-selected');

            item.createSpan('dn-sidebar-item-name').setText(entity.title);
            const catBadge = item.createSpan('dn-sidebar-item-cat');
            catBadge.setText(entity.category || '');

            item.addEventListener('click', () => {
                this.selectedPath = entity.filePath;
                this.render();
            });
        }
    }

    private renderBoard(board: HTMLElement): void {
        board.empty();
        board.addClass('dn-kanban-board');

        const rawEntity = this.manager.getEntity(this.selectedPath);
        if (!rawEntity || rawEntity.type === 'quest') return;
        const entity = rawEntity as Scenario | Objective | Arc;

        const showFull = this.plugin.settings.dnKanbanShowFullHeader;
        const headerEl = board.createDiv('dn-kanban-header');
        headerEl.createDiv('dn-kanban-header-name').setText(entity.title);
        if (showFull) {
            headerEl.createDiv('dn-kanban-header-desc').setText(deriveShortDesc(entity.description));
            const catBadge = headerEl.createSpan('dn-kanban-header-cat');
            catBadge.setText(entity.category || '');
        }

        const columnsContainer = board.createDiv('dn-kanban-columns');
        const phases = this.getOrderedPhasesForEntity(entity);

        for (const phase of phases) {
            this.renderColumn(columnsContainer, entity, phase);
        }
    }

    private getOrderedPhasesForEntity(entity: Scenario | Objective | Arc): DNPhase[] {
        return this.manager.getOrderedPhasesForEntity(entity);
    }

    private hasPhaseMetadata(phase: DNPhase): boolean {
        return !!(phase.description || phase.startConditions || phase.startCommands || phase.endConditions || phase.endCommands);
    }

    private renderCapsules(container: HTMLElement, phase: DNPhase): void {
        const hasRow1 = !!(phase.startConditions || phase.startCommands);
        const hasRow2 = !!(phase.endConditions || phase.endCommands);

        if (!hasRow1 && !hasRow2) return;

        const capsulesEl = container.createDiv('dn-phase-capsules');

        if (hasRow1) {
            const row1 = capsulesEl.createDiv('dn-capsule-row');
            if (phase.startConditions) {
                const cap = row1.createDiv('dn-phase-capsule');
                cap.createSpan('dn-capsule-label').setText('Start:');
                cap.createSpan('dn-capsule-value').setText(phase.startConditions);
            }
            if (phase.startCommands) {
                const cap = row1.createDiv('dn-phase-capsule');
                cap.createSpan('dn-capsule-label').setText('Do:');
                cap.createSpan('dn-capsule-value').setText(phase.startCommands);
            }
        }

        if (hasRow2) {
            const row2 = capsulesEl.createDiv('dn-capsule-row');
            if (phase.endConditions) {
                const cap = row2.createDiv('dn-phase-capsule');
                cap.createSpan('dn-capsule-label').setText('End:');
                cap.createSpan('dn-capsule-value').setText(phase.endConditions);
            }
            if (phase.endCommands) {
                const cap = row2.createDiv('dn-phase-capsule');
                cap.createSpan('dn-capsule-label').setText('Do:');
                cap.createSpan('dn-capsule-value').setText(phase.endCommands);
            }
        }
    }

    private renderColumn(container: HTMLElement, parentEntity: Scenario | Objective | Arc, phase: DNPhase): void {
        const column = container.createDiv('dn-kanban-column');
        if (!phase.isDefault) column.addClass('dn-column-custom');

        const columnHeader = column.createDiv('dn-column-header');
        columnHeader.createSpan('dn-column-title').setText(phase.name);

        const childCards = this.getChildCardsForPhase(parentEntity, phase);

        const cardCount = columnHeader.createSpan('dn-column-count');
        cardCount.setText(`(${childCards.length})`);

        const addBtn = columnHeader.createEl('button', { cls: 'dn-column-add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.setAttribute('aria-label', `Add ${this.getChildEntityType()} to ${phase.name}`);
        addBtn.addEventListener('click', () => {
            this.openCreateModal(parentEntity.filePath, phase.name);
        });

        if (phase.description) {
            const descEl = column.createDiv('dn-phase-desc');
            descEl.setText(phase.description);
        }

        this.renderCapsules(column, phase);

        const splitsPriority = this.entityType === 'scenario' || this.entityType === 'objective';

        if (splitsPriority) {
            const primaryCards = childCards.filter(c => c.isPrimary);
            const secondaryCards = childCards.filter(c => !c.isPrimary);

            const primaryRow = column.createDiv('dn-column-row');
            primaryRow.addClass('dn-row-primary');
            const primaryLabel = primaryRow.createDiv('dn-column-row-label');
            primaryLabel.setText(`Primary (${primaryCards.length})`);
            const primaryBody = primaryRow.createDiv('dn-column-row-body');
            primaryBody.setAttribute('data-phase', phase.name);
            primaryBody.setAttribute('data-parent', parentEntity.filePath);
            primaryBody.setAttribute('data-priority', 'primary');

            for (const card of primaryCards) {
                this.renderCard(primaryBody, card, parentEntity, phase);
            }

            this.setupDropZone(primaryBody, parentEntity, phase, true);

            const secondaryRow = column.createDiv('dn-column-row');
            secondaryRow.addClass('dn-row-secondary');
            const secondaryLabel = secondaryRow.createDiv('dn-column-row-label');
            secondaryLabel.setText(`Secondary (${secondaryCards.length})`);
            const secondaryBody = secondaryRow.createDiv('dn-column-row-body');
            secondaryBody.setAttribute('data-phase', phase.name);
            secondaryBody.setAttribute('data-parent', parentEntity.filePath);
            secondaryBody.setAttribute('data-priority', 'secondary');

            for (const card of secondaryCards) {
                this.renderCard(secondaryBody, card, parentEntity, phase);
            }

            this.setupDropZone(secondaryBody, parentEntity, phase, false);
        } else {
            const columnBody = column.createDiv('dn-column-row-body');
            columnBody.setAttribute('data-phase', phase.name);
            columnBody.setAttribute('data-parent', parentEntity.filePath);

            for (const card of childCards) {
                this.renderCard(columnBody, card, parentEntity, phase);
            }

            this.setupDropZone(columnBody, parentEntity, phase, true);
        }
    }

    private getChildCardsForPhase(parentEntity: Scenario | Objective | Arc, phase: DNPhase): Array<{ path: string; title: string; category: string; variant?: string; isPrimary: boolean; mandatory: boolean }> {
        const results: Array<{ path: string; title: string; category: string; variant?: string; isPrimary: boolean; mandatory: boolean }> = [];

        switch (this.entityType) {
            case 'scenario': {
                const sp = phase as ScenarioPhase;
                for (const link of sp.linkedObjectives || []) {
                    const resolvedPath = resolveWikilinkPath(link.id);
                    const obj = this.manager.getAllObjectives().find(o => o.filePath === resolvedPath);
                    if (obj) {
                        results.push({
                            path: obj.filePath,
                            title: obj.title,
                            category: obj.category,
                            variant: obj.variant,
                            isPrimary: link.isPrimary,
                            mandatory: link.mandatory,
                        });
                    }
                }
                break;
            }
            case 'objective': {
                const op = phase as ObjectivePhase;
                for (const link of op.linkedArcs || []) {
                    const resolvedPath = resolveWikilinkPath(link.id);
                    const arc = this.manager.getAllArcs().find(a => a.filePath === resolvedPath);
                    if (arc) {
                        results.push({
                            path: arc.filePath,
                            title: arc.title,
                            category: arc.category,
                            isPrimary: link.isPrimary,
                            mandatory: link.mandatory,
                        });
                    }
                }
                break;
            }
            case 'arc': {
                const ap = phase as ArcPhase;
                const allQuests = this.manager.getAllQuests();
                const allLinks = [
                    ...(ap.linkedGoals || []),
                    ...(ap.linkedLimits || []),
                    ...(ap.linkedEvents || []),
                    ...(ap.linkedModifiers || []),
                ];
                for (const wikilink of allLinks) {
                    const resolvedPath = resolveWikilinkPath(wikilink);
                    const quest = allQuests.find(q => q.filePath === resolvedPath);
                    if (quest) {
                        results.push({
                            path: quest.filePath,
                            title: quest.title,
                            category: quest.category,
                            isPrimary: true,
                            mandatory: false,
                        });
                    }
                }
                break;
            }
        }

        return results;
    }

    private getChildEntityType(): string {
        switch (this.entityType) {
            case 'scenario': return 'objective';
            case 'objective': return 'arc';
            case 'arc': return 'quest';
        }
    }

    private renderCard(
        container: HTMLElement,
        card: { path: string; title: string; category: string; variant?: string; isPrimary: boolean; mandatory: boolean },
        parentEntity: Scenario | Objective | Arc,
        phase: DNPhase,
    ): void {
        const cardEl = container.createDiv('dn-card');
        cardEl.setAttribute('draggable', 'true');
        cardEl.setAttribute('data-path', card.path);
        cardEl.setAttribute('data-phase', phase.name);
        cardEl.setAttribute('data-priority', card.isPrimary ? 'primary' : 'secondary');

        const titleEl = cardEl.createDiv('dn-card-title');
        titleEl.setText(card.title);

        const metaEl = cardEl.createDiv('dn-card-meta');
        if (card.variant) {
            const variantEl = metaEl.createSpan('dn-card-variant');
            variantEl.setText(card.variant);
        }
        if (card.category) {
            const catBadge = metaEl.createSpan('dn-card-category');
            catBadge.setText(card.category);
        }
        if (card.mandatory) {
            metaEl.createSpan('dn-card-badge-mandatory').setText('Mandatory');
        }

        cardEl.addEventListener('click', () => {
            this.onOpenInspector(card.path);
        });

        cardEl.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            const menu = new Menu();
            menu.addItem(item => {
                item.setTitle('Edit');
                item.setIcon('pencil');
                item.onClick(() => this.onOpenInspector(card.path));
            });

            const splitsPriority = this.entityType === 'scenario' || this.entityType === 'objective';
            if (splitsPriority) {
                const label = card.isPrimary ? 'Set as Secondary' : 'Set as Primary';
                menu.addItem(item => {
                    item.setTitle(label);
                    item.setIcon(card.isPrimary ? 'arrow-down' : 'arrow-up');
                    item.onClick(async () => {
                        await this.manager.toggleLinkPriority(parentEntity.filePath, card.path, phase.name, !card.isPrimary);
                        this.render();
                    });
                });
            }

            menu.addItem(item => {
                item.setTitle('Unlink from phase');
                item.setIcon('unlink');
                item.onClick(async () => {
                    await this.unlinkChildFromPhase(parentEntity.filePath, card.path, phase.name);
                    this.render();
                });
            });
            menu.showAtMouseEvent(e);
        });

        cardEl.addEventListener('dragstart', (e: DragEvent) => {
            e.dataTransfer?.setData('text/dn-card-path', card.path);
            e.dataTransfer?.setData('text/dn-card-phase', phase.name);
            e.dataTransfer?.setData('text/dn-card-parent', parentEntity.filePath);
            e.dataTransfer?.setData('text/dn-card-priority', card.isPrimary ? 'primary' : 'secondary');
            cardEl.addClass('dn-card-dragging');
        });

        cardEl.addEventListener('dragend', () => {
            cardEl.removeClass('dn-card-dragging');
        });
    }

    private setupDropZone(columnBody: HTMLElement, parentEntity: Scenario | Objective | Arc, targetPhase: DNPhase, targetIsPrimary: boolean): void {
        columnBody.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            columnBody.addClass('dn-drop-target');
        });

        columnBody.addEventListener('dragleave', () => {
            columnBody.removeClass('dn-drop-target');
        });

        columnBody.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            columnBody.removeClass('dn-drop-target');

            const childPath = e.dataTransfer?.getData('text/dn-card-path');
            const fromPhase = e.dataTransfer?.getData('text/dn-card-phase');
            const fromParent = e.dataTransfer?.getData('text/dn-card-parent');
            const fromPriority = e.dataTransfer?.getData('text/dn-card-priority') || 'primary';

            if (!childPath || !fromPhase || fromParent !== parentEntity.filePath) return;

            const phaseChanged = fromPhase !== targetPhase.name;
            const priorityChanged = fromPriority !== (targetIsPrimary ? 'primary' : 'secondary');

            if (!phaseChanged && !priorityChanged) return;

            if (phaseChanged) {
                await this.manager.reassignPhase(parentEntity.filePath, childPath, fromPhase, targetPhase.name);
            }

            if (priorityChanged && (this.entityType === 'scenario' || this.entityType === 'objective')) {
                await this.manager.toggleLinkPriority(parentEntity.filePath, childPath, targetPhase.name, targetIsPrimary);
            }

            this.render();
        });
    }

    private async unlinkChildFromPhase(parentPath: string, childPath: string, phaseName: string): Promise<void> {
        const parent = this.manager.getEntity(parentPath);
        if (!parent) return;

        const wikilink = `[[${childPath}]]`;

        switch (this.entityType) {
            case 'scenario': {
                const scenario = parent as Scenario;
                const phase = scenario.phases.find(p => p.name === phaseName);
                if (phase) {
                    phase.linkedObjectives = phase.linkedObjectives.filter(c => resolveWikilinkPath(c.id) !== childPath);
                }
                await this.manager.updateScenario(parentPath, { phases: scenario.phases });
                break;
            }
            case 'objective': {
                const objective = parent as Objective;
                const phase = objective.phases.find(p => p.name === phaseName);
                if (phase) {
                    phase.linkedArcs = phase.linkedArcs.filter(c => resolveWikilinkPath(c.id) !== childPath);
                }
                await this.manager.updateObjective(parentPath, { phases: objective.phases });
                break;
            }
            case 'arc': {
                const arc = parent as Arc;
                const phase = arc.phases.find(p => p.name === phaseName);
                if (phase) {
                    phase.linkedGoals = phase.linkedGoals.filter(l => resolveWikilinkPath(l) !== childPath);
                    phase.linkedLimits = phase.linkedLimits.filter(l => resolveWikilinkPath(l) !== childPath);
                    phase.linkedEvents = phase.linkedEvents.filter(l => resolveWikilinkPath(l) !== childPath);
                    phase.linkedModifiers = phase.linkedModifiers.filter(l => resolveWikilinkPath(l) !== childPath);
                }
                await this.manager.updateArc(parentPath, { phases: arc.phases });
                break;
            }
        }
    }

    private openCreateModal(parentPath: string, phaseName: string): void {
        const childType = this.getChildEntityType();
        const categories = this.manager.getCategories(childType as DNEntityType);

        const modal = new DNCreateModal(
            this.plugin,
            childType,
            categories,
            async (title, category, description) => {
                switch (this.entityType) {
                    case 'scenario':
                        await this.manager.createAndLinkObjective(parentPath, phaseName, { title, category, description });
                        break;
                    case 'objective':
                        await this.manager.createAndLinkArc(parentPath, phaseName, { title, category, description });
                        break;
                    case 'arc':
                        await this.manager.createAndLinkQuest(parentPath, phaseName, category, { title, description });
                        break;
                }
                this.render();
            },
        );
        modal.open();
    }

    // resolveWikilinkPath is imported from models/types.ts
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
