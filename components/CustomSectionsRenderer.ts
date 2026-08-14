 
/**
 * Shared renderer for user-defined custom sections (#114, #120).
 *
 * Originally introduced for Codex categories; now lifted into a shared helper
 * so Character and Location views can reuse the same section / field UX
 * without copy-pasting the modals and persistence logic.
 *
 * A "draft" host object is expected to expose a `custom?: Record<string,string>`
 * map; field values for sections are stored there under a composite key:
 *   `${sectionTitle}${CUSTOM_SECTION_KEY_SEP}${fieldName}`
 * so the flat custom-fields list can filter them out.
 */

import { App, Menu, Modal, Notice, Setting, setIcon } from 'obsidian';
import { attachTooltip } from './Tooltip';
import { openConfirmModal } from './ConfirmModal';
import type { EntityTemplateService } from '../services/EntityTemplateService';

/** Composite-key separator used to namespace fields inside custom sections. */
export const CUSTOM_SECTION_KEY_SEP = ' :: ';

/**
 * Supported input types for a custom-section field. Mirrors the universal
 * field template types so users get the same set of widgets they're already
 * familiar with from the universal fields feature.
 */
export type CustomFieldType = 'text' | 'textarea' | 'dropdown' | 'multi-select' | 'checkbox';

/**
 * Rich field definition stored inside a custom section. Legacy data may
 * still have plain `string` entries in `CustomSection.fields`; those are
 * promoted to `{ name, type: 'text' }` on access via {@link normalizeField}.
 */
export interface CustomFieldDef {
    /** Field name — also the suffix of the composite key in draft.custom. */
    name: string;
    /** Input type. Defaults to 'text' for legacy / minimal field entries. */
    type?: CustomFieldType;
    /** Placeholder / hint text shown in empty inputs. */
    placeholder?: string;
    /** Selectable options for dropdown / multi-select types. */
    options?: string[];
    /** Optional vault folder path whose note names are used as selectable options. */
    folderSource?: string;
    /**
     * Entity-template field flag — when set, the field's value is also
     * mirrored to a top-level YAML key (Obsidian Properties / Dataview).
     */
    topLevelKey?: string;
}

/**
 * Either the legacy bare-string field (= just a name, text input) or the
 * rich definition above. Renderers go through {@link normalizeField} to
 * always work with a `CustomFieldDef`.
 */
export type CustomFieldEntry = string | CustomFieldDef;

export interface CustomSection {
    title: string;
    fields: CustomFieldEntry[];
    /**
     * Slot at which this section renders within the host view.
     *   0                       → above the first built-in section
     *   k (1 ≤ k ≤ builtinCount) → after the k-th built-in section
     *   builtinCount (or undef) → at the end (legacy default)
     * Multiple custom sections may share the same slot; their order within
     * the slot is determined by their order in the `sections` array.
     */
    position?: number;
    /**
     * Stable identity shared by this section across subcategory templates.
     * Sections with the same `linkId` are treated as one logical section —
     * scoping (via "Available for subcategories") and structural edits
     * (rename / fields / move / delete) propagate to every linked copy.
     */
    linkId?: string;
}

/** Normalise any legacy bare-string entry to a {@link CustomFieldDef}. */
export function normalizeField(entry: CustomFieldEntry): CustomFieldDef {
    if (typeof entry === 'string') return { name: entry, type: 'text' };
    return {
        name: entry.name,
        type: entry.type ?? 'text',
        placeholder: entry.placeholder,
        options: entry.options,
        folderSource: entry.folderSource,
        topLevelKey: entry.topLevelKey,
    };
}

/** Get the field name from any (legacy or rich) entry. */
export function fieldName(entry: CustomFieldEntry): string {
    return typeof entry === 'string' ? entry : entry.name;
}

export interface CustomSectionsHost<TDraft extends { custom?: Record<string, string> }> {
    app: App;
    draft: TDraft;
    /**
     * Mutable section list backing this draft. The helper mutates this array
     * in place when the user adds / renames / deletes sections or fields.
     */
    sections: CustomSection[];
    /** Entity type id for the entity being edited (e.g. `character`, `codex:npc`). */
    entityType: string;
    /** Subcategory (axis option) this host is editing, if any. */
    subcategory?: string;
    /** Template service used for subcategory axes + linked-section scoping. */
    entityTemplates: EntityTemplateService;
    /**
     * Optional vault-wide remigration of composite keys after a structural
     * rename/delete. The currently-edited entity is handled inline by the
     * renderer; this callback migrates every *other* entity of the same type
     * in `affectedSubcategories` (empty array ⇒ base only).
     */
    remigrateLinkedKeys?: (ops: { oldKey: string; newKey?: string }[], affectedSubcategories: string[]) => void;
    /**
     * Number of built-in (non-custom) sections rendered by the host view.
     * Used to clamp `position` and to compute the final "end" slot.
     */
    builtinSectionCount: number;
    /** Set tracking which section bodies are currently collapsed. */
    collapsedSections: Set<string>;
    /**
     * Namespaces the collapsed-section keys so sections from different views
     * (or different codex categories) never collide.
     * Example: `codex::npc`, `character`, `location`.
     */
    collapseKeyPrefix: string;
    /**
     * CSS class prefix so the helper matches the host view's existing look.
     * Each view already styles `${cssPrefix}-section`, `${cssPrefix}-section-header`,
     * etc. — we reuse those rules instead of inventing a new design token.
     */
    cssPrefix: 'codex' | 'character' | 'location';
    /** Persist any change to the field VALUES on the draft. */
    scheduleSave: (draft: TDraft) => void;
    /** Persist the section STRUCTURE (titles / field lists / positions) to plugin settings. */
    persistSections: () => void;
    /** Trigger a full re-render of the host view. */
    requestRerender: () => void;
    /**
     * Optional predicate — when true, a custom section whose title matches a
     * built-in default section is rendered *inside* that section (fields only,
     * no duplicate header) via {@link renderMergedSection} instead of being
     * rendered as a standalone section by {@link renderCustomSectionsAtSlot}.
     */
    isMergedSectionTitle?: (title: string) => boolean;
}

/** Effective position for a section (clamped to [0, builtinCount]). */
function effectivePosition(sec: CustomSection, builtinCount: number): number {
    const p = sec.position;
    if (p === undefined || p === null || isNaN(p)) return builtinCount;
    if (p < 0) return 0;
    if (p > builtinCount) return builtinCount;
    return p;
}

function compositeKey(sectionTitle: string, fieldName: string): string {
    return `${sectionTitle}${CUSTOM_SECTION_KEY_SEP}${fieldName}`;
}

/**
 * Propagate the current (authoritative) copy of every linked section to all
 * other subcategory templates sharing its `linkId`. Call after a structural
 * mutation (rename / move / add|remove|edit|reorder field) has been persisted
 * for the current subcategory so the live two-way link stays consistent.
 */
export async function syncLinkedSections(
    entityTemplates: EntityTemplateService,
    entityType: string,
    subcategory: string | undefined,
    sections: CustomSection[],
): Promise<void> {
    for (const sec of sections) {
        if (sec.linkId) {
            await entityTemplates.syncLinkedSection(entityType, sec.linkId, subcategory, sec);
        }
    }
}

/**
 * Subcategories whose entities should have their composite keys remigrated
 * after a structural edit to `sec`. For a linked section this is the set of
 * axis options it is scoped to (`[]` ⇒ base only); for a non-linked section it
 * is just the subcategory it currently lives in (or base).
 */
function affectedSubcategoriesFor<T extends { custom?: Record<string, string> }>(
    host: CustomSectionsHost<T>,
    sec: CustomSection,
): string[] {
    if (sec.linkId) {
        return host.entityTemplates.getLinkedSubcategories(host.entityType, sec.linkId);
    }
    return host.subcategory ? [host.subcategory] : [];
}

function folderOptionNames(app: App, folderSource?: string): string[] {
    const normalized = (folderSource || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) return [];
    const prefix = normalized + '/';
    const names = new Set<string>();
    for (const file of app.vault.getMarkdownFiles()) {
        const path = file.path.replace(/\\/g, '/');
        if (path.startsWith(prefix)) names.add(file.basename);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function selectableOptions(app: App, def: CustomFieldDef): string[] {
    const options = new Set<string>();
    for (const opt of def.options ?? []) {
        const trimmed = opt.trim();
        if (trimmed) options.add(trimmed);
    }
    for (const opt of folderOptionNames(app, def.folderSource)) options.add(opt);
    return Array.from(options).sort((a, b) => a.localeCompare(b));
}

/** True for any key that belongs to a custom section (so callers can skip it
 *  in their flat "Custom Fields" lists). */
export function isCustomSectionKey(key: string): boolean {
    return key.includes(CUSTOM_SECTION_KEY_SEP);
}

/**
 * Ensure draft.custom has entries for every section field. Idempotent.
 */
function seedDraftCustom<T extends { custom?: Record<string, string> }>(
    host: CustomSectionsHost<T>
): void {
    const { draft, sections } = host;
    if (sections.length === 0) return;
    if (!draft.custom) draft.custom = {};
    for (const sec of sections) {
        for (const entry of sec.fields) {
            const key = compositeKey(sec.title, fieldName(entry));
            if (!(key in draft.custom)) draft.custom[key] = '';
        }
    }
}

/**
 * Compute the global ordering of sections grouped by slot. Returns an array
 * indexed by slot (0..builtinCount inclusive) where each entry is the list of
 * `CustomSection`s at that slot, in their array order.
 */
function bucketBySlot<T extends { custom?: Record<string, string> }>(
    host: CustomSectionsHost<T>
): CustomSection[][] {
    const buckets: CustomSection[][] = [];
    for (let i = 0; i <= host.builtinSectionCount; i++) buckets.push([]);
    for (const sec of host.sections) {
        const slot = effectivePosition(sec, host.builtinSectionCount);
        buckets[slot].push(sec);
    }
    return buckets;
}

/**
 * Move a section one step earlier in the interleaved order (slot+slot-internal).
 * Returns true if the move was applied.
 */
function moveSectionUp<T extends { custom?: Record<string, string> }>(sec: CustomSection, host: CustomSectionsHost<T>): boolean {
    const builtinCount = host.builtinSectionCount;
    const buckets = bucketBySlot(host);
    const slot = effectivePosition(sec, builtinCount);
    const bucket = buckets[slot];
    const indexInBucket = bucket.indexOf(sec);
    if (indexInBucket > 0) {
        // Swap order within the same slot — i.e. swap positions of
        // sec and its predecessor in the global `sections` array.
        const prev = bucket[indexInBucket - 1];
        const a = host.sections.indexOf(sec);
        const b = host.sections.indexOf(prev);
        host.sections[a] = prev;
        host.sections[b] = sec;
        return true;
    }
    // First in this slot. Move to previous slot if any.
    if (slot > 0) {
        sec.position = slot - 1;
        return true;
    }
    return false;
}

/**
 * Move a section one step later. Returns true if applied.
 */
function moveSectionDown<T extends { custom?: Record<string, string> }>(sec: CustomSection, host: CustomSectionsHost<T>): boolean {
    const builtinCount = host.builtinSectionCount;
    const buckets = bucketBySlot(host);
    const slot = effectivePosition(sec, builtinCount);
    const bucket = buckets[slot];
    const indexInBucket = bucket.indexOf(sec);
    if (indexInBucket < bucket.length - 1) {
        const next = bucket[indexInBucket + 1];
        const a = host.sections.indexOf(sec);
        const b = host.sections.indexOf(next);
        host.sections[a] = next;
        host.sections[b] = sec;
        return true;
    }
    if (slot < builtinCount) {
        sec.position = slot + 1;
        return true;
    }
    return false;
}

/** True if `sec` is the very first section in interleaved order. */
function isFirstSection<T extends { custom?: Record<string, string> }>(sec: CustomSection, host: CustomSectionsHost<T>): boolean {
    if (effectivePosition(sec, host.builtinSectionCount) !== 0) return false;
    // Slot 0 — only first iff host has zero built-ins AND sec is index 0 of slot 0.
    if (host.builtinSectionCount > 0) return false;
    const buckets = bucketBySlot(host);
    return buckets[0][0] === sec;
}

/** True if `sec` is the very last section in interleaved order. */
function isLastSection<T extends { custom?: Record<string, string> }>(sec: CustomSection, host: CustomSectionsHost<T>): boolean {
    const builtinCount = host.builtinSectionCount;
    if (effectivePosition(sec, builtinCount) !== builtinCount) return false;
    const buckets = bucketBySlot(host);
    const lastBucket = buckets[builtinCount];
    return lastBucket[lastBucket.length - 1] === sec;
}

/**
 * Render every custom section assigned to `slot`. `slot` is the number of
 * built-in sections that have already been rendered; slot 0 = before any
 * built-in, slot host.builtinSectionCount = after the last built-in.
 *
 * Hosts that interleave should call this between each built-in:
 *
 *     renderCustomSectionsAtSlot(parent, host, 0);          // before
 *     for (let i = 0; i < cats.length; i++) {
 *         renderBuiltin(parent, cats[i]);
 *         renderCustomSectionsAtSlot(parent, host, i + 1);  // after each
 *     }
 *     renderAddCustomSectionButton(parent, host);
 */
export function renderCustomSectionsAtSlot<T extends { custom?: Record<string, string> }>(
    container: HTMLElement,
    host: CustomSectionsHost<T>,
    slot: number
): void {
    seedDraftCustom(host);
    const buckets = bucketBySlot(host);
    if (slot < 0 || slot >= buckets.length) return;
    for (const sec of buckets[slot]) {
        // Sections whose title matches a built-in default section are merged
        // into it (rendered by the host via renderMergedSection) — skip here.
        if (host.isMergedSectionTitle?.(sec.title)) continue;
        renderOneSection(container, host, sec);
    }
}

/**
 * Render the "+ Add custom section" button (placed once, at the bottom).
 */
export function renderAddCustomSectionButton<T extends { custom?: Record<string, string> }>(
    container: HTMLElement,
    host: CustomSectionsHost<T>
): void {
    const { app, sections } = host;
    const addSectionRow = container.createDiv('codex-add-custom-section-row');
    const addSectionBtn = addSectionRow.createEl('button', {
        cls: 'codex-add-custom-section-btn',
        text: '+ add custom section',
    });
    addSectionBtn.addEventListener('click', () => {
        const modal = new AddCustomSectionModal(app, '', (title) => {
            const trimmed = title.trim();
            if (!trimmed) return;
            if (sections.some(s => s.title === trimmed)) {
                new Notice(`A section called "${trimmed}" already exists.`);
                return;
            }
            // New sections land at the end (legacy default).
            sections.push({ title: trimmed, fields: [], position: host.builtinSectionCount });
            host.persistSections();
            host.requestRerender();
        });
        modal.open();
    });
}

/**
 * Legacy entry point — renders ALL sections in interleaved order (so position
 * is still respected, but without inlining built-in sections in between).
 * Hosts that want true interleaving should use `renderCustomSectionsAtSlot`
 * between their built-in render calls.
 */
export function renderCustomSections<T extends { custom?: Record<string, string> }>(
    container: HTMLElement,
    host: CustomSectionsHost<T>
): void {
    seedDraftCustom(host);
    for (let slot = 0; slot <= host.builtinSectionCount; slot++) {
        renderCustomSectionsAtSlot(container, host, slot);
    }
    renderAddCustomSectionButton(container, host);
}

/**
 * Render a single custom section (header + body + add-field row).
 * Used internally by `renderCustomSectionsAtSlot`.
 */
function renderOneSection<T extends { custom?: Record<string, string> }>(
    container: HTMLElement,
    host: CustomSectionsHost<T>,
    sec: CustomSection
): void {
    const { app, draft, sections, collapsedSections, collapseKeyPrefix, cssPrefix } = host;

    const headerLabel = `${cssPrefix}-section-header`;
    const bodyLabel = `${cssPrefix}-section-body`;
    const sectionLabel = `${cssPrefix}-section`;
    const chevronLabel = `${cssPrefix}-section-chevron`;
    const iconLabel = `${cssPrefix}-section-icon`;
    const titleLabel = `${cssPrefix}-section-title`;

    {
        const section = container.createDiv(`${sectionLabel} ${cssPrefix}-section-custom`);
        const header = section.createDiv(headerLabel);
        const chevron = header.createSpan({ cls: chevronLabel });

        const sectionKey = `custom-section::${collapseKeyPrefix}::${sec.title}`;
        const isCollapsed = collapsedSections.has(sectionKey);
        setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');

        const icon = header.createSpan({ cls: iconLabel });
        setIcon(icon, 'layout-grid');
        header.createSpan({ cls: titleLabel, text: sec.title });

        // Move up / move down / rename / delete actions — icon-only spans
        // matching the rest of the app (no <button> elements).
        const actions = header.createSpan({ cls: 'codex-section-actions' });
        const stop = (e: Event) => e.stopPropagation();
        const disabledAttr = 'data-disabled';

        // Move section up — walks the interleaved order (across built-in slots)
        const moveUpBtn = actions.createSpan({
            cls: 'codex-section-action-btn',
            attr: { 'aria-label': 'Move section up', role: 'button' },
        });
        setIcon(moveUpBtn, 'chevron-up');
        attachTooltip(moveUpBtn, 'Move section up');
        if (isFirstSection(sec, host)) moveUpBtn.setAttr(disabledAttr, 'true');
        moveUpBtn.addEventListener('click', (e) => {
            stop(e);
            if (moveUpBtn.hasAttribute(disabledAttr)) return;
            if (moveSectionUp(sec, host)) {
                host.persistSections();
                host.requestRerender();
            }
        });

        // Move section down — walks the interleaved order
        const moveDownBtn = actions.createSpan({
            cls: 'codex-section-action-btn',
            attr: { 'aria-label': 'Move section down', role: 'button' },
        });
        setIcon(moveDownBtn, 'chevron-down');
        attachTooltip(moveDownBtn, 'Move section down');
        if (isLastSection(sec, host)) moveDownBtn.setAttr(disabledAttr, 'true');
        moveDownBtn.addEventListener('click', (e) => {
            stop(e);
            if (moveDownBtn.hasAttribute(disabledAttr)) return;
            if (moveSectionDown(sec, host)) {
                host.persistSections();
                host.requestRerender();
            }
        });

        const renameBtn = actions.createSpan({
            cls: 'codex-section-action-btn',
            attr: { 'aria-label': 'Rename section', role: 'button' },
        });
        setIcon(renameBtn, 'pencil');
        attachTooltip(renameBtn, 'Rename section');
        renameBtn.addEventListener('click', (e) => {
            stop(e);
            const modal = new AddCustomSectionModal(app, sec.title, (newTitle) => {
                const trimmed = newTitle.trim();
                if (!trimmed || trimmed === sec.title) return;
                if (sections.some(s => s !== sec && s.title === trimmed)) {
                    new Notice(`A section called "${trimmed}" already exists.`);
                    return;
                }
                const oldTitle = sec.title;
                // Migrate composite keys in draft.custom from old → new title.
                const ops: { oldKey: string; newKey?: string }[] = [];
                if (draft.custom) {
                    for (const entry of sec.fields) {
                        const fname = fieldName(entry);
                        const oldKey = compositeKey(oldTitle, fname);
                        const newKey = compositeKey(trimmed, fname);
                        ops.push({ oldKey, newKey });
                        if (oldKey in draft.custom) {
                            draft.custom[newKey] = draft.custom[oldKey];
                            delete draft.custom[oldKey];
                        }
                    }
                }
                sec.title = trimmed;
                host.persistSections();
                host.remigrateLinkedKeys?.(ops, affectedSubcategoriesFor(host, sec));
                host.scheduleSave(draft);
                host.requestRerender();
            });
            modal.open();
        });

        // "Available for subcategories" — scope this section across the axis
        // options of the entity type. Hidden when no axis is configured.
        const scopeAxis = host.entityTemplates.getAxis(host.entityType);
        if (scopeAxis && scopeAxis.options.length > 0) {
            const scopeBtn = actions.createSpan({
                cls: 'codex-section-action-btn',
                attr: { 'aria-label': 'Available for subcategories', role: 'button' },
            });
            setIcon(scopeBtn, 'network');
            attachTooltip(scopeBtn, 'Available for subcategories');
            scopeBtn.addEventListener('click', (e) => {
                stop(e);
                void (async () => {
                    const linkId = await host.entityTemplates.ensureSectionLinkId(host.entityType, host.subcategory, sec);
                    const current = host.entityTemplates.getLinkedSubcategories(host.entityType, linkId);
                    new SectionScopeModal(app, scopeAxis.options, current, (selected) => {
                        void host.entityTemplates.setSectionScope(host.entityType, linkId, sec, selected).then(() => {
                            host.requestRerender();
                        });
                    }).open();
                })();
            });
        }

        const deleteBtn = actions.createSpan({
            cls: 'codex-section-action-btn',
            attr: { 'aria-label': 'Remove section', role: 'button' },
        });
        setIcon(deleteBtn, 'trash');
        attachTooltip(deleteBtn, 'Remove section');
        deleteBtn.addEventListener('click', (e) => {
            stop(e);
            openConfirmModal(app, {
                title: 'Remove Section',
                message: `Remove "${sec.title}" from all entries that share this section list?`,
                confirmLabel: 'Remove section',
                onConfirm: async () => {
                    const affected = affectedSubcategoriesFor(host, sec);
                    const ops = sec.fields.map(entry => ({ oldKey: compositeKey(sec.title, fieldName(entry)) }));
                    if (draft.custom) {
                        for (const entry of sec.fields) {
                            delete draft.custom[compositeKey(sec.title, fieldName(entry))];
                        }
                        if (Object.keys(draft.custom).length === 0) draft.custom = undefined;
                    }
                    // A linked section is removed from every subcategory it
                    // was scoped to (including the base template).
                    if (sec.linkId) {
                        await host.entityTemplates.removeLinkedSection(host.entityType, sec.linkId);
                    }
                    const idx = sections.indexOf(sec);
                    if (idx >= 0) sections.splice(idx, 1);
                    host.persistSections();
                    host.remigrateLinkedKeys?.(ops, affected);
                    host.scheduleSave(draft);
                    host.requestRerender();
                },
            });
        });

        header.addEventListener('click', () => {
            if (collapsedSections.has(sectionKey)) {
                collapsedSections.delete(sectionKey);
            } else {
                collapsedSections.add(sectionKey);
            }
            host.requestRerender();
        });

        if (isCollapsed) return;

        const body = section.createDiv(bodyLabel);
        renderSectionFields(body, host, sec);
    }
}

/**
 * Render the fields (+ "add field" row) of a custom section into a container.
 *
 * Used both by standalone custom sections (inside their section body) and by
 * merged sections, where a custom section sharing a built-in section's title
 * is rendered inside that built-in section's body without a header.
 */
function renderSectionFields<T extends { custom?: Record<string, string> }>(
    container: HTMLElement,
    host: CustomSectionsHost<T>,
    sec: CustomSection,
): void {
    const { app, draft, sections, cssPrefix } = host;

    const fieldRowLabel = `${cssPrefix}-field-row`;
    const fieldLabelLabel = `${cssPrefix}-field-label`;
    const fieldInputLabel = `${cssPrefix}-field-input`;
    const customRowLabel = `${cssPrefix}-custom-field-row`;
    const customRemoveLabel = `${cssPrefix}-custom-field-remove`;

    for (let fIdx = 0; fIdx < sec.fields.length; fIdx++) {
            const entry = sec.fields[fIdx];
            const def = normalizeField(entry);
            const fname = def.name;
            const key = compositeKey(sec.title, fname);
            const row = container.createDiv(`${fieldRowLabel} ${customRowLabel}`);
            row.createEl('label', { cls: fieldLabelLabel, text: fname });

            // Render the input element appropriate for the field's type.
            // Mirrors the universal field renderers so users get the same
            // widgets they're used to from `AddFieldModal`.
            const currentValue = (draft.custom && draft.custom[key]) || '';
            const placeholderHint = def.placeholder || `Value for ${fname}`;
            switch (def.type) {
                case 'textarea': {
                    const ta = row.createEl('textarea', {
                        cls: fieldInputLabel,
                        attr: { placeholder: placeholderHint, rows: '3' },
                    });
                    ta.value = currentValue;
                    const autoGrow = () => {
                        ta.setCssStyles({ height: 'auto' });
                        ta.setCssStyles({ height: ta.scrollHeight + 'px' });
                    };
                    ta.addEventListener('input', () => {
                        if (!draft.custom) draft.custom = {};
                        draft.custom[key] = ta.value;
                        host.scheduleSave(draft);
                        autoGrow();
                    });
                    window.requestAnimationFrame(autoGrow);
                    break;
                }
                case 'dropdown': {
                    const sel = row.createEl('select', { cls: `${fieldInputLabel} dropdown` });
                    sel.createEl('option', { text: placeholderHint, value: '' });
                    const opts = selectableOptions(app, def);
                    for (const opt of opts) {
                        const o = sel.createEl('option', { text: opt, value: opt });
                        if (currentValue === opt) o.selected = true;
                    }
                    if (currentValue && !opts.includes(currentValue)) {
                        const o = sel.createEl('option', { text: currentValue, value: currentValue });
                        o.selected = true;
                    }
                    sel.addEventListener('change', () => {
                        if (!draft.custom) draft.custom = {};
                        draft.custom[key] = sel.value;
                        host.scheduleSave(draft);
                    });
                    break;
                }
                case 'multi-select': {
                    // Lightweight tag-pill UI: pills container + free-form input
                    // with autocomplete suggestions when options are defined.
                    const wrap = row.createDiv('codex-custom-multi-wrap');
                    const pills = wrap.createDiv('codex-custom-multi-pills');
                    const inp = wrap.createEl('input', {
                        cls: fieldInputLabel,
                        attr: { type: 'text', placeholder: placeholderHint, autocomplete: 'off' },
                    });
                    let values = currentValue
                        ? currentValue.split(',').map(v => v.trim()).filter(Boolean)
                        : [];
                    const allowed = selectableOptions(app, def);

                    // ── Suggestion dropdown ──────────────────────
                    const suggestList = wrap.createDiv('codex-custom-multi-suggest is-hidden');

                    const showSuggestions = () => {
                        const term = inp.value.trim().toLowerCase();
                        if (allowed.length === 0) {
                            suggestList.addClass('is-hidden');
                            suggestList.empty();
                            return;
                        }
                        // Empty input shows all available (not-yet-selected) options;
                        // typing filters them down.
                        const matches = allowed.filter(
                            o => o.toLowerCase().includes(term) && !values.includes(o)
                        );
                        if (matches.length === 0) {
                            suggestList.addClass('is-hidden');
                            suggestList.empty();
                            return;
                        }
                        suggestList.empty();
                        suggestList.removeClass('is-hidden');
                        for (const m of matches) {
                            const item = suggestList.createDiv('codex-custom-multi-suggest-item');
                            item.textContent = m;
                            item.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                if (!values.includes(m)) {
                                    values.push(m);
                                    if (!draft.custom) draft.custom = {};
                                    draft.custom[key] = values.join(', ');
                                    host.scheduleSave(draft);
                                    renderPills();
                                }
                                inp.value = '';
                                suggestList.addClass('is-hidden');
                                suggestList.empty();
                                inp.focus();
                            });
                        }
                    };

                    // Debounced show on input
                    let suggestTimer: number | null = null;
                    inp.addEventListener('input', () => {
                        if (suggestTimer) window.clearTimeout(suggestTimer);
                        suggestTimer = window.setTimeout(showSuggestions, 120);
                    });
                    inp.addEventListener('focus', () => {
                        showSuggestions();
                    });
                    // Dismiss on blur (allow click-to-select first)
                    inp.addEventListener('blur', () => {
                        window.setTimeout(() => {
                            suggestList.addClass('is-hidden');
                            suggestList.empty();
                        }, 150);
                    });
                    inp.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            suggestList.addClass('is-hidden');
                            suggestList.empty();
                            return;
                        }
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            // Prefer picking the first visible suggestion
                            const first = suggestList.querySelector('.codex-custom-multi-suggest-item');
                            if (first) { (first as HTMLElement).click(); return; }
                            const v = inp.value.trim();
                            if (!v) return;
                            if (allowed.length > 0 && !allowed.includes(v)) {
                                new Notice(`"${v}" is not one of the allowed options.`);
                                return;
                            }
                            if (!values.includes(v)) {
                                values.push(v);
                                if (!draft.custom) draft.custom = {};
                                draft.custom[key] = values.join(', ');
                                host.scheduleSave(draft);
                                renderPills();
                            }
                            inp.value = '';
                            suggestList.addClass('is-hidden');
                            suggestList.empty();
                        }
                    });

                    const renderPills = () => {
                        pills.empty();
                        for (let i = 0; i < values.length; i++) {
                            const v = values[i];
                            const pill = pills.createSpan({ cls: 'codex-custom-multi-pill' });
                            pill.createSpan({ text: v });
                            const x = pill.createSpan({ cls: 'codex-custom-multi-pill-x', text: '×' });
                            x.addEventListener('click', () => {
                                values.splice(i, 1);
                                if (!draft.custom) draft.custom = {};
                                draft.custom[key] = values.join(', ');
                                host.scheduleSave(draft);
                                renderPills();
                            });
                        }
                    };
                    renderPills();
                    break;
                }
                case 'checkbox': {
                    const cb = row.createEl('input', {
                        cls: `${fieldInputLabel} codex-custom-checkbox`,
                        attr: { type: 'checkbox' },
                    });
                    cb.checked = currentValue === 'true' || currentValue === 'yes' || currentValue === '1';
                    cb.addEventListener('change', () => {
                        if (!draft.custom) draft.custom = {};
                        draft.custom[key] = cb.checked ? 'true' : 'false';
                        host.scheduleSave(draft);
                    });
                    break;
                }
                case 'text':
                default: {
                    const input = row.createEl('input', {
                        cls: fieldInputLabel,
                        attr: { type: 'text', placeholder: placeholderHint },
                    });
                    input.value = currentValue;
                    input.addEventListener('input', () => {
                        if (!draft.custom) draft.custom = {};
                        draft.custom[key] = input.value;
                        host.scheduleSave(draft);
                    });
                    break;
                }
            }

            // Edit field — opens the Add modal pre-filled so users can
            // tweak type, placeholder, options without removing/re-adding.
            const editBtn = row.createSpan({
                cls: customRemoveLabel,
                attr: { 'aria-label': 'Edit field', role: 'button' },
            });
            setIcon(editBtn, 'pencil');
            editBtn.addEventListener('click', () => {
                const modal = new AddSectionFieldModal(app, (result) => {
                    if (!result || !result.name) return;
                    const trimmedName = result.name.trim();
                    if (!trimmedName) return;
                    // Detect rename
                    if (trimmedName !== fname && sec.fields.some(f => fieldName(f) === trimmedName)) {
                        new Notice(`Field "${trimmedName}" already exists in this section.`);
                        return;
                    }
                    // Migrate composite key if renamed
                    let ops: { oldKey: string; newKey?: string }[] | undefined;
                    if (trimmedName !== fname) {
                        const oldKey = compositeKey(sec.title, fname);
                        const newKey = compositeKey(sec.title, trimmedName);
                        ops = [{ oldKey, newKey }];
                        if (draft.custom && oldKey in draft.custom) {
                            draft.custom[newKey] = draft.custom[oldKey];
                            delete draft.custom[oldKey];
                        }
                    }
                    sec.fields[fIdx] = {
                        name: trimmedName,
                        type: result.type ?? 'text',
                        placeholder: result.placeholder,
                        options: result.options,
                        folderSource: result.folderSource,
                        topLevelKey: result.topLevelKey ?? def.topLevelKey,
                    };
                    host.persistSections();
                    if (ops) host.remigrateLinkedKeys?.(ops, affectedSubcategoriesFor(host, sec));
                    host.scheduleSave(draft);
                    host.requestRerender();
                }, def);
                modal.open();
            });

            // Move field up — icon-only span
            const fUpBtn = row.createSpan({
                cls: customRemoveLabel,
                attr: { 'aria-label': 'Move field up', role: 'button' },
            });
            setIcon(fUpBtn, 'chevron-up');
            if (fIdx === 0) fUpBtn.setAttr('data-disabled', 'true');
            fUpBtn.addEventListener('click', () => {
                if (fUpBtn.hasAttribute('data-disabled')) return;
                const tmp = sec.fields[fIdx - 1];
                sec.fields[fIdx - 1] = entry;
                sec.fields[fIdx] = tmp;
                host.persistSections();
                host.requestRerender();
            });

            // Move field down — icon-only span
            const fDownBtn = row.createSpan({
                cls: customRemoveLabel,
                attr: { 'aria-label': 'Move field down', role: 'button' },
            });
            setIcon(fDownBtn, 'chevron-down');
            if (fIdx === sec.fields.length - 1) fDownBtn.setAttr('data-disabled', 'true');
            fDownBtn.addEventListener('click', () => {
                if (fDownBtn.hasAttribute('data-disabled')) return;
                const tmp = sec.fields[fIdx + 1];
                sec.fields[fIdx + 1] = entry;
                sec.fields[fIdx] = tmp;
                host.persistSections();
                host.requestRerender();
            });

            const moveSectionBtn = row.createSpan({
                cls: customRemoveLabel,
                attr: { 'aria-label': 'Move field to another section', role: 'button' },
            });
            setIcon(moveSectionBtn, 'move-right');
            attachTooltip(moveSectionBtn, 'Move field to section');
            const targets = sections.filter(target => target !== sec);
            if (targets.length === 0) moveSectionBtn.setAttr('data-disabled', 'true');
            moveSectionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (moveSectionBtn.hasAttribute('data-disabled')) return;
                const menu = new Menu();
                for (const target of targets) {
                    menu.addItem(item => item
                        .setTitle(target.title)
                        .setIcon('layout-grid')
                        .onClick(() => {
                            if (target.fields.some(f => fieldName(f) === fname)) {
                                new Notice(`Field "${fname}" already exists in section "${target.title}".`);
                                return;
                            }
                            const [moved] = sec.fields.splice(fIdx, 1);
                            target.fields.push(moved);
                            if (!draft.custom) draft.custom = {};
                            const oldKey = compositeKey(sec.title, fname);
                            const newKey = compositeKey(target.title, fname);
                            draft.custom[newKey] = draft.custom[oldKey] ?? '';
                            delete draft.custom[oldKey];
                            host.persistSections();
                            host.scheduleSave(draft);
                            host.requestRerender();
                        }));
                }
                menu.showAtMouseEvent(e);
            });

            const removeBtn = row.createSpan({
                cls: customRemoveLabel,
                attr: { 'aria-label': 'Remove field', role: 'button' },
            });
            setIcon(removeBtn, 'x');
            removeBtn.addEventListener('click', () => {
                openConfirmModal(app, {
                    title: 'Remove Field',
                    message: `Remove "${fname}" from section "${sec.title}" for all entries that share this section list?`,
                    confirmLabel: 'Remove field',
                    onConfirm: () => {
                        const affected = affectedSubcategoriesFor(host, sec);
                        sec.fields = sec.fields.filter(f => fieldName(f) !== fname);
                        if (draft.custom) delete draft.custom[key];
                        host.persistSections();
                        host.remigrateLinkedKeys?.([{ oldKey: key }], affected);
                        host.scheduleSave(draft);
                        host.requestRerender();
                    },
                });
            });
        }

        // "+ Add field to this section"
        const addRow = container.createDiv('codex-add-custom-field-row');
        const addFieldBtn = addRow.createEl('button', {
            cls: 'codex-add-custom-btn',
            text: '+ add field to this section',
        });
        addFieldBtn.addEventListener('click', () => {
            const modal = new AddSectionFieldModal(app, (result) => {
                if (!result || !result.name) return;
                const trimmed = result.name.trim();
                if (!trimmed) return;
                if (sec.fields.some(f => fieldName(f) === trimmed)) {
                    new Notice(`Field "${trimmed}" already exists in this section.`);
                    return;
                }
                sec.fields.push({
                    name: trimmed,
                    type: result.type ?? 'text',
                    placeholder: result.placeholder,
                    options: result.options,
                    folderSource: result.folderSource,
                    topLevelKey: result.topLevelKey,
                });
                if (!draft.custom) draft.custom = {};
                draft.custom[compositeKey(sec.title, trimmed)] = '';
                host.persistSections();
                host.scheduleSave(draft);
                host.requestRerender();
            });
            modal.open();
        });
    }

/**
 * Render the custom fields of all custom sections whose title matches a
 * built-in default section into that default section's body.
 *
 * Hosts call this once per built-in section body; the matching custom
 * sections are skipped by {@link renderCustomSectionsAtSlot} so their fields
 * appear inline (without a duplicate header).
 */
export function renderMergedSection<T extends { custom?: Record<string, string> }>(
    container: HTMLElement,
    host: CustomSectionsHost<T>,
    sectionTitle: string,
): void {
    const merged = host.sections.filter(sec => sec.title === sectionTitle);
    if (merged.length === 0) return;
    seedDraftCustom(host);
    for (const sec of merged) {
        renderSectionFields(container, host, sec);
    }
}

// ═══════════════════════════════════════════════════
//  Add / Rename a custom section
// ═══════════════════════════════════════════════════

/**
 * Multi-select of the entity type's subcategory axis options, used to define
 * which subcategories a section is available in. Selecting nothing scopes the
 * section to the base template only (entities with no subcategory set).
 */
export class SectionScopeModal extends Modal {
    private options: string[];
    private selected: Set<string>;
    private callback: (selected: string[]) => void;

    constructor(app: App, options: string[], selected: string[], callback: (selected: string[]) => void) {
        super(app);
        this.options = options;
        this.selected = new Set(selected);
        this.callback = callback;
    }

    onOpen(): void {
        this.titleEl.setText('Available for subcategories');
        this.contentEl.createEl('p', {
            text: 'Choose which subcategories this section appears in. With none selected, it is only available to entities without a subcategory.',
            cls: 'setting-item-description',
        });

        let allChecked = this.options.length > 0 && this.options.every(o => this.selected.has(o));

        const render = () => {
            this.contentEl.querySelectorAll('.sl-scope-option').forEach(el => el.remove());
            for (const opt of this.options) {
                const item = new Setting(this.contentEl);
                item.setClass('sl-scope-option');
                item.setName(opt);
                item.addToggle(toggle => {
                    toggle.setValue(this.selected.has(opt));
                    toggle.onChange(v => {
                        if (v) this.selected.add(opt);
                        else this.selected.delete(opt);
                        allChecked = this.options.length > 0 && this.options.every(o => this.selected.has(o));
                        render();
                    });
                });
            }
        };
        render();

        new Setting(this.contentEl)
            .setName('All subcategories')
            .addToggle(toggle => {
                toggle.setValue(allChecked);
                toggle.onChange(v => {
                    this.selected = v ? new Set(this.options) : new Set<string>();
                    allChecked = v;
                    render();
                });
            });

        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText('Apply')
                .setCta()
                .onClick(() => {
                    this.close();
                    this.callback([...this.selected]);
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }
}

export class AddCustomSectionModal extends Modal {
    private callback: (title: string) => void;
    private initialTitle: string;

    constructor(app: App, initialTitle: string, callback: (title: string) => void) {
        super(app);
        this.initialTitle = initialTitle;
        this.callback = callback;
    }

    onOpen(): void {
        this.titleEl.setText(this.initialTitle ? 'Rename Section' : 'Add Custom Section');
        let title = this.initialTitle;
        let nameInput: HTMLInputElement | null = null;
        new Setting(this.contentEl)
            .setName('Section title')
            .addText(text => {
                text.setPlaceholder('E.g. Misbelief, voice, wardrobe???');
                text.setValue(this.initialTitle);
                text.onChange(v => { title = v; });
                nameInput = text.inputEl;
                text.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        const v = (nameInput?.value || title).trim();
                        if (v) {
                            e.preventDefault();
                            this.close();
                            this.callback(v);
                        }
                    }
                });
                window.setTimeout(() => { text.inputEl.focus(); text.inputEl.select(); }, 50);
            });

        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText(this.initialTitle ? 'Save' : 'Add')
                .setCta()
                .onClick(() => {
                    const v = (nameInput?.value || title).trim();
                    if (v) {
                        this.close();
                        this.callback(v);
                    }
                }));
    }
}

// ═══════════════════════════════════════════════════
//  Add a field to an existing custom section
// ═══════════════════════════════════════════════════

/**
 * Add / edit a field inside a custom section. Returns a partial
 * {@link CustomFieldDef} so callers can decide how to merge it with an
 * existing entry (rename vs. replace etc.).
 */
export class AddSectionFieldModal extends Modal {
    private callback: (result: CustomFieldDef | null) => void;
    private existing?: CustomFieldDef;

    constructor(
        app: App,
        callback: (result: CustomFieldDef | null) => void,
        existing?: CustomFieldDef,
    ) {
        super(app);
        this.callback = callback;
        this.existing = existing;
    }

    onOpen(): void {
        const isEdit = !!this.existing;
        this.titleEl.setText(isEdit ? 'Edit Field' : 'Add Field to Section');

        let name = this.existing?.name ?? '';
        let type: CustomFieldType = this.existing?.type ?? 'text';
        let placeholder = this.existing?.placeholder ?? '';
        let optionsCsv = (this.existing?.options ?? []).join(', ');
        let folderSource = this.existing?.folderSource ?? '';
        let topLevelKey = this.existing?.topLevelKey ?? '';
        let nameInput: HTMLInputElement | null = null;

        new Setting(this.contentEl)
            .setName('Field name')
            .addText(text => {
                text.setPlaceholder('E.g. The lie, the truth???');
                text.setValue(name);
                text.onChange(v => { name = v; });
                nameInput = text.inputEl;
                text.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        const v = (nameInput?.value || name).trim();
                        if (v) {
                            e.preventDefault();
                            this.submit();
                        }
                    }
                });
                window.setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(this.contentEl)
            .setName('Type')
            .setDesc('Pick the input type for this field.')
            .addDropdown(dd => {
                dd.addOption('text', 'Text');
                dd.addOption('textarea', 'Text block');
                dd.addOption('dropdown', 'Dropdown');
                dd.addOption('multi-select', 'Multi-select (tags)');
                dd.addOption('checkbox', 'Checkbox (yes/no)');
                dd.setValue(type);
                dd.onChange(v => {
                    type = v as CustomFieldType;
                    refreshOptionsRow();
                });
            });

        new Setting(this.contentEl)
            .setName('Placeholder')
            .setDesc('Hint text shown in empty inputs (optional).')
            .addText(t => {
                t.setPlaceholder('E.g. ???what does this character lie to themselves about????');
                t.setValue(placeholder);
                t.onChange(v => { placeholder = v; });
            });

        const optionsContainer = this.contentEl.createDiv();
        const refreshOptionsRow = () => {
            optionsContainer.empty();
            if (type !== 'dropdown' && type !== 'multi-select') return;
            new Setting(optionsContainer)
                .setName('Options')
                .setDesc('Comma-separated list of choices.')
                .addTextArea(ta => {
                    ta.setPlaceholder('Option 1, option 2, option 3');
                    ta.setValue(optionsCsv);
                    ta.onChange(v => { optionsCsv = v; });
                    ta.inputEl.rows = 2;
                });
            new Setting(optionsContainer)
                .setName('Folder source (optional)')
                .setDesc('Vault folder path whose note names become selectable options.')
                .addText(text => {
                    text.setPlaceholder('E.g. World/traits');
                    text.setValue(folderSource);
                    text.onChange(v => { folderSource = v.trim(); });
                });
        };
        refreshOptionsRow();

        new Setting(this.contentEl)
            .setName('Top-level key (optional)')
            .setDesc('When set, the field value is also mirrored to this top-level YAML key so it shows up in Obsidian properties, bases, and dataview. Reserved StoryLine keys are skipped automatically.')
            .addText(text => {
                text.setPlaceholder('E.g. Importance');
                text.setValue(topLevelKey);
                text.onChange(v => { topLevelKey = v.trim(); });
            });

        new Setting(this.contentEl)
            .addButton(btn => btn
                .setButtonText(isEdit ? 'Save' : 'Add')
                .setCta()
                .onClick(() => this.submit()));

        function buildResult(): CustomFieldDef | null {
            const finalName = (nameInput?.value || name).trim();
            if (!finalName) return null;
            const opts = (type === 'dropdown' || type === 'multi-select')
                ? optionsCsv.split(',').map(o => o.trim()).filter(Boolean)
                : undefined;
            const source = (type === 'dropdown' || type === 'multi-select') ? folderSource.trim() : '';
            return {
                name: finalName,
                type,
                placeholder: placeholder.trim() || undefined,
                options: opts && opts.length > 0 ? opts : undefined,
                folderSource: source || undefined,
                topLevelKey: topLevelKey.trim() || undefined,
            };
        }
        this.submit = () => {
            const result = buildResult();
            if (!result) {
                new Notice('Please enter a field name.');
                return;
            }
            this.close();
            this.callback(result);
        };
    }

    /** Replaced inside onOpen to capture modal form state at submit time. */
    private submit: () => void = () => {};
}
 
