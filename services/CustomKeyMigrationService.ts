/**
 * Vault-wide composite-key remigration for entity-template custom sections.
 *
 * Custom-section field values live in each entity's `custom` map under a
 * composite key `${sectionTitle} :: ${fieldName}`. When a section or field is
 * renamed (or deleted) in one subcategory, the renderer migrates only the
 * currently-edited entity's `custom` map inline. This service sweeps every
 * *other* entity of the same type in the affected subcategories so the old
 * keys are moved (or removed) and no value is silently orphaned.
 *
 * Mirrors the pattern used by {@link CascadeRenameService}: iterate the
 * manager's full entity list, mutate `custom`, and save through the manager.
 */
import { CharacterManager } from './CharacterManager';
import { LocationManager } from './LocationManager';
import { SceneManager } from './SceneManager';
import { CodexManager } from './CodexManager';
import { codexIdFromEntityType } from '../models/EntityTemplate';
import type { Character } from '../models/Character';
import type { StoryWorld, StoryLocation } from '../models/Location';
import type { CodexEntry } from '../models/Codex';

/** One composite-key migration: move `oldKey` → `newKey` (or delete it). */
export interface CustomKeyMigrationOp {
    oldKey: string;
    /** When set, the value moves from `oldKey` to `newKey`. When omitted, `oldKey` is removed. */
    newKey?: string;
}

/** Minimal entity shape shared by every migratable model. */
interface MigratableEntity {
    filePath: string;
    templateSubcategory?: string;
    custom?: Record<string, string>;
}

export class CustomKeyMigrationService {
    constructor(
        private sceneManager: SceneManager,
        private characterManager: CharacterManager,
        private locationManager: LocationManager,
        private codexManager: CodexManager,
    ) {}

    /**
     * Apply `ops` to every entity of `entityType` whose subcategory is in
     * `affectedSubcategories`. An empty list means "base only" (entities with
     * no subcategory set). Skips `excludeFilePath` (the entity already
     * migrated inline by the renderer). Returns the number of entities saved.
     */
    async remigrateCustomKeys(
        entityType: string,
        ops: CustomKeyMigrationOp[],
        affectedSubcategories: string[],
        excludeFilePath?: string,
    ): Promise<number> {
        if (ops.length === 0) return 0;

        const scope = new Set(affectedSubcategories.map(s => s.trim()).filter(Boolean));
        const baseOnly = scope.size === 0;

        let updated = 0;
        for (const entity of this.resolveEntities(entityType)) {
            if (excludeFilePath && entity.filePath === excludeFilePath) continue;

            const sub = entity.templateSubcategory;
            const isBase = !sub || !sub.trim();
            if (baseOnly ? !isBase : !scope.has(sub ?? '')) continue;

            const custom = entity.custom;
            if (!custom) continue;

            let dirty = false;
            for (const op of ops) {
                if (!(op.oldKey in custom)) continue;
                if (op.newKey && op.newKey !== op.oldKey) {
                    custom[op.newKey] = custom[op.oldKey];
                }
                delete custom[op.oldKey];
                dirty = true;
            }
            if (!dirty) continue;

            await this.save(entityType, entity);
            updated++;
        }
        return updated;
    }

    private resolveEntities(entityType: string): MigratableEntity[] {
        switch (entityType) {
            case 'scene':
                return this.sceneManager.getAllScenes();
            case 'character':
                return this.characterManager.getAllCharacters();
            case 'world':
                return this.locationManager.getAllWorlds();
            case 'location':
                return this.locationManager.getAllLocations();
            default: {
                const categoryId = codexIdFromEntityType(entityType);
                if (categoryId === undefined) return [];
                return this.codexManager.getAllEntries().filter(e => e.type === categoryId);
            }
        }
    }

    private async save(entityType: string, entity: MigratableEntity): Promise<void> {
        switch (entityType) {
            case 'scene':
                await this.sceneManager.updateScene(entity.filePath, { custom: entity.custom });
                break;
            case 'character':
                await this.characterManager.saveCharacter(entity as Character);
                break;
            case 'world':
                await this.locationManager.saveWorld(entity as StoryWorld);
                break;
            case 'location':
                await this.locationManager.saveLocation(entity as StoryLocation);
                break;
            default:
                await this.codexManager.saveEntry(entity as CodexEntry);
                break;
        }
    }
}
