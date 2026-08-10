 
/**
 * Comment model — user-authored notes attached to StoryLine entities.
 *
 * Stored as .md files in {project}/Comments/ with YAML frontmatter.
 * One comment links to exactly one entity file (1:1).
 */

export type CommentCategory =
    | 'scene'
    | 'character'
    | 'location'
    | 'codex'
    | 'scenario'
    | 'objective'
    | 'arc'
    | 'quest'
    | 'research';

export interface Comment {
    /** Vault-relative path of the comment .md file */
    filePath: string;
    /** Display title (also used as filename stem, sanitised) */
    title: string;
    /** Free-form markdown body */
    body: string;
    /** Status string — default "Open" */
    status: string;
    /** Mirrors the related entity's type for filtering */
    category: CommentCategory;
    /** Vault-relative path of the linked entity .md file */
    relatedFile: string;
    /** Display title of the related file (for the modal's read-only field) */
    relatedName: string;
    /** Created date (ISO, drives default board sort) */
    created: string;
    /** Modified date (ISO) */
    modified: string;
    /** Allow extra frontmatter keys to survive round-trips */
    [key: string]: unknown;
}
