/**
 * Default (locked) field catalog for worlds.
 *
 * These sections/fields are immutable: they are always visible, cannot be
 * renamed, removed, hidden, reordered, or mirrored to the note body. All
 * other fields users need must be added as custom fields via the entity
 * template editor.
 */
import type { LocationFieldCategory } from '../Location';

export const DEFAULT_WORLD_CATEGORIES: LocationFieldCategory[] = [
    {
        title: 'Overview',
        icon: 'globe',
        fields: [
            { key: 'name', label: 'Name', placeholder: 'Name of the world or setting' },
        ],
    },
    {
        title: 'Linking & Matching',
        icon: 'link',
        fields: [
            { key: 'entryType', label: 'Type', placeholder: 'Sub-type (e.g. Setting, Realm, Plane…)' },
            { key: 'aliases', label: 'Aliases', placeholder: 'Comma-separated alternative names that link to this world', multiline: true },
            { key: 'caseSensitive', label: 'Case-sensitive matching', placeholder: 'Off — match regardless of case', toggle: true },
            { key: 'excludeTerms', label: 'Exclude terms', placeholder: 'Comma-separated phrases that should NOT link here', multiline: true },
        ],
    },
];
