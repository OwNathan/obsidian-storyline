/**
 * Default (locked) field catalog for Codex entries — applied to every built-in
 * AND user-created codex category.
 *
 * These sections/fields are immutable: they are always visible, cannot be
 * renamed, removed, hidden, reordered, or mirrored to the note body. All
 * other fields users need must be added as custom fields via the entity
 * template editor.
 *
 * "Type" in Overview maps to the generic `kind` frontmatter key (mirrors the
 * per-category type fields like `orgType` / `itemType`). "Type" in Linking &
 * Matching maps to `entryType` (the sub-type badge shown in lists).
 */
import type { CodexFieldCategory } from '../Codex';

export const DEFAULT_CODEX_CATEGORIES: CodexFieldCategory[] = [
    {
        title: 'Overview',
        icon: 'file-text',
        fields: [
            { key: 'name', label: 'Name', placeholder: 'Name of this entry' },
            { key: 'kind', label: 'Type', placeholder: 'Guild, kingdom, cult, company…' },
        ],
    },
    {
        title: 'Linking & Matching',
        icon: 'link',
        fields: [
            { key: 'entryType', label: 'Type', placeholder: 'Sub-type (e.g. Sword, Potion, Legend…)' },
            { key: 'aliases', label: 'Aliases', placeholder: 'Comma-separated alternative names that link to this entry', multiline: true },
            { key: 'caseSensitive', label: 'Case-sensitive matching', placeholder: 'Off — match regardless of case', toggle: true },
            { key: 'excludeTerms', label: 'Exclude terms', placeholder: 'Comma-separated phrases that should NOT link here (e.g. "Dawnguard Saint")', multiline: true },
        ],
    },
];
