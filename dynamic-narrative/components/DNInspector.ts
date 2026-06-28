/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { DNEntity, DNPhase } from '../models/types';
import { isDefaultPhase } from '../models/types';
import type { Scenario, ScenarioPhase } from '../models/Scenario';
import type { Objective, ObjectivePhase } from '../models/Objective';
import type { Arc, ArcPhase } from '../models/Arc';
import type { Quest, QuestPhase } from '../models/Quest';
import { DNPhaseModal } from './DNPhaseModal';

export class DNInspector {
    private containerEl: HTMLElement;
    private manager: DynamicNarrativeManager;
    private plugin: SceneCardsPlugin;
    private currentEntity: DNEntity | null = null;
    private saveTimer: number | null = null;

    constructor(
        containerEl: HTMLElement,
        manager: DynamicNarrativeManager,
        plugin: SceneCardsPlugin,
    ) {
        this.containerEl = containerEl;
        this.manager = manager;
        this.plugin = plugin;
        this.containerEl.addClass('dn-inspector');
    }

    render(entity: DNEntity): void {
        this.currentEntity = entity;
        this.containerEl.empty();

        const header = this.containerEl.createDiv('dn-inspector-header');
        const typeBadge = header.createSpan('dn-inspector-type');
        typeBadge.setText(entity.type);
        header.createDiv('dn-inspector-title').setText(entity.title);

        const form = this.containerEl.createDiv('dn-inspector-form');

        this.renderTextField(form, 'Title', entity.title, async (val) => {
            await this.updateEntity({ title: val });
        });

        this.renderCategoryField(form, entity);

        if (entity.type === 'quest') {
            this.renderTextField(form, 'Quest Type', (entity as Quest).questType, async (val) => {
                await this.updateEntity({ questType: val });
            });
        }

        if (entity.type === 'scenario') {
            this.renderActsField(form, entity as Scenario);
        }

        if (entity.type === 'arc') {
            this.renderCheckboxField(form, 'Dynamic Locations', (entity as Arc).dynamicLocations, async (val) => {
                await this.updateEntity({ dynamicLocations: val });
            });
        }

        this.renderTextareaField(form, 'Description', entity.description, async (val) => {
            await this.updateEntity({ description: val });
        });

        if (entity.type !== 'quest') {
            this.renderWikilinkListField(form, 'Linked Locations', this.getLinkedLocations(entity), async (val) => {
                await this.updateEntity({ linkedLocations: val });
            });
            this.renderWikilinkListField(form, 'Linked Characters', this.getLinkedCharacters(entity), async (val) => {
                await this.updateEntity({ linkedCharacters: val });
            });
        }

        this.renderPhasesSection(form, entity);
    }

    clear(): void {
        this.currentEntity = null;
        this.containerEl.empty();
        this.containerEl.createDiv('dn-inspector-empty').setText('Select an entity to edit.');
    }

    destroy(): void {
        if (this.saveTimer) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
    }

    private renderCategoryField(container: HTMLElement, entity: DNEntity): void {
        const categories = this.manager.getCategories(entity.type);
        const field = container.createDiv('dn-field');
        field.createEl('label', { text: 'Category', cls: 'dn-field-label' });
        const select = field.createEl('select', { cls: 'dn-field-select' });

        const emptyOpt = select.createEl('option', { text: '— Select —' });
        emptyOpt.value = '';
        if (!entity.category) emptyOpt.selected = true;

        for (const cat of categories) {
            const opt = select.createEl('option', { text: cat });
            opt.value = cat;
            if (cat === entity.category) opt.selected = true;
        }

        select.addEventListener('change', async () => {
            await this.updateEntity({ category: select.value });
        });
    }

    private renderActsField(container: HTMLElement, scenario: Scenario): void {
        const field = container.createDiv('dn-field');
        field.createEl('label', { text: 'Linked Acts', cls: 'dn-field-label' });
        const input = field.createEl('input', {
            type: 'text',
            cls: 'dn-field-input',
            placeholder: 'Comma-separated act numbers (e.g. 1,2,3)',
        });
        input.value = scenario.linkedActs.join(', ');
        input.addEventListener('change', async () => {
            const acts = input.value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
            await this.updateEntity({ linkedActs: acts });
        });
    }

    private renderPhasesSection(container: HTMLElement, entity: DNEntity): void {
        const section = container.createDiv('dn-inspector-phases');
        section.createDiv('dn-section-title').setText('Phases');

        const phases = this.manager.getOrderedPhasesForEntity(entity);

        for (const phase of phases) {
            this.renderPhaseAccordion(section, entity, phase);
        }

        const addBtn = section.createEl('button', { cls: 'dn-add-phase-btn', text: '+ Add Custom Phase' });
        addBtn.addEventListener('click', () => {
            const modal = new DNPhaseModal(this.plugin.app, null, (phase) => {
                this.manager.addCustomPhase(entity, {
                    ...phase,
                    isDefault: false,
                });
                void (async () => {
                    await this.persistEntity();
                    this.render(entity);
                })();
            });
            modal.open();
        });
    }

    private renderPhaseAccordion(container: HTMLElement, entity: DNEntity, phase: DNPhase): void {
        const accordion = container.createDiv('dn-phase-accordion');
        if (!phase.isDefault) accordion.addClass('dn-phase-custom');

        const header = accordion.createDiv('dn-phase-header');
        const nameEl = header.createSpan('dn-phase-name');
        nameEl.setText(phase.name);

        if (phase.isDefault) {
            header.createSpan('dn-phase-default-badge').setText('default');
        }

        if (!phase.isDefault) {
            const deleteBtn = header.createEl('button', { cls: 'dn-phase-delete-btn' });
            setIcon(deleteBtn, 'trash-2');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                this.manager.removeCustomPhase(entity, phase.name);
                await this.persistEntity();
                this.render(entity);
            });
        }

        const toggle = header.createSpan('dn-phase-toggle');
        setIcon(toggle, 'chevron-down');

        const body = accordion.createDiv('dn-phase-body');

        if (!phase.isDefault) {
            this.renderPhaseField(body, 'Name', phase.name, async (val) => {
                this.manager.renameCustomPhase(entity, phase.name, val);
                await this.persistEntity();
            });
        }

        this.renderPhaseField(body, 'Description', phase.description, async (val) => {
            this.manager.updatePhaseFields(entity, phase.name, { description: val });
            await this.persistEntity();
        });

        this.renderPhaseField(body, 'Start Conditions', phase.startConditions, async (val) => {
            this.manager.updatePhaseFields(entity, phase.name, { startConditions: val });
            await this.persistEntity();
        });

        this.renderPhaseField(body, 'End Conditions', phase.endConditions, async (val) => {
            this.manager.updatePhaseFields(entity, phase.name, { endConditions: val });
            await this.persistEntity();
        });

        this.renderPhaseField(body, 'Start Commands', phase.startCommands, async (val) => {
            this.manager.updatePhaseFields(entity, phase.name, { startCommands: val });
            await this.persistEntity();
        });

        this.renderPhaseField(body, 'End Commands', phase.endCommands, async (val) => {
            this.manager.updatePhaseFields(entity, phase.name, { endCommands: val });
            await this.persistEntity();
        });

        let collapsed = false;
        header.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.dn-phase-delete-btn')) return;
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : '';
            toggle.empty();
            setIcon(toggle, collapsed ? 'chevron-right' : 'chevron-down');
        });
    }

    private renderPhaseField(container: HTMLElement, label: string, value: string, onChange: (val: string) => Promise<void>): void {
        const field = container.createDiv('dn-phase-field');
        field.createEl('label', { text: label, cls: 'dn-phase-field-label' });
        const input = field.createEl('textarea', { cls: 'dn-phase-field-input' });
        (input as HTMLTextAreaElement).value = value;
        input.addEventListener('change', () => {
            this.scheduleSave(async () => {
                await onChange((input as HTMLTextAreaElement).value);
            });
        });
    }

    private renderTextField(container: HTMLElement, label: string, value: string, onChange: (val: string) => Promise<void>): void {
        const field = container.createDiv('dn-field');
        field.createEl('label', { text: label, cls: 'dn-field-label' });
        const input = field.createEl('input', { type: 'text', cls: 'dn-field-input' });
        input.value = value;
        input.addEventListener('change', () => {
            this.scheduleSave(async () => {
                await onChange(input.value);
            });
        });
    }

    private renderTextareaField(container: HTMLElement, label: string, value: string, onChange: (val: string) => Promise<void>): void {
        const field = container.createDiv('dn-field');
        field.createEl('label', { text: label, cls: 'dn-field-label' });
        const input = field.createEl('textarea', { cls: 'dn-field-textarea' });
        (input as HTMLTextAreaElement).value = value;
        input.addEventListener('change', () => {
            this.scheduleSave(async () => {
                await onChange((input as HTMLTextAreaElement).value);
            });
        });
    }

    private renderCheckboxField(container: HTMLElement, label: string, value: boolean, onChange: (val: boolean) => Promise<void>): void {
        const field = container.createDiv('dn-field dn-field-checkbox');
        const input = field.createEl('input', { type: 'checkbox', cls: 'dn-field-checkbox-input' });
        (input as HTMLInputElement).checked = value;
        field.createEl('label', { text: label, cls: 'dn-field-label' });
        input.addEventListener('change', () => {
            this.scheduleSave(async () => {
                await onChange((input as HTMLInputElement).checked);
            });
        });
    }

    private renderWikilinkListField(container: HTMLElement, label: string, values: string[], onChange: (val: string[]) => Promise<void>): void {
        const field = container.createDiv('dn-field');
        field.createEl('label', { text: label, cls: 'dn-field-label' });
        const input = field.createEl('input', {
            type: 'text',
            cls: 'dn-field-input',
            placeholder: 'Comma-separated [[wikilinks]]',
        });
        input.value = values.join(', ');
        input.addEventListener('change', () => {
            this.scheduleSave(async () => {
                const parsed = input.value.split(',').map(s => s.trim()).filter(s => s.length > 0);
                await onChange(parsed);
            });
        });
    }

    private getLinkedLocations(entity: DNEntity): string[] {
        switch (entity.type) {
            case 'scenario': return (entity as Scenario).linkedLocations;
            case 'objective': return (entity as Objective).linkedLocations;
            case 'arc': return (entity as Arc).linkedLocations;
            default: return [];
        }
    }

    private getLinkedCharacters(entity: DNEntity): string[] {
        switch (entity.type) {
            case 'scenario': return (entity as Scenario).linkedCharacters;
            case 'objective': return (entity as Objective).linkedCharacters;
            default: return [];
        }
    }

    private async updateEntity(updates: Record<string, unknown>): Promise<void> {
        if (!this.currentEntity) return;
        switch (this.currentEntity.type) {
            case 'scenario':
                await this.manager.updateScenario(this.currentEntity.filePath, updates as Partial<Scenario>);
                break;
            case 'objective':
                await this.manager.updateObjective(this.currentEntity.filePath, updates as Partial<Objective>);
                break;
            case 'arc':
                await this.manager.updateArc(this.currentEntity.filePath, updates as Partial<Arc>);
                break;
            case 'quest':
                await this.manager.updateQuest(this.currentEntity.filePath, updates as Partial<Quest>);
                break;
        }
        const updated = this.manager.getEntity(this.currentEntity.filePath);
        if (updated) this.currentEntity = updated;
    }

    private async persistEntity(): Promise<void> {
        if (!this.currentEntity) return;
        await this.updateEntity({});
    }

    private scheduleSave(fn: () => Promise<void>): void {
        if (this.saveTimer) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            fn();
            this.saveTimer = null;
        }, 600);
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
