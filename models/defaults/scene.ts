/**
 * Default (locked) field catalog for scenes.
 *
 * Every scene default is rendered by a dedicated widget in the Scene
 * Inspector (title input, Act/Chapter/Sequence row, status & category
 * dropdowns, arc-point toggle, tag pills, entity link pills, codex sidebar
 * sections). All of them are marked `special` so the template system knows
 * they exist (for the template editor) but never renders a plain input.
 *
 * Both default sections accept custom fields added by the user.
 */
import type { DefaultSectionDef } from '../EntityTemplate';

export const DEFAULT_SCENE_SECTIONS: DefaultSectionDef[] = [
    {
        title: 'General',
        icon: 'settings-2',
        fields: [
            { key: 'title', label: 'Name', placeholder: 'Scene title', special: true },
            { key: 'subtitle', label: 'Description/Subtitle', placeholder: 'Subtitle (optional)', special: true },
            { key: 'act', label: 'Act + Chapter + Sequence', placeholder: 'Story position', special: true },
            { key: 'status', label: 'Status', placeholder: 'Completion status', special: true },
            { key: 'category', label: 'Category', placeholder: 'Scene category', special: true },
            { key: 'arcAnchor', label: 'Arc Point Toggle', placeholder: 'Key turning point', special: true },
            { key: 'tags', label: 'Plotlines/Tags', placeholder: 'Plotline tags', special: true },
        ],
    },
    {
        title: 'Connected Entities',
        icon: 'link-2',
        fields: [
            { key: 'characters', label: 'Characters', placeholder: 'Characters present', special: true },
            { key: 'locations', label: 'Locations', placeholder: 'Locations linked', special: true },
            { key: 'scenarios', label: 'Scenarios', placeholder: 'Dynamic-narrative scenarios', special: true },
            { key: 'codexLinks', label: 'Codex Entities', placeholder: 'Linked codex entries per category', special: true },
        ],
    },
];
