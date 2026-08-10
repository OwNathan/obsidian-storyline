/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon, Menu, Notice } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { DNPhase, DNEntityType, DNLinkedCommentTarget, DNArcVariantQuestList } from '../models/types';
import { deriveShortDesc, resolveWikilinkPath, debounce } from '../models/types';
import type { Scenario, ScenarioPhase } from '../models/Scenario';
import type { ObjectiveVariant, ObjectiveVariantPhase } from '../models/Objective';
import type { ArcVariant } from '../models/Arc';
import { DNCreateModal, TypeChoice } from './DNCreateModal';
import { DNEntitySelectModal } from './DNEntitySelectModal';
import { renderDNLinkedComment } from './DNLinkedComment';

type KanbanEntityType = 'scenario' | 'objective-variant' | 'arc-variant';
type PhaseContentField = 'description' | 'startConditions' | 'startCommands' | 'endConditions' | 'endCommands';

interface CardData {
    path: string;
    title: string;
    category: string;
    typeRef?: string;
    isPrimary: boolean;
    mandatory: boolean;
    index: number;
    comment?: string;
    commentTarget: DNLinkedCommentTarget;
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
        const prevScrollTop = this.getSidebarScrollTop();
        const searchFocus = this.getSidebarSearchFocus();
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

        this.restoreSidebarState(prevScrollTop, searchFocus);
    }

    destroy(): void {
        this.containerEl.empty();
        this.containerEl.removeClass('dn-kanban');
    }

    private getSidebarScrollTop(): number {
        const list = this.containerEl.querySelector('.dn-sidebar-list');
        return list ? list.scrollTop : 0;
    }

    private getSidebarSearchFocus(): { caret: number } | null {
        const input = this.containerEl.querySelector('.dn-sidebar-search') as HTMLInputElement | null;
        if (input && document.activeElement === input) {
            return { caret: input.selectionStart ?? input.value.length };
        }
        return null;
    }

    private restoreSidebarState(prevScrollTop: number, searchFocus: { caret: number } | null): void {
        const list = this.containerEl.querySelector('.dn-sidebar-list');
        if (list) {
            if (prevScrollTop > 0) list.scrollTop = prevScrollTop;
            const selectedItem = list.querySelector('.dn-sidebar-item.is-selected') as HTMLElement | null;
            if (selectedItem) {
                const lr = list.getBoundingClientRect();
                const sr = selectedItem.getBoundingClientRect();
                if (sr.top < lr.top || sr.bottom > lr.bottom) {
                    selectedItem.scrollIntoView({ block: 'nearest' });
                }
            }
        }
        if (searchFocus) {
            const input = this.containerEl.querySelector('.dn-sidebar-search') as HTMLInputElement | null;
            if (input) {
                input.focus();
                input.setSelectionRange(searchFocus.caret, searchFocus.caret);
            }
        }
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
        const debouncedRender = debounce(() => this.render(), 100);
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
            const category = this.getEntityCategory(entity);
            if (category) {
                item.createSpan('dn-sidebar-item-cat').setText(category);
            }

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
            const category = this.getEntityCategory(entity);
            if (category) {
                headerEl.createSpan('dn-kanban-header-cat').setText(category);
            }
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

        if (entity.type === 'arc-variant') {
            this.renderArcVariantBoard(board, entity);
            return;
        }

        const columnsContainer = board.createDiv('dn-phase-stack');
        const phases = this.getOrderedPhasesForEntity(entity);

        for (const phase of phases) {
            this.renderPhasePanel(columnsContainer, entity, phase);
        }
    }

    private getOrderedPhasesForEntity(entity: Scenario | ObjectiveVariant | ArcVariant): DNPhase[] {
        return this.manager.getOrderedPhasesForEntity(entity);
    }

    private isVariantEntity(entity: Scenario | ObjectiveVariant | ArcVariant): boolean {
        return entity.type === 'objective-variant' || entity.type === 'arc-variant';
    }

    private getDisplayedPhaseValue(
        entity: Scenario | ObjectiveVariant | ArcVariant,
        phase: DNPhase,
        fieldName: PhaseContentField,
    ): string {
        if (this.isVariantEntity(entity) && !phase.overrides.includes(fieldName)) return '';
        return phase[fieldName] || '';
    }

    private renderPhaseField(container: HTMLElement, label: string, value: string): void {
        if (!value) return;
        const field = container.createDiv('dn-phase-field-block');
        field.createDiv('dn-phase-field-label').setText(label);
        field.createDiv('dn-phase-field-value').setText(value);
    }

    private renderPhaseContentColumn(
        container: HTMLElement,
        entity: Scenario | ObjectiveVariant | ArcVariant,
        phase: DNPhase,
        title: string,
        fields: Array<{ label: string; name: PhaseContentField }>,
    ): void {
        const column = container.createDiv('dn-phase-content-column');
        column.createDiv('dn-phase-column-title').setText(title);

        let rendered = false;
        for (const field of fields) {
            const value = this.getDisplayedPhaseValue(entity, phase, field.name);
            if (!value) continue;
            this.renderPhaseField(column, field.label, value);
            rendered = true;
        }

        if (this.isVariantEntity(entity) && title === 'Conditions' && !rendered && phase.overrides.length === 0) {
            column.createDiv('dn-no-overrides-placeholder').setText('No overrides - values inherited from type');
        }
    }

    private renderArcVariantBoard(board: HTMLElement, entity: ArcVariant): void {
        const overrides = board.createDiv('dn-arc-variant-overrides');
        overrides.createDiv('dn-arc-variant-section-title').setText('Overrides');
        this.renderArcVariantOverrideField(
            overrides,
            entity,
            'Conditions Override',
            'conditionsOverride',
            entity.conditionsOverride,
        );
        this.renderArcVariantOverrideField(
            overrides,
            entity,
            'Commands Override',
            'commandsOverride',
            entity.commandsOverride,
        );

        const rows: Array<Array<{ label: string; category: string; listKey: DNArcVariantQuestList }>> = [
            [
                { label: 'Goals', category: 'Goal', listKey: 'linkedGoals' },
                { label: 'Limits', category: 'Limit', listKey: 'linkedLimits' },
            ],
            [
                { label: 'Events', category: 'Event', listKey: 'linkedEvents' },
                { label: 'Modifiers', category: 'Modifier', listKey: 'linkedModifiers' },
            ],
        ];

        for (const row of rows) {
            const rowEl = board.createDiv('dn-arc-variant-quest-row');
            for (const group of row) {
                this.renderArcVariantQuestGroup(rowEl, entity, group.label, group.category, group.listKey);
            }
        }
    }

    private renderArcVariantOverrideField(
        container: HTMLElement,
        entity: ArcVariant,
        label: string,
        fieldName: 'conditionsOverride' | 'commandsOverride',
        value: string,
    ): void {
        const field = container.createDiv('dn-arc-variant-override-field');
        field.createEl('label', { text: label, cls: 'dn-arc-variant-field-label' });
        const input = field.createEl('textarea', { cls: 'dn-arc-variant-field-input' });
        input.value = value;
        input.addEventListener('change', async () => {
            await this.manager.updateArcVariant(entity.filePath, {
                [fieldName]: input.value,
            } as Partial<ArcVariant>);
        });
    }

    private renderArcVariantQuestGroup(
        container: HTMLElement,
        entity: ArcVariant,
        label: string,
        category: string,
        listKey: DNArcVariantQuestList,
    ): void {
        const group = container.createDiv('dn-arc-variant-quest-group');
        const header = group.createDiv('dn-arc-variant-quest-group-header');
        const title = header.createDiv('dn-arc-variant-quest-group-title');
        title.createSpan().setText(label);

        const questCards = this.getArcVariantQuestCards(entity, listKey);
        title.createSpan('dn-arc-variant-quest-group-count').setText(`(${questCards.length})`);

        const actions = header.createDiv('dn-arc-variant-quest-group-actions');
        const addBtn = actions.createEl('button', {
            cls: 'dn-column-add-btn',
            attr: { type: 'button', 'aria-label': `Create ${category} quest` },
        });
        setIcon(addBtn, 'plus');
        addBtn.addEventListener('click', () => this.openArcVariantCreateModal(entity.filePath, category));

        const linkBtn = actions.createEl('button', {
            cls: 'dn-column-link-btn',
            attr: { type: 'button', 'aria-label': `Add existing ${category} quest` },
        });
        setIcon(linkBtn, 'link');
        linkBtn.addEventListener('click', () => this.openArcVariantEntitySelectModal(entity.filePath, category));

        const body = group.createDiv('dn-arc-variant-quest-group-body');
        if (questCards.length === 0) {
            body.createDiv('dn-arc-variant-empty').setText(`No ${label.toLowerCase()} linked.`);
        } else {
            for (const card of questCards) {
                this.renderArcVariantQuestCard(body, card, entity);
            }
        }
    }

    private getArcVariantQuestCards(entity: ArcVariant, listKey: DNArcVariantQuestList): CardData[] {
        const cards: CardData[] = [];
        const links = entity[listKey];
        const quests = this.manager.getAllQuests();
        for (let index = 0; index < links.length; index++) {
            const link = links[index];
            const resolvedPath = resolveWikilinkPath(link.id);
            const quest = quests.find(item => item.filePath === resolvedPath);
            if (!quest) continue;
            cards.push({
                path: quest.filePath,
                title: quest.title,
                category: quest.category,
                isPrimary: true,
                mandatory: false,
                index,
                comment: link.comment,
                commentTarget: { kind: 'arc-variant', listKey, index },
            });
        }
        return cards;
    }

    private renderArcVariantQuestCard(container: HTMLElement, card: CardData, parentEntity: ArcVariant): void {
        const cardEl = container.createDiv('dn-card dn-arc-variant-quest-card');
        const titleRow = cardEl.createDiv('dn-card-title-row');
        titleRow.createDiv('dn-card-title').setText(card.title);

        renderDNLinkedComment(
            cardEl,
            titleRow,
            this.plugin.app,
            card.comment,
            async (comment) => {
                await this.manager.updateLinkedComment(parentEntity.filePath, card.commentTarget, comment);
                this.render();
            },
        );

        const metaEl = cardEl.createDiv('dn-card-meta');
        if (card.category) {
            metaEl.createSpan('dn-card-category').setText(card.category);
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
            menu.addItem(item => {
                item.setTitle('Unlink from arc variant');
                item.setIcon('unlink');
                item.onClick(async () => {
                    await this.manager.unlinkQuestFromArcVariant(parentEntity.filePath, card.path);
                    this.render();
                });
            });
            menu.showAtMouseEvent(e);
        });
    }

    private getEntityCategory(entity: Scenario | ObjectiveVariant | ArcVariant): string {
        return entity.type === 'arc-variant' ? '' : entity.category;
    }

    private renderEntityGroup(
        container: HTMLElement,
        label: string,
        cards: CardData[],
        parentEntity: Scenario | ObjectiveVariant | ArcVariant,
        phase: DNPhase,
        isPrimary: boolean,
    ): void {
        if (cards.length === 0) return;
        const group = container.createDiv('dn-phase-entity-group');
        const groupHeader = group.createDiv('dn-phase-entity-group-header');
        groupHeader.createSpan('dn-phase-entity-group-label').setText(label);
        groupHeader.createSpan('dn-phase-entity-group-count').setText(`(${cards.length})`);

        const groupBody = group.createDiv('dn-phase-group-body');
        groupBody.setAttribute('data-phase', phase.name);
        groupBody.setAttribute('data-parent', parentEntity.filePath);
        groupBody.setAttribute('data-priority', isPrimary ? 'primary' : 'secondary');

        for (const card of cards) {
            this.renderCard(groupBody, card, parentEntity, phase);
        }

        this.setupDropZone(groupBody, parentEntity, phase, isPrimary);
    }

    private renderLinkedEntities(
        container: HTMLElement,
        parentEntity: Scenario | ObjectiveVariant | ArcVariant,
        phase: DNPhase,
        childCards: CardData[],
    ): void {
        const column = container.createDiv('dn-phase-content-column dn-phase-entities-column');
        column.createDiv('dn-phase-column-title').setText('Linked entities');

        if (this.entityType === 'scenario' || this.entityType === 'objective-variant') {
            this.renderEntityGroup(
                column,
                'Primary',
                childCards.filter(card => card.isPrimary),
                parentEntity,
                phase,
                true,
            );
            this.renderEntityGroup(
                column,
                'Secondary',
                childCards.filter(card => !card.isPrimary),
                parentEntity,
                phase,
                false,
            );
            return;
        }

        const questGroups = [
            { category: 'Goal', label: 'Goals' },
            { category: 'Limit', label: 'Limits' },
            { category: 'Event', label: 'Events' },
            { category: 'Modifier', label: 'Modifiers' },
        ];
        for (const questGroup of questGroups) {
            this.renderEntityGroup(
                column,
                questGroup.label,
                childCards.filter(card => card.category === questGroup.category),
                parentEntity,
                phase,
                true,
            );
        }

        const knownCategories = new Set(questGroups.map(group => group.category));
        const otherCards = childCards.filter(card => !knownCategories.has(card.category));
        if (otherCards.length > 0) {
            this.renderEntityGroup(column, 'Other', otherCards, parentEntity, phase, true);
        }
    }

    private renderPhasePanel(
        container: HTMLElement,
        parentEntity: Scenario | ObjectiveVariant | ArcVariant,
        phase: DNPhase,
    ): void {
        const panel = container.createDiv('dn-phase-panel');
        if (!phase.isDefault) panel.addClass('dn-phase-panel-custom');

        const childCards = this.getChildCardsForPhase(parentEntity, phase);
        const header = panel.createDiv('dn-phase-panel-header');
        const titleRow = header.createDiv('dn-phase-panel-title-row');
        titleRow.createSpan('dn-phase-panel-title').setText(phase.name);
        titleRow.createSpan('dn-phase-panel-count').setText(`(${childCards.length})`);

        const addBtn = titleRow.createEl('button', { cls: 'dn-column-add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.setAttribute('aria-label', `Create ${this.getChildEntityType()} in ${phase.name}`);
        addBtn.addEventListener('click', () => this.openCreateModal(parentEntity.filePath, phase.name));

        const linkBtn = titleRow.createEl('button', { cls: 'dn-column-link-btn' });
        setIcon(linkBtn, 'link');
        linkBtn.setAttribute('aria-label', `Add existing ${this.getChildEntityType()} to ${phase.name}`);
        linkBtn.addEventListener('click', () => this.openEntitySelectModal(parentEntity.filePath, phase.name));

        const description = this.getDisplayedPhaseValue(parentEntity, phase, 'description');
        if (description) {
            header.createDiv('dn-phase-panel-description').setText(description);
        }

        const body = panel.createDiv('dn-phase-panel-body');
        this.renderPhaseContentColumn(body, parentEntity, phase, 'Conditions', [
            { label: 'Start Conditions', name: 'startConditions' },
            { label: 'End Conditions', name: 'endConditions' },
        ]);
        this.renderPhaseContentColumn(body, parentEntity, phase, 'Commands', [
            { label: 'Start Commands', name: 'startCommands' },
            { label: 'End Commands', name: 'endCommands' },
        ]);
        this.renderLinkedEntities(body, parentEntity, phase, childCards);

        this.setupPanelDropZone(panel, parentEntity, phase);
    }

    private getChildCardsForPhase(parentEntity: Scenario | ObjectiveVariant | ArcVariant, phase: DNPhase): CardData[] {
        const results: CardData[] = [];

        switch (this.entityType) {
            case 'scenario': {
                const sp = phase as ScenarioPhase;
                const linked = sp.linkedObjectives || [];
                for (let idx = 0; idx < linked.length; idx++) {
                    const link = linked[idx];
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
                            index: idx,
                            comment: link.comment,
                            commentTarget: { kind: 'phase', phaseName: phase.name, index: idx },
                        });
                    }
                }
                break;
            }
            case 'objective-variant': {
                const op = phase as ObjectiveVariantPhase;
                const linked = op.linkedArcs || [];
                for (let idx = 0; idx < linked.length; idx++) {
                    const link = linked[idx];
                    const resolvedPath = resolveWikilinkPath(link.id);
                    const arc = this.manager.getAllArcVariants().find(a => a.filePath === resolvedPath);
                    if (arc) {
                        const type = this.manager.getArcType(arc.arcTypeId);
                        results.push({
                            path: arc.filePath,
                            title: arc.title,
                            category: '',
                            typeRef: type ? type.title : undefined,
                            isPrimary: link.isPrimary,
                            mandatory: link.mandatory,
                            index: idx,
                            comment: link.comment,
                            commentTarget: { kind: 'phase', phaseName: phase.name, index: idx },
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
        cardEl.setAttribute('data-index', String(card.index));

        const titleRow = cardEl.createDiv('dn-card-title-row');
        const titleEl = titleRow.createDiv('dn-card-title');
        titleEl.setText(card.title);

        renderDNLinkedComment(
            cardEl,
            titleRow,
            this.plugin.app,
            card.comment,
            async (comment) => {
                await this.manager.updateLinkedComment(parentEntity.filePath, card.commentTarget, comment);
                this.render();
            },
        );

        const metaEl = cardEl.createDiv('dn-card-meta');
        if (card.typeRef) {
            const typeRefEl = metaEl.createSpan('dn-card-variant');
            typeRefEl.setText(this.entityType === 'objective-variant' ? card.typeRef : `Type: ${card.typeRef}`);
        }
        if (card.category && this.entityType !== 'objective-variant') {
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
                        await this.manager.toggleLinkPriority(parentEntity.filePath, card.path, phase.name, !card.isPrimary, card.index);
                        this.render();
                    });
                });
            }

            menu.addItem(item => {
                item.setTitle('Unlink from phase');
                item.setIcon('unlink');
                item.onClick(async () => {
                    await this.unlinkChildFromPhase(parentEntity.filePath, card.path, phase.name, card.index);
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
            e.dataTransfer?.setData('text/dn-card-index', String(card.index));
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
            const fromIndexStr = e.dataTransfer?.getData('text/dn-card-index');
            const parsedIndex = fromIndexStr ? Number.parseInt(fromIndexStr, 10) : Number.NaN;
            const fromIndex = Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : undefined;

            if (!childPath || !fromPhase || fromParent !== parentEntity.filePath) return;

            const phaseChanged = fromPhase !== targetPhase.name;
            const priorityChanged = fromPriority !== (targetIsPrimary ? 'primary' : 'secondary');

            if (!phaseChanged && !priorityChanged) return;

            let targetIndex = fromIndex;
            if (phaseChanged) {
                targetIndex = await this.manager.reassignPhase(parentEntity.filePath, childPath, fromPhase, targetPhase.name, fromIndex);
            }

            if (priorityChanged && (this.entityType === 'scenario' || this.entityType === 'objective-variant')) {
                await this.manager.toggleLinkPriority(parentEntity.filePath, childPath, targetPhase.name, targetIsPrimary, targetIndex);
            }

            this.render();
        });
    }

    private setupPanelDropZone(panelEl: HTMLElement, parentEntity: Scenario | ObjectiveVariant | ArcVariant, targetPhase: DNPhase): void {
        panelEl.addEventListener('dragover', (e: DragEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.dn-phase-group-body')) return;
            e.preventDefault();
            panelEl.addClass('dn-drop-target');
        });

        panelEl.addEventListener('dragleave', (e: DragEvent) => {
            if ((e.relatedTarget as HTMLElement)?.closest('.dn-phase-group-body')) return;
            panelEl.removeClass('dn-drop-target');
        });

        panelEl.addEventListener('drop', async (e: DragEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.dn-phase-group-body')) return;
            e.preventDefault();
            panelEl.removeClass('dn-drop-target');

            const childPath = e.dataTransfer?.getData('text/dn-card-path');
            const fromPhase = e.dataTransfer?.getData('text/dn-card-phase');
            const fromParent = e.dataTransfer?.getData('text/dn-card-parent');
            const fromPriority = e.dataTransfer?.getData('text/dn-card-priority') || 'primary';
            const fromIndexStr = e.dataTransfer?.getData('text/dn-card-index');
            const parsedIndex = fromIndexStr ? Number.parseInt(fromIndexStr, 10) : Number.NaN;
            const fromIndex = Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : undefined;

            if (!childPath || !fromPhase || fromParent !== parentEntity.filePath) return;

            const phaseChanged = fromPhase !== targetPhase.name;
            const priorityChanged = fromPriority !== 'primary';

            if (!phaseChanged && !priorityChanged) return;

            let targetIndex = fromIndex;
            if (phaseChanged) {
                targetIndex = await this.manager.reassignPhase(parentEntity.filePath, childPath, fromPhase, targetPhase.name, fromIndex);
            }

            if (priorityChanged && (this.entityType === 'scenario' || this.entityType === 'objective-variant')) {
                await this.manager.toggleLinkPriority(parentEntity.filePath, childPath, targetPhase.name, true, targetIndex);
            }

            this.render();
        });
    }

    private async unlinkChildFromPhase(parentPath: string, childPath: string, phaseName: string, index: number): Promise<void> {
        const parent = this.manager.getEntity(parentPath);
        if (!parent) return;

        switch (this.entityType) {
            case 'scenario': {
                await this.manager.unlinkLinkedChildFromPhase(parentPath, phaseName, index);
                break;
            }
            case 'objective-variant': {
                await this.manager.unlinkLinkedChildFromPhase(parentPath, phaseName, index);
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
                        await this.manager.createAndLinkArcVariant(parentPath, phaseName, typeId, { title, description });
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
            async (childPath, copies) => {
                let added = 0;
                for (let i = 0; i < copies; i++) {
                    let linked = false;
                    switch (this.entityType) {
                        case 'scenario':
                            linked = await this.manager.linkExistingObjectiveVariant(parentPath, phaseName, childPath);
                            break;
                        case 'objective-variant':
                            linked = await this.manager.linkExistingArcVariant(parentPath, phaseName, childPath);
                            break;
                    }
                    if (linked) added++;
                }
                this.render();
                return added;
            },
        );
        modal.open();
    }

    private openArcVariantCreateModal(parentPath: string, category: string): void {
        const categories = this.manager.getCategories('quest');
        const modal = new DNCreateModal(
            this.plugin,
            'quest',
            categories,
            async (title, selectedCategory, description) => {
                await this.manager.createAndLinkQuest(parentPath, selectedCategory, { title, description });
                this.render();
            },
            [],
            category,
        );
        modal.open();
    }

    private openArcVariantEntitySelectModal(parentPath: string, category: string): void {
        const modal = new DNEntitySelectModal(
            this.plugin.app,
            this.manager,
            'quest',
            async (childPath, copies) => {
                let added = 0;
                for (let i = 0; i < copies; i++) {
                    if (await this.manager.linkExistingQuest(parentPath, childPath)) added++;
                }
                this.render();
                return added;
            },
            category,
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
                        await this.manager.createArcVariant({ title, description, arcTypeId: typeId });
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
