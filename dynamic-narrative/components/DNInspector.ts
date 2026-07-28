/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
import { setIcon, Notice, TFile } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';
import type { DNEntity, DNPhase } from '../models/types';
import { isDefaultPhase } from '../models/types';
import type { Scenario, ScenarioPhase } from '../models/Scenario';
import type { ObjectiveType, ObjectiveVariant, ObjectiveVariantPhase } from '../models/Objective';
import type { ArcType, ArcVariant, ArcVariantPhase } from '../models/Arc';
import type { Quest, QuestPhase } from '../models/Quest';
import { DNPhaseModal } from './DNPhaseModal';
import { renderTagPillInput } from '../../components/InlineSuggest';
import { openConfirmModal } from '../../components/ConfirmModal';
import { attachTooltip } from '../../components/Tooltip';

function unwrapWikilink(v: string): string {
    return v.replace(/^\[\[/, '').replace(/\]\]$/, '');
}
function wrapWikilink(v: string): string {
    return v.startsWith('[[') ? v : `[[${v}]]`;
}

export class DNInspector {
    private containerEl: HTMLElement;
    private manager: DynamicNarrativeManager;
    private plugin: SceneCardsPlugin;
    private currentEntity: DNEntity | null = null;
    private saveTimer: number | null = null;
    private onChangeCallback: (() => void) | null = null;

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
        const headerLeft = header.createDiv('dn-inspector-header-left');
        const typeBadge = headerLeft.createSpan('dn-inspector-type');
        typeBadge.setText(entity.type.replace(/-/g, ' '));
        headerLeft.createDiv('dn-inspector-title').setText(entity.title);

        const headerActions = header.createDiv('dn-inspector-header-actions');
        const openBtn = headerActions.createEl('button', {
            cls: 'codex-detail-action-btn',
            attr: { 'aria-label': 'Open file' },
        });
        setIcon(openBtn.createSpan(), 'file');
        attachTooltip(openBtn, 'Open file');
        openBtn.addEventListener('click', () => this.openEntityFile(entity));

        const deleteBtn = headerActions.createEl('button', {
            cls: 'codex-detail-action-btn codex-detail-delete-btn',
            attr: { 'aria-label': 'Delete' },
        });
        setIcon(deleteBtn.createSpan(), 'trash');
        attachTooltip(deleteBtn, 'Delete');
        deleteBtn.addEventListener('click', () => this.confirmDeleteEntity(entity));

        const form = this.containerEl.createDiv('dn-inspector-form');

        this.renderTextField(form, 'Title', entity.title, async (val) => {
            await this.updateEntity({ title: val });
        });

        this.renderCategoryField(form, entity);

        if (entity.type === 'objective-variant') {
            this.renderTypeRefField(form, entity as ObjectiveVariant, 'objective-type');
        } else if (entity.type === 'arc-variant') {
            this.renderTypeRefField(form, entity as ArcVariant, 'arc-type');
        }

        if (entity.type === 'quest') {
            this.renderTextField(form, 'Quest Type', (entity as Quest).questType, async (val) => {
                await this.updateEntity({ questType: val });
            });
        }

        if (entity.type === 'scenario') {
            this.renderActsField(form, entity as Scenario);
        }

        if (entity.type === 'arc-variant') {
            this.renderCheckboxField(form, 'Dynamic Locations', (entity as ArcVariant).dynamicLocations, async (val) => {
                await this.updateEntity({ dynamicLocations: val });
            });
        }

        this.renderTextareaField(form, 'Description', entity.description, async (val) => {
            await this.updateEntity({ description: val });
        });

        if (entity.type === 'scenario' || entity.type === 'objective-variant' || entity.type === 'arc-variant') {
            this.renderLinkedEntitiesField(form, 'Linked Locations', this.getLinkedLocations(entity),
                () => this.plugin.locationManager?.getAllLocations().map(l => l.name) ?? [],
                async (val) => { await this.updateEntity({ linkedLocations: val }); },
                'Add location...',
            );
        }
        if (entity.type === 'scenario' || entity.type === 'objective-variant') {
            this.renderLinkedEntitiesField(form, 'Linked Characters', this.getLinkedCharacters(entity),
                () => this.plugin.characterManager?.getAllCharacters().map(c => c.name) ?? [],
                async (val) => { await this.updateEntity({ linkedCharacters: val }); },
                'Add character...',
            );
        }

        this.renderPhasesSection(form, entity);
    }

    setOnChange(callback: () => void): void {
        this.onChangeCallback = callback;
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

    private renderTypeRefField(container: HTMLElement, variant: ObjectiveVariant | ArcVariant, label: string): void {
        const options = label === 'objective-type'
            ? this.manager.getAllObjectiveTypes()
            : this.manager.getAllArcTypes();

        const field = container.createDiv('dn-field');
        field.createEl('label', { text: 'Type', cls: 'dn-field-label' });

        if (options.length === 0) {
            field.createDiv('dn-field-note').setText('No types available. Create one first.');
            return;
        }

        const select = field.createEl('select', { cls: 'dn-field-select' });
        const emptyOpt = select.createEl('option', { text: '— Select —' });
        emptyOpt.value = '';

        const currentTypeId = variant.type === 'objective-variant'
            ? (variant as ObjectiveVariant).objectiveTypeId
            : (variant as ArcVariant).arcTypeId;

        for (const t of options) {
            const opt = select.createEl('option', { text: t.title });
            opt.value = t.filePath;
            if (t.filePath === currentTypeId) opt.selected = true;
        }

        select.addEventListener('change', async () => {
            const key = variant.type === 'objective-variant' ? 'objectiveTypeId' : 'arcTypeId';
            await this.updateEntity({ [key]: select.value });
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
            const nameField = body.createDiv('dn-phase-field');
            nameField.createEl('label', { text: 'Name', cls: 'dn-phase-field-label' });
            const nameInput = nameField.createEl('input', { type: 'text', cls: 'dn-phase-field-input' });
            nameInput.value = phase.name;
            nameInput.addEventListener('change', () => {
                this.scheduleSave(async () => {
                    this.manager.renameCustomPhase(entity, phase.name, nameInput.value);
                    await this.persistEntity();
                });
            });
        }

        const isVariant = entity.type === 'objective-variant' || entity.type === 'arc-variant';

        if (isVariant) {
            const variant = entity as ObjectiveVariant | ArcVariant;
            this.renderVariantOverrideField(body, variant, phase, 'Description', 'description', async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { description: val });
                await this.persistEntity();
            });
            this.renderVariantOverrideField(body, variant, phase, 'Start Conditions', 'startConditions', async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { startConditions: val });
                await this.persistEntity();
            });
            this.renderVariantOverrideField(body, variant, phase, 'End Conditions', 'endConditions', async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { endConditions: val });
                await this.persistEntity();
            });
            this.renderVariantOverrideField(body, variant, phase, 'Start Commands', 'startCommands', async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { startCommands: val });
                await this.persistEntity();
            });
            this.renderVariantOverrideField(body, variant, phase, 'End Commands', 'endCommands', async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { endCommands: val });
                await this.persistEntity();
            });
        } else {
            this.renderPhaseFieldCollapsible(body, 'Description', phase.description, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { description: val });
                await this.persistEntity();
            });

            this.renderPhaseFieldCollapsible(body, 'Start Conditions', phase.startConditions, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { startConditions: val });
                await this.persistEntity();
            });

            this.renderPhaseFieldCollapsible(body, 'End Conditions', phase.endConditions, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { endConditions: val });
                await this.persistEntity();
            });

            this.renderPhaseFieldCollapsible(body, 'Start Commands', phase.startCommands, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { startCommands: val });
                await this.persistEntity();
            });

            this.renderPhaseFieldCollapsible(body, 'End Commands', phase.endCommands, async (val) => {
                this.manager.updatePhaseFields(entity, phase.name, { endCommands: val });
                await this.persistEntity();
            });
        }

        if (entity.type === 'arc-variant') {
            const arcPhase = phase as ArcVariantPhase;
            this.renderLinkedEntitiesField(body, 'Linked Goals', arcPhase.linkedGoals,
                () => this.manager.getAllQuests().filter(q => q.category === 'Goal').map(q => q.title),
                async (val) => {
                    this.manager.updatePhaseFields(entity, phase.name, { linkedGoals: val } as any);
                    await this.persistEntity();
                },
                'Add goal quest...',
            );
            this.renderLinkedEntitiesField(body, 'Linked Limits', arcPhase.linkedLimits,
                () => this.manager.getAllQuests().filter(q => q.category === 'Limit').map(q => q.title),
                async (val) => {
                    this.manager.updatePhaseFields(entity, phase.name, { linkedLimits: val } as any);
                    await this.persistEntity();
                },
                'Add limit quest...',
            );
            this.renderLinkedEntitiesField(body, 'Linked Events', arcPhase.linkedEvents,
                () => this.manager.getAllQuests().filter(q => q.category === 'Event').map(q => q.title),
                async (val) => {
                    this.manager.updatePhaseFields(entity, phase.name, { linkedEvents: val } as any);
                    await this.persistEntity();
                },
                'Add event quest...',
            );
            this.renderLinkedEntitiesField(body, 'Linked Modifiers', arcPhase.linkedModifiers,
                () => this.manager.getAllQuests().filter(q => q.category === 'Modifier').map(q => q.title),
                async (val) => {
                    this.manager.updatePhaseFields(entity, phase.name, { linkedModifiers: val } as any);
                    await this.persistEntity();
                },
                'Add modifier quest...',
            );
        }

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

    private renderPhaseFieldCollapsible(container: HTMLElement, label: string, value: string, onChange: (val: string) => Promise<void>): void {
        const wrapper = container.createDiv('dn-collapsible-field');
        const header = wrapper.createDiv('dn-collapsible-header');
        const toggle = header.createSpan('dn-collapsible-toggle');
        const labelEl = header.createSpan('dn-collapsible-label');

        const isEmpty = !value;
        labelEl.setText(isEmpty ? `${label} (empty)` : label);
        setIcon(toggle, isEmpty ? 'chevron-right' : 'chevron-down');

        const body = wrapper.createDiv('dn-collapsible-body');
        body.style.display = isEmpty ? 'none' : '';

        const input = body.createEl('textarea', { cls: 'dn-collapsible-input' });
        (input as HTMLTextAreaElement).value = value;
        this.autoResizeTextarea(input as HTMLTextAreaElement);
        input.addEventListener('input', () => {
            this.autoResizeTextarea(input as HTMLTextAreaElement);
        });
        input.addEventListener('change', () => {
            this.scheduleSave(async () => {
                await onChange((input as HTMLTextAreaElement).value);
            });
        });

        header.addEventListener('click', () => {
            const isCollapsed = body.style.display === 'none';
            body.style.display = isCollapsed ? '' : 'none';
            toggle.empty();
            setIcon(toggle, isCollapsed ? 'chevron-down' : 'chevron-right');
            if (!isCollapsed) {
                this.autoResizeTextarea(input as HTMLTextAreaElement);
            }
        });
    }

    private renderVariantOverrideField(
        container: HTMLElement,
        entity: ObjectiveVariant | ArcVariant,
        phase: DNPhase,
        label: string,
        fieldName: string,
        onChange: (val: string) => Promise<void>,
    ): void {
        const isOverridden = phase.overrides.includes(fieldName);
        const typeValue = this.manager.getTypePhaseValue(entity, phase.name, fieldName);
        const variantValue = (phase as unknown as Record<string, unknown>)[fieldName] as string || '';

        const wrapper = container.createDiv('dn-collapsible-field dn-variant-override-field');
        const header = wrapper.createDiv('dn-collapsible-header');

        const collapseToggle = header.createSpan('dn-collapsible-toggle');

        const labelEl = header.createSpan('dn-collapsible-label');
        const suffix = isOverridden ? '' : (typeValue ? '' : ' (empty)');
        labelEl.setText(label + suffix);

        const overrideBtn = header.createEl('button', { cls: 'dn-override-toggle', attr: { title: isOverridden ? 'Revert to default' : 'Override this field' } });
        setIcon(overrideBtn, isOverridden ? 'toggle-right' : 'toggle-left');
        if (isOverridden) overrideBtn.addClass('is-active');

        const isEmpty = !isOverridden && !typeValue;
        setIcon(collapseToggle, isEmpty ? 'chevron-right' : 'chevron-down');

        const body = wrapper.createDiv('dn-collapsible-body');
        body.style.display = isEmpty ? 'none' : '';

        if (isOverridden) {
            const input = body.createEl('textarea', { cls: 'dn-collapsible-input' });
            (input as HTMLTextAreaElement).value = variantValue;
            this.autoResizeTextarea(input as HTMLTextAreaElement);
            input.addEventListener('input', () => this.autoResizeTextarea(input as HTMLTextAreaElement));
            input.addEventListener('change', () => {
                this.scheduleSave(async () => {
                    await onChange((input as HTMLTextAreaElement).value);
                });
            });
        } else if (typeValue) {
            const inherited = body.createDiv('dn-field-inherited');
            inherited.setText(typeValue);
        }

        overrideBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!this.currentEntity) return;

            const newOverridden = !phase.overrides.includes(fieldName);
            if (newOverridden) {
                phase.overrides.push(fieldName);
                (phase as unknown as Record<string, unknown>)[fieldName] = typeValue;
            } else {
                phase.overrides = phase.overrides.filter(f => f !== fieldName);
                (phase as unknown as Record<string, unknown>)[fieldName] = '';
            }
            await this.persistEntity();
            this.render(this.currentEntity);
        });

        header.addEventListener('click', (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.dn-override-toggle')) return;
            const isCollapsed = body.style.display === 'none';
            body.style.display = isCollapsed ? '' : 'none';
            collapseToggle.empty();
            setIcon(collapseToggle, isCollapsed ? 'chevron-down' : 'chevron-right');
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

    private renderLinkedEntitiesField(
        container: HTMLElement,
        label: string,
        values: string[],
        getSuggestions: () => string[],
        onChange: (val: string[]) => Promise<void>,
        placeholder?: string,
    ): void {
        const field = container.createDiv('dn-field');
        field.createEl('label', { text: label, cls: 'dn-field-label' });
        const pillContainer = field.createDiv('dn-pill-container');

        renderTagPillInput({
            container: pillContainer,
            values: values.map(unwrapWikilink),
            getSuggestions,
            onChange: (newValues) => {
                this.scheduleSave(async () => {
                    await onChange(newValues.map(wrapWikilink));
                });
            },
            placeholder: placeholder ?? 'Add...',
        });
    }

    private getLinkedLocations(entity: DNEntity): string[] {
        switch (entity.type) {
            case 'scenario': return (entity as Scenario).linkedLocations;
            case 'objective-variant': return (entity as ObjectiveVariant).linkedLocations;
            case 'arc-variant': return (entity as ArcVariant).linkedLocations;
            default: return [];
        }
    }

    private getLinkedCharacters(entity: DNEntity): string[] {
        switch (entity.type) {
            case 'scenario': return (entity as Scenario).linkedCharacters;
            case 'objective-variant': return (entity as ObjectiveVariant).linkedCharacters;
            default: return [];
        }
    }

    private async updateEntity(updates: Record<string, unknown>): Promise<void> {
        if (!this.currentEntity) return;
        switch (this.currentEntity.type) {
            case 'scenario':
                await this.manager.updateScenario(this.currentEntity.filePath, updates as Partial<Scenario>);
                break;
            case 'objective-type':
                await this.manager.updateObjectiveType(this.currentEntity.filePath, updates as Partial<ObjectiveType>);
                break;
            case 'objective-variant':
                await this.manager.updateObjectiveVariant(this.currentEntity.filePath, updates as Partial<ObjectiveVariant>);
                break;
            case 'arc-type':
                await this.manager.updateArcType(this.currentEntity.filePath, updates as Partial<ArcType>);
                break;
            case 'arc-variant':
                await this.manager.updateArcVariant(this.currentEntity.filePath, updates as Partial<ArcVariant>);
                break;
            case 'quest':
                await this.manager.updateQuest(this.currentEntity.filePath, updates as Partial<Quest>);
                break;
        }
        const updated = this.manager.getEntity(this.currentEntity.filePath);
        if (updated) this.currentEntity = updated;
        this.onChangeCallback?.();
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

    private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    private openEntityFile(entity: DNEntity): void {
        const file = this.plugin.app.vault.getAbstractFileByPath(entity.filePath);
        if (file instanceof TFile) {
            const leaf = this.plugin.app.workspace.getLeaf('tab');
            leaf.openFile(file, { state: { mode: 'source', source: false } });
        } else {
            new Notice(`Could not find file: ${entity.filePath}`);
        }
    }

    private confirmDeleteEntity(entity: DNEntity): void {
        openConfirmModal(this.plugin.app, {
            title: `Delete ${entity.type.replace(/-/g, ' ')}`,
            message: `Are you sure you want to delete "${entity.title}"? The file will be moved to trash.`,
            confirmLabel: 'Delete',
            onConfirm: async () => {
                switch (entity.type) {
                    case 'scenario': await this.manager.deleteScenario(entity.filePath); break;
                    case 'objective-type': {
                        const ok = await this.manager.deleteObjectiveType(entity.filePath);
                        if (!ok) return;
                        break;
                    }
                    case 'objective-variant': await this.manager.deleteObjectiveVariant(entity.filePath); break;
                    case 'arc-type': {
                        const ok = await this.manager.deleteArcType(entity.filePath);
                        if (!ok) return;
                        break;
                    }
                    case 'arc-variant': await this.manager.deleteArcVariant(entity.filePath); break;
                    case 'quest': await this.manager.deleteQuest(entity.filePath); break;
                }
                this.clear();
                new Notice(`"${entity.title}" deleted`);
            },
        });
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty -- end of file-wide suppression block opened at line 1 */
