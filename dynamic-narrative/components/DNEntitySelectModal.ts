/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
import { FuzzySuggestModal, App, FuzzyMatch } from 'obsidian';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';

interface SelectableEntity {
    path: string;
    title: string;
    category: string;
    typeLabel: string;
}

export class DNEntitySelectModal extends FuzzySuggestModal<SelectableEntity> {
    private manager: DynamicNarrativeManager;
    private entityType: 'objective-variant' | 'arc-variant' | 'quest';
    private onSelect: (path: string) => void;

    constructor(
        app: App,
        manager: DynamicNarrativeManager,
        entityType: 'objective-variant' | 'arc-variant' | 'quest',
        onSelect: (path: string) => void,
    ) {
        super(app);
        this.manager = manager;
        this.entityType = entityType;
        this.onSelect = onSelect;
        this.setPlaceholder(`Search ${this.getLabel()}s...`);
    }

    private getLabel(): string {
        switch (this.entityType) {
            case 'objective-variant': return 'Objective Variant';
            case 'arc-variant': return 'Arc Variant';
            case 'quest': return 'Quest';
        }
    }

    getItems(): SelectableEntity[] {
        const results: SelectableEntity[] = [];
        switch (this.entityType) {
            case 'objective-variant': {
                for (const v of this.manager.getAllObjectiveVariants()) {
                    const type = this.manager.getObjectiveType(v.objectiveTypeId);
                    results.push({
                        path: v.filePath,
                        title: v.title,
                        category: v.category,
                        typeLabel: type ? `Type: ${type.title}` : '',
                    });
                }
                break;
            }
            case 'arc-variant': {
                for (const v of this.manager.getAllArcVariants()) {
                    const type = this.manager.getArcType(v.arcTypeId);
                    results.push({
                        path: v.filePath,
                        title: v.title,
                        category: v.category,
                        typeLabel: type ? `Type: ${type.title}` : '',
                    });
                }
                break;
            }
            case 'quest': {
                for (const q of this.manager.getAllQuests()) {
                    results.push({
                        path: q.filePath,
                        title: q.title,
                        category: q.category,
                        typeLabel: q.questType || '',
                    });
                }
                break;
            }
        }
        return results;
    }

    getItemText(item: SelectableEntity): string {
        return item.title;
    }

    onChooseItem(item: SelectableEntity, evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(item.path);
    }

    renderSuggestion(item: FuzzyMatch<SelectableEntity>, el: HTMLElement): void {
        el.createSpan({ cls: 'dn-select-title' }).setText(item.item.title);
        if (item.item.category) {
            el.createSpan({ cls: 'dn-select-category' }).setText(item.item.category);
        }
        if (item.item.typeLabel) {
            el.createSpan({ cls: 'dn-select-type' }).setText(item.item.typeLabel);
        }
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
