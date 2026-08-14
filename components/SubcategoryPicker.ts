/* eslint-disable @typescript-eslint/no-unused-vars -- Obsidian's API surface and several untyped third-party libraries force dynamic dispatch; floating promises are intentional in DOM/event handlers; matching enable at end of file */
/**
 * Per-entity subcategory picker (Phase 2).
 *
 * Renders a small dropdown that assigns the entity's `templateSubcategory`
 * from the entity type's subcategory axis options. Renders nothing when the
 * entity type has no axis configured (the picker is only meaningful once an
 * axis exists — see the settings panel "Entity templates" section).
 */
import type { EntityTemplateService } from '../services/EntityTemplateService';

export interface SubcategoryPickerOptions {
    container: HTMLElement;
    entityTemplates: EntityTemplateService;
    entityType: string;
    current: string | undefined;
    onChange: (value: string | undefined) => void;
    /** Extra CSS classes for the wrapping row (e.g. view-specific spacing). */
    cls?: string;
}

/**
 * Render the subcategory picker into `container`. Returns true when an axis
 * exists and the picker was rendered, false otherwise.
 */
export function renderSubcategoryPicker(opts: SubcategoryPickerOptions): boolean {
    const { container, entityTemplates, entityType, current, onChange } = opts;
    const axis = entityTemplates.getAxis(entityType);
    if (!axis || axis.options.length === 0) return false;

    const row = container.createDiv('sl-subcategory-picker');
    if (opts.cls) row.addClass(opts.cls);

    const label = row.createSpan({ cls: 'sl-subcategory-picker-label', text: axis.label });
    const select = row.createEl('select', { cls: 'sl-subcategory-picker-select' });

    const noneOption = select.createEl('option', { text: '—', value: '' });
    if (!current || !axis.options.includes(current)) noneOption.selected = true;
    for (const opt of axis.options) {
        const o = select.createEl('option', { text: opt, value: opt });
        if (current === opt) o.selected = true;
    }

    select.addEventListener('change', () => {
        const value = select.value.trim();
        onChange(value ? value : undefined);
    });

    return true;
}
/* eslint-enable @typescript-eslint/no-unused-vars -- end of file-wide suppression block opened at line 1 */
