/**
 * Default (locked) field catalog for characters.
 *
 * These sections/fields are immutable: they are always visible, cannot be
 * renamed, removed, hidden, reordered, or mirrored to the note body. All
 * other fields users need must be added as custom fields via the entity
 * template editor.
 */
import type { CharacterFieldCategory } from '../Character';

export const DEFAULT_CHARACTER_CATEGORIES: CharacterFieldCategory[] = [
    {
        title: 'Basic Information',
        icon: 'user',
        fields: [
            { key: 'name', label: 'Name', placeholder: 'Full name of the character' },
            { key: 'tagline', label: 'Tagline', placeholder: 'Choose which field to show on the card' },
            { key: 'age', label: 'Age', placeholder: 'Date of birth, current life stage' },
            { key: 'role', label: 'Role in Story', placeholder: 'Protagonist, antagonist, mentor, sidekick…' },
            { key: 'occupation', label: 'Occupation', placeholder: 'Current job, income level, career history' },
            { key: 'personality', label: 'Personality', placeholder: 'Three to five words to describe them' },
            { key: 'relations', label: 'Relations', placeholder: 'Add relation rows by category and type' },
        ],
    },
    {
        title: 'Linking & Matching',
        icon: 'link',
        fields: [
            { key: 'entryType', label: 'Type', placeholder: 'Sub-type (e.g. Antagonist, Mentor, Deuteragonist…)' },
            { key: 'aliases', label: 'Aliases', placeholder: 'Comma-separated alternative names that link to this character', multiline: true },
            { key: 'caseSensitive', label: 'Case-sensitive matching', placeholder: 'Off — match regardless of case', toggle: true },
            { key: 'excludeTerms', label: 'Exclude terms', placeholder: 'Comma-separated phrases that should NOT link here (e.g. "Saint John")', multiline: true },
        ],
    },
];
