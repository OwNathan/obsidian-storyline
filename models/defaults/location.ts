/**
 * Default (locked) field catalog for locations.
 *
 * These sections/fields are immutable: they are always visible, cannot be
 * renamed, removed, hidden, reordered, or mirrored to the note body. All
 * other fields users need must be added as custom fields via the entity
 * template editor.
 *
 * `world` and `parent` are marked `special` because the Location view renders
 * them with dedicated dropdown widgets (see renderLocationHierarchy).
 */
import type { LocationFieldCategory } from '../Location';

export const DEFAULT_LOCATION_CATEGORIES: LocationFieldCategory[] = [
    {
        title: 'Overview',
        icon: 'map-pin',
        fields: [
            { key: 'name', label: 'Name', placeholder: 'Name of this location' },
            { key: 'locationType', label: 'Type', placeholder: 'City, building, wilderness, room…' },
        ],
    },
    {
        title: 'Connections',
        icon: 'link',
        fields: [
            { key: 'connectedLocations', label: 'Connected Locations', placeholder: 'Nearby or linked locations' },
        ],
    },
    {
        title: 'Hierarchy',
        icon: 'network',
        fields: [
            { key: 'world', label: 'World', placeholder: 'World this location belongs to', special: true },
            { key: 'parent', label: 'Parent Location', placeholder: 'Parent location — for nested hierarchy', special: true },
        ],
    },
    {
        title: 'Linking & Matching',
        icon: 'link',
        fields: [
            { key: 'entryType', label: 'Type', placeholder: 'Sub-type (e.g. Stronghold, Landmark, Region…)' },
            { key: 'aliases', label: 'Aliases', placeholder: 'Comma-separated alternative names that link to this location', multiline: true },
            { key: 'caseSensitive', label: 'Case-sensitive matching', placeholder: 'Off — match regardless of case', toggle: true },
            { key: 'excludeTerms', label: 'Exclude terms', placeholder: 'Comma-separated phrases that should NOT link here', multiline: true },
        ],
    },
];
