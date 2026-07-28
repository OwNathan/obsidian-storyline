/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { DNEntityType } from '../models/types';
import { debounce } from '../models/types';
import type { Scenario } from '../models/Scenario';
import type { ObjectiveType, ObjectiveVariant } from '../models/Objective';
import type { ArcType, ArcVariant } from '../models/Arc';
import type { Quest } from '../models/Quest';
import { DNCreateModal } from './DNCreateModal';

type SortKey = 'name' | 'created' | 'modified' | 'category';
type SortDir = 'asc' | 'desc';

type OverviewEntity = Scenario | ObjectiveType | ObjectiveVariant | ArcType | ArcVariant | Quest;

export class DNOverview {
    private containerEl: HTMLElement;
    private manager: DynamicNarrativeManager;
    private plugin: SceneCardsPlugin;
    private onOpenInspector: (path: string) => void;
    private onNavigateKanban: (path: string, type: DNEntityType) => void;

    private sortKey: SortKey = 'name';
    private sortDir: SortDir = 'asc';
    private filterText = '';
    private filterCategory = '';

    constructor(
        containerEl: HTMLElement,
        manager: DynamicNarrativeManager,
        plugin: SceneCardsPlugin,
        onOpenInspector: (path: string) => void,
        onNavigateKanban: (path: string, type: DNEntityType) => void,
    ) {
        this.containerEl = containerEl;
        this.manager = manager;
        this.plugin = plugin;
        this.onOpenInspector = onOpenInspector;
        this.onNavigateKanban = onNavigateKanban;
    }

    render(): void {
        this.containerEl.empty();
        this.containerEl.addClass('dn-overview');

        this.renderToolbar();

        const grid = this.containerEl.createDiv('dn-overview-grid');
        this.renderSection(grid, 'Scenarios', this.manager.getAllScenarios(), 'scenario');
        this.renderSection(grid, 'Objective Types', this.manager.getAllObjectiveTypes(), 'objective-type');
        this.renderSection(grid, 'Objective Variants', this.manager.getAllObjectiveVariants(), 'objective-variant');
        this.renderSection(grid, 'Arc Types', this.manager.getAllArcTypes(), 'arc-type');
        this.renderSection(grid, 'Arc Variants', this.manager.getAllArcVariants(), 'arc-variant');
        this.renderSection(grid, 'Quests', this.manager.getAllQuests(), 'quest');
    }

    destroy(): void {
        this.containerEl.empty();
        this.containerEl.removeClass('dn-overview');
    }

    private renderToolbar(): void {
        const toolbar = this.containerEl.createDiv('dn-overview-toolbar');

        const searchInput = toolbar.createEl('input', {
            type: 'text',
            placeholder: 'Search entities...',
            cls: 'dn-search-input',
        });
        searchInput.value = this.filterText;
        const debouncedRender = debounce(() => this.render(), 200);
        searchInput.addEventListener('input', () => {
            this.filterText = searchInput.value.toLowerCase();
            debouncedRender();
        });

        const sortSelect = toolbar.createEl('select', { cls: 'dn-sort-select' });
        for (const opt of [
            { value: 'name', label: 'Name' },
            { value: 'created', label: 'Created' },
            { value: 'modified', label: 'Modified' },
            { value: 'category', label: 'Category' },
        ]) {
            const option = sortSelect.createEl('option', { text: opt.label });
            option.value = opt.value;
            if (opt.value === this.sortKey) option.selected = true;
        }
        sortSelect.addEventListener('change', () => {
            this.sortKey = sortSelect.value as SortKey;
            this.render();
        });

        const dirBtn = toolbar.createEl('button', { cls: 'dn-sort-dir-btn' });
        setIcon(dirBtn, this.sortDir === 'asc' ? 'arrow-up' : 'arrow-down');
        dirBtn.addEventListener('click', () => {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
            this.render();
        });
    }

    private renderSection(parent: HTMLElement, title: string, entities: OverviewEntity[], entityType: DNEntityType): void {
        const section = parent.createDiv('dn-overview-section');
        const header = section.createDiv('dn-section-header');

        const toggle = header.createSpan('dn-section-toggle');
        setIcon(toggle, 'chevron-down');

        header.createSpan('dn-section-title').setText(`${title} (${entities.length})`);

        const createBtn = header.createEl('button', { cls: 'dn-create-btn' });
        setIcon(createBtn, 'plus');
        createBtn.setAttribute('aria-label', `Create ${entityType}`);
        createBtn.addEventListener('click', async () => {
            await this.createEntity(entityType);
        });

        const list = section.createDiv('dn-entity-list');

        const filtered = this.filterAndSort(entities);

        if (filtered.length === 0) {
            list.createDiv('dn-empty-state').setText(`No ${title.toLowerCase()} found.`);
            return;
        }

        for (const entity of filtered) {
            const item = list.createDiv('dn-entity-item');
            item.setAttribute('data-path', entity.filePath);

            const nameEl = item.createSpan('dn-entity-name');
            nameEl.setText(entity.title);

            const catEl = item.createSpan('dn-entity-category');
            catEl.setText(entity.category || '—');

            item.addEventListener('click', (e: MouseEvent) => {
                if (e.detail === 2) {
                    this.onNavigateKanban(entity.filePath, entityType);
                } else {
                    this.onOpenInspector(entity.filePath);
                }
            });
        }

        let collapsed = false;
        header.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.dn-create-btn')) return;
            collapsed = !collapsed;
            list.style.display = collapsed ? 'none' : '';
            toggle.empty();
            setIcon(toggle, collapsed ? 'chevron-right' : 'chevron-down');
        });
    }

    private filterAndSort(entities: OverviewEntity[]): OverviewEntity[] {
        let result = [...entities];

        if (this.filterText) {
            result = result.filter(e =>
                e.title.toLowerCase().includes(this.filterText) ||
                e.description.toLowerCase().includes(this.filterText) ||
                e.category.toLowerCase().includes(this.filterText)
            );
        }

        result.sort((a, b) => {
            let cmp = 0;
            switch (this.sortKey) {
                case 'name':
                    cmp = a.title.localeCompare(b.title);
                    break;
                case 'created':
                    cmp = (a.created || '').localeCompare(b.created || '');
                    break;
                case 'modified':
                    cmp = (a.modified || '').localeCompare(b.modified || '');
                    break;
                case 'category':
                    cmp = (a.category || '').localeCompare(b.category || '');
                    break;
            }
            return this.sortDir === 'asc' ? cmp : -cmp;
        });

        return result;
    }

    private async createEntity(entityType: DNEntityType): Promise<void> {
        const categories = this.manager.getCategories(entityType);

        if (entityType === 'objective-variant' || entityType === 'arc-variant') {
            const typeChoices = entityType === 'objective-variant'
                ? this.manager.getAllObjectiveTypes().map(t => ({ path: t.filePath, title: t.title }))
                : this.manager.getAllArcTypes().map(t => ({ path: t.filePath, title: t.title }));

            const modal = new DNCreateModal(
                this.plugin,
                entityType,
                categories,
                async (title, category, description, typeId) => {
                    if (entityType === 'objective-variant') {
                        await this.manager.createObjectiveVariant({ title, category, description, objectiveTypeId: typeId });
                    } else {
                        await this.manager.createArcVariant({ title, category, description, arcTypeId: typeId });
                    }
                    this.render();
                },
                typeChoices,
            );
            modal.open();
            return;
        }

        const modal = new DNCreateModal(
            this.plugin,
            entityType,
            categories,
            async (title, category, description, _typeId) => {
                switch (entityType) {
                    case 'scenario':
                        await this.manager.createScenario({ title, category, description });
                        break;
                    case 'objective-type':
                        await this.manager.createObjectiveType({ title, category, description });
                        break;
                    case 'arc-type':
                        await this.manager.createArcType({ title, category, description });
                        break;
                    case 'quest':
                        await this.manager.createQuest({ title, category, description });
                        break;
                }
                this.render();
            },
        );
        modal.open();
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
