/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon, Menu, Notice } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { DNPhase, DNLinkedChild, DNEntityType } from '../models/types';
import { getOrderedPhases, deriveShortDesc, resolveWikilinkPath, debounce } from '../models/types';
import type { Scenario, ScenarioPhase } from '../models/Scenario';
import type { ObjectiveVariant, ObjectiveVariantPhase } from '../models/Objective';
import type { ArcVariant, ArcVariantPhase } from '../models/Arc';
import type { Quest } from '../models/Quest';
import { DNCreateModal, TypeChoice } from './DNCreateModal';
import { DNEntitySelectModal } from './DNEntitySelectModal';

type KanbanEntityType = 'scenario' | 'objective-variant' | 'arc-variant';

interface CardData {
    path: string;
    title: string;
    category: string;
    typeRef?: string;
    questType?: string;
    isPrimary: boolean;
    mandatory: boolean;
}

export class DNKanban {
    private containerEl: HTMLElement;
    private manager: DynamicNarrativeManager;
    private plugin: SceneCardsPlugin;
    private entityType: KanbanEntityType;
    private onOpenInspector: (path: string) => void;

    private selectedPath: string = '';
    private sidebarSearchText = '';

    constructor(
        containerEl: HTMLElement,
        manager: DynamicNarrativeManager,
        plugin: SceneCardsPlugin,
        entityType: KanbanEntityType,
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
            board.createDiv('dn-empty-state').setText(`No ${this.getEntityLabel()}s found. Create one from the Overview tab.`);
        }
    }

    destroy(): void {
        this.containerEl.empty();
        this.containerEl.removeClass('dn-kanban');
    }

    private getEntityLabel(): string {
        switch (this.entityType) {
            case 'scenario': return 'Scenario';
            case 'objective-variant': return 'Objective Variant';
            case 'arc-variant': return 'Arc Variant';
        }
    }

    private getEntities(): Array<Scenario | ObjectiveVariant | ArcVariant> {
        switch (this.entityType) {
            case 'scenario': return this.manager.getAllScenarios();
            case 'objective-variant': return this.manager.getAllObjectiveVariants();
            case 'arc-variant': return this.manager.getAllArcVariants();
        }
    }

    // ─── Sidebar ─────────────────────────────────────────────────

    private renderSidebar(sidebar: HTMLElement): void {
        sidebar.empty();
        sidebar.addClass('dn-kanban-sidebar');

        const sidebarActions = sidebar.createDiv('dn-sidebar-actions');
        const createBtn = sidebarActions.createEl('button', {
            cls: 'dn-sidebar-create-btn',
            text: `+ New ${this.getEntityLabel()}`,
        });
        createBtn.addEventListener('click', () => this.openSidebarCreateModal());

        const searchInput = sidebar.createEl('input', {
            type: 'text',
            placeholder: `Filter ${this.getEntityLabel().toLowerCase()}s...`,
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
                this.onOpenInspector(entity.filePath);
                this.render();
            });
        }
    }

    // ─── Board ───────────────────────────────────────────────────

    private renderBoard(board: HTMLElement): void {
        board.empty();
        board.addClass('dn-kanban-board');

        const rawEntity = this.manager.getEntity(this.selectedPath);
        if (!rawEntity || rawEntity.type === 'quest' || rawEntity.type === 'objective-type' || rawEntity.type === 'arc-type') return;
        const entity = rawEntity as Scenario | ObjectiveVariant | ArcVariant;

        const showFull = this.plugin.settings.dnKanbanShowFullHeader;
        const headerEl = board.createDiv('dn-kanban-header');
        headerEl.createDiv('dn-kanban-header-name').setText(entity.title);
        if (showFull) {
            headerEl.createDiv('dn-kanban-header-desc').setText(deriveShortDesc(entity.description));
            const catBadge = headerEl.createSpan('dn-kanban-header-cat');
            catBadge.setText(entity.category || '');
            if (entity.type === 'objective-variant') {
                const type = this.manager.getObjectiveType(entity.objectiveTypeId);
                if (type) {
                    const typeBadge = headerEl.createSpan('dn-kanban-header-type');
                    typeBadge.setText(`Type: ${type.title}`);
                }
            } else if (entity.type === 'arc-variant') {
                const type = this.manager.getArcType(entity.arcTypeId);
                if (type) {
                    const typeBadge = headerEl.createSpan('dn-kanban-header-type');
                    typeBadge.setText(`Type: ${type.title}`);
                }
            }
        }

        const columnsContainer = board.createDiv('dn-kanban-columns');
        const phases = this.getOrderedPhasesForEntity(entity);

        for (const phase of phases) {
            this.renderColumn(columnsContainer, entity, phase);
        }
    }

    private getOrderedPhasesForEntity(entity: Scenario | ObjectiveVariant | ArcVariant): DNPhase[] {
        return this.manager.getOrderedPhasesForEntity(entity);
    }

    private getEffectivePhase(entity: Scenario | ObjectiveVariant | ArcVariant, phase: DNPhase): DNPhase {
        if (entity.type === 'objective-variant') {
            const type = this.manager.getObjectiveType(entity.objectiveTypeId);
            const tp = type?.phases.find(p => p.name === phase.name);
            if (!tp) return phase;
            const ov = phase.overrides;
            return {
                ...phase,
                description: ov.includes('description') ? phase.description : tp.description,
                startConditions: ov.includes('startConditions') ? phase.startConditions : tp.startConditions,
                startCommands: ov.includes('startCommands') ? phase.startCommands : tp.startCommands,
                endConditions: ov.includes('endConditions') ? phase.endConditions : tp.endConditions,
                endCommands: ov.includes('endCommands') ? phase.endCommands : tp.endCommands,
            };
        }
        if (entity.type === 'arc-variant') {
            const type = this.manager.getArcType(entity.arcTypeId);
            const tp = type?.phases.find(p => p.name === phase.name);
            if (!tp) return phase;
            const ov = phase.overrides;
            return {
                ...phase,
                description: ov.includes('description') ? phase.description : tp.description,
                startConditions: ov.includes('startConditions') ? phase.startConditions : tp.startConditions,
                startCommands: ov.includes('startCommands') ? phase.startCommands : tp.startCommands,
                endConditions: ov.includes('endConditions') ? phase.endConditions : tp.endConditions,
                endCommands: ov.includes('endCommands') ? phase.endCommands : tp.endCommands,
            };
        }
        return phase;
    }

    private renderCapsules(container: HTMLElement, phase: DNPhase, entity: Scenario | ObjectiveVariant | ArcVariant): void {
        const effective = this.getEffectivePhase(entity, phase);
        const hasRow1 = !!(effective.startConditions || effective.startCommands);
        const hasRow2 = !!(effective.endConditions || effective.endCommands);

        if (!hasRow1 && !hasRow2) return;

        const isVariant = entity.type === 'objective-variant' || entity.type === 'arc-variant';
        const ov = phase.overrides;

        const capsulesEl = container.createDiv('dn-phase-capsules');

        if (hasRow1) {
            const row1 = capsulesEl.createDiv('dn-capsule-row');
            if (effective.startConditions) {
                const cap = row1.createDiv('dn-phase-capsule');
                if (isVariant && ov.includes('startConditions')) cap.addClass('dn-capsule-overridden');
                cap.createSpan('dn-capsule-label').setText('Start:');
                cap.createSpan('dn-capsule-value').setText(effective.startConditions);
            }
            if (effective.startCommands) {
                const cap = row1.createDiv('dn-phase-capsule');
                if (isVariant && ov.includes('startCommands')) cap.addClass('dn-capsule-overridden');
                cap.createSpan('dn-capsule-label').setText('Do:');
                cap.createSpan('dn-capsule-value').setText(effective.startCommands);
            }
        }

        if (hasRow2) {
            const row2 = capsulesEl.createDiv('dn-capsule-row');
            if (effective.endConditions) {
                const cap = row2.createDiv('dn-phase-capsule');
                if (isVariant && ov.includes('endConditions')) cap.addClass('dn-capsule-overridden');
                cap.createSpan('dn-capsule-label').setText('End:');
                cap.createSpan('dn-capsule-value').setText(effective.endConditions);
            }
            if (effective.endCommands) {
                const cap = row2.createDiv('dn-phase-capsule');
                if (isVariant && ov.includes('endCommands')) cap.addClass('dn-capsule-overridden');
                cap.createSpan('dn-capsule-label').setText('Do:');
                cap.createSpan('dn-capsule-value').setText(effective.endCommands);
            }
        }
    }

    private renderColumn(container: HTMLElement, parentEntity: Scenario | ObjectiveVariant | ArcVariant, phase: DNPhase): void {
        const column = container.createDiv('dn-kanban-column');
        if (!phase.isDefault) column.addClass('dn-column-custom');

        const effectivePhase = this.getEffectivePhase(parentEntity, phase);

        const columnHeader = column.createDiv('dn-column-header');
        columnHeader.createSpan('dn-column-title').setText(phase.name);

        const childCards = this.getChildCardsForPhase(parentEntity, phase);

        const cardCount = columnHeader.createSpan('dn-column-count');
        cardCount.setText(`(${childCards.length})`);

        const addBtn = columnHeader.createEl('button', { cls: 'dn-column-add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.setAttribute('aria-label', `Create ${this.getChildEntityType()} in ${phase.name}`);
        addBtn.addEventListener('click', () => {
            this.openCreateModal(parentEntity.filePath, phase.name);
        });

        const linkBtn = columnHeader.createEl('button', { cls: 'dn-column-link-btn' });
        setIcon(linkBtn, 'link');
        linkBtn.setAttribute('aria-label', `Add existing ${this.getChildEntityType()} to ${phase.name}`);
        linkBtn.addEventListener('click', () => {
            this.openEntitySelectModal(parentEntity.filePath, phase.name);
        });

        if (effectivePhase.description) {
            const descEl = column.createDiv('dn-phase-desc');
            descEl.setText(effectivePhase.description);
            const isVariant = parentEntity.type === 'objective-variant' || parentEntity.type === 'arc-variant';
            if (isVariant && phase.overrides.includes('description')) {
                descEl.addClass('dn-phase-desc-overridden');
            }
        }

        this.renderCapsules(column, phase, parentEntity);

        const splitsPriority = this.entityType === 'scenario' || this.entityType === 'objective-variant';

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

            this.setupColumnHeaderDropZone(column, parentEntity, phase);
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

    private getChildCardsForPhase(parentEntity: Scenario | ObjectiveVariant | ArcVariant, phase: DNPhase): CardData[] {
        const results: CardData[] = [];

        switch (this.entityType) {
            case 'scenario': {
                const sp = phase as ScenarioPhase;
                for (const link of sp.linkedObjectives || []) {
                    const resolvedPath = resolveWikilinkPath(link.id);
                    const obj = this.manager.getAllObjectiveVariants().find(o => o.filePath === resolvedPath);
                    if (obj) {
                        const type = this.manager.getObjectiveType(obj.objectiveTypeId);
                        results.push({
                            path: obj.filePath,
                            title: obj.title,
                            category: obj.category,
                            typeRef: type ? type.title : undefined,
                            isPrimary: link.isPrimary,
                            mandatory: link.mandatory,
                        });
                    }
                }
                break;
            }
            case 'objective-variant': {
                const op = phase as ObjectiveVariantPhase;
                for (const link of op.linkedArcs || []) {
                    const resolvedPath = resolveWikilinkPath(link.id);
                    const arc = this.manager.getAllArcVariants().find(a => a.filePath === resolvedPath);
                    if (arc) {
                        const type = this.manager.getArcType(arc.arcTypeId);
                        results.push({
                            path: arc.filePath,
                            title: arc.title,
                            category: arc.category,
                            typeRef: type ? type.title : undefined,
                            isPrimary: link.isPrimary,
                            mandatory: link.mandatory,
                        });
                    }
                }
                break;
            }
            case 'arc-variant': {
                const ap = phase as ArcVariantPhase;
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
                            questType: quest.questType,
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
            case 'scenario': return 'objective-variant';
            case 'objective-variant': return 'arc-variant';
            case 'arc-variant': return 'quest';
        }
    }

    private getTypeChoices(): TypeChoice[] {
        if (this.entityType === 'scenario') {
            return this.manager.getAllObjectiveTypes().map(t => ({ path: t.filePath, title: t.title }));
        }
        if (this.entityType === 'objective-variant') {
            return this.manager.getAllArcTypes().map(t => ({ path: t.filePath, title: t.title }));
        }
        return [];
    }

    private renderCard(
        container: HTMLElement,
        card: CardData,
        parentEntity: Scenario | ObjectiveVariant | ArcVariant,
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
        if (card.typeRef) {
            const typeRefEl = metaEl.createSpan('dn-card-variant');
            typeRefEl.setText(`Type: ${card.typeRef}`);
        }
        if (card.questType) {
            const qtEl = metaEl.createSpan('dn-card-quest-type');
            qtEl.setText(card.questType);
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

            const splitsPriority = this.entityType === 'scenario' || this.entityType === 'objective-variant';
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

    private setupDropZone(columnBody: HTMLElement, parentEntity: Scenario | ObjectiveVariant | ArcVariant, targetPhase: DNPhase, targetIsPrimary: boolean): void {
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

            if (priorityChanged && (this.entityType === 'scenario' || this.entityType === 'objective-variant')) {
                await this.manager.toggleLinkPriority(parentEntity.filePath, childPath, targetPhase.name, targetIsPrimary);
            }

            this.render();
        });
    }

    private setupColumnHeaderDropZone(columnEl: HTMLElement, parentEntity: Scenario | ObjectiveVariant | ArcVariant, targetPhase: DNPhase): void {
        columnEl.addEventListener('dragover', (e: DragEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.dn-column-row-body')) return;
            e.preventDefault();
            columnEl.addClass('dn-drop-target');
        });

        columnEl.addEventListener('dragleave', (e: DragEvent) => {
            if ((e.relatedTarget as HTMLElement)?.closest('.dn-column-row-body')) return;
            columnEl.removeClass('dn-drop-target');
        });

        columnEl.addEventListener('drop', async (e: DragEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.dn-column-row-body')) return;
            e.preventDefault();
            columnEl.removeClass('dn-drop-target');

            const childPath = e.dataTransfer?.getData('text/dn-card-path');
            const fromPhase = e.dataTransfer?.getData('text/dn-card-phase');
            const fromParent = e.dataTransfer?.getData('text/dn-card-parent');
            const fromPriority = e.dataTransfer?.getData('text/dn-card-priority') || 'primary';

            if (!childPath || !fromPhase || fromParent !== parentEntity.filePath) return;

            const phaseChanged = fromPhase !== targetPhase.name;
            const priorityChanged = fromPriority !== 'primary';

            if (!phaseChanged && !priorityChanged) return;

            if (phaseChanged) {
                await this.manager.reassignPhase(parentEntity.filePath, childPath, fromPhase, targetPhase.name);
            }

            if (priorityChanged && (this.entityType === 'scenario' || this.entityType === 'objective-variant')) {
                await this.manager.toggleLinkPriority(parentEntity.filePath, childPath, targetPhase.name, true);
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
            case 'objective-variant': {
                const objective = parent as ObjectiveVariant;
                const phase = objective.phases.find(p => p.name === phaseName);
                if (phase) {
                    phase.linkedArcs = phase.linkedArcs.filter(c => resolveWikilinkPath(c.id) !== childPath);
                }
                await this.manager.updateObjectiveVariant(parentPath, { phases: objective.phases });
                break;
            }
            case 'arc-variant': {
                const arc = parent as ArcVariant;
                const phase = arc.phases.find(p => p.name === phaseName);
                if (phase) {
                    phase.linkedGoals = phase.linkedGoals.filter(l => resolveWikilinkPath(l) !== childPath);
                    phase.linkedLimits = phase.linkedLimits.filter(l => resolveWikilinkPath(l) !== childPath);
                    phase.linkedEvents = phase.linkedEvents.filter(l => resolveWikilinkPath(l) !== childPath);
                    phase.linkedModifiers = phase.linkedModifiers.filter(l => resolveWikilinkPath(l) !== childPath);
                }
                await this.manager.updateArcVariant(parentPath, { phases: arc.phases });
                break;
            }
        }
    }

    private openCreateModal(parentPath: string, phaseName: string): void {
        const childType = this.getChildEntityType();
        const categories = this.manager.getCategories(childType as DNEntityType);
        const typeChoices = this.getTypeChoices();

        const modal = new DNCreateModal(
            this.plugin,
            childType,
            categories,
            async (title, category, description, typeId) => {
                switch (this.entityType) {
                    case 'scenario':
                        await this.manager.createAndLinkObjectiveVariant(parentPath, phaseName, typeId, { title, category, description });
                        break;
                    case 'objective-variant':
                        await this.manager.createAndLinkArcVariant(parentPath, phaseName, typeId, { title, category, description });
                        break;
                    case 'arc-variant':
                        await this.manager.createAndLinkQuest(parentPath, phaseName, category, { title, description });
                        break;
                }
                this.render();
            },
            typeChoices,
        );
        modal.open();
    }

    private openEntitySelectModal(parentPath: string, phaseName: string): void {
        const childType = this.getChildEntityType() as 'objective-variant' | 'arc-variant' | 'quest';
        const modal = new DNEntitySelectModal(
            this.plugin.app,
            this.manager,
            childType,
            async (childPath) => {
                switch (this.entityType) {
                    case 'scenario':
                        await this.manager.linkExistingObjectiveVariant(parentPath, phaseName, childPath);
                        break;
                    case 'objective-variant':
                        await this.manager.linkExistingArcVariant(parentPath, phaseName, childPath);
                        break;
                    case 'arc-variant':
                        await this.manager.linkExistingQuest(parentPath, phaseName, childPath);
                        break;
                }
                this.render();
            },
        );
        modal.open();
    }

    private openSidebarCreateModal(): void {
        const categories = this.manager.getCategories(this.entityType as DNEntityType);
        let typeChoices: TypeChoice[] = [];

        if (this.entityType === 'objective-variant') {
            typeChoices = this.manager.getAllObjectiveTypes().map(t => ({ path: t.filePath, title: t.title }));
            if (typeChoices.length === 0) {
                new Notice('Create at least one Objective Type first.');
                return;
            }
        } else if (this.entityType === 'arc-variant') {
            typeChoices = this.manager.getAllArcTypes().map(t => ({ path: t.filePath, title: t.title }));
            if (typeChoices.length === 0) {
                new Notice('Create at least one Arc Type first.');
                return;
            }
        }

        const modal = new DNCreateModal(
            this.plugin,
            this.getEntityLabel(),
            categories,
            async (title, category, description, typeId) => {
                switch (this.entityType) {
                    case 'scenario':
                        await this.manager.createScenario({ title, category, description });
                        break;
                    case 'objective-variant':
                        await this.manager.createObjectiveVariant({ title, category, description, objectiveTypeId: typeId });
                        break;
                    case 'arc-variant':
                        await this.manager.createArcVariant({ title, category, description, arcTypeId: typeId });
                        break;
                }
                this.render();
            },
            typeChoices,
        );
        modal.open();
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
