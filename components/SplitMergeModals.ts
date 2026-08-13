 
import { Modal, Setting, Notice } from 'obsidian';
import type SceneCardsPlugin from '../main';
import { BUILTIN_STATUS_CONFIG, Scene, SceneStatus, getStatusOrder } from '../models/Scene';

// ────────────────────────────────────────────────────────
//  Split Scene Modal
// ────────────────────────────────────────────────────────

/**
 * Modal that lets the user provide titles for the two resulting scenes
 * when splitting a scene (metadata is copied, no body text is involved).
 */
export class SplitSceneModal extends Modal {
    private plugin: SceneCardsPlugin;
    private scene: Scene;
    private onDone: () => void;

    private titleA: string;
    private titleB: string;

    constructor(plugin: SceneCardsPlugin, scene: Scene, onDone: () => void) {
        super(plugin.app);
        this.plugin = plugin;
        this.scene = scene;
        this.onDone = onDone;
        this.titleA = scene.title || 'Untitled';
        this.titleB = `${scene.title || 'Untitled'} (part 2)`;
    }

    onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText('Split scene');
        contentEl.addClass('storyline-split-modal');

        // Info
        contentEl.createEl('p', {
            text: 'The new scene inherits all metadata from the original and gets the next sequence number.',
            cls: 'setting-item-description',
        });

        // Titles
        new Setting(contentEl)
            .setName('Scene a title')
            .addText(text => {
                text.setValue(this.titleA);
                text.onChange(v => (this.titleA = v));
            });
        new Setting(contentEl)
            .setName('Scene b title')
            .addText(text => {
                text.setValue(this.titleB);
                text.onChange(v => (this.titleB = v));
            });

        // Buttons
        new Setting(contentEl)
            .addButton(btn => {
                btn.setButtonText('Split').setCta().onClick(async () => {
                    try {
                        await this.plugin.sceneManager.splitScene(
                            this.scene.filePath,
                            this.titleA.trim() || undefined,
                            this.titleB.trim() || undefined,
                        );
                        this.close();
                        this.onDone();
                    } catch (err) {
                        new Notice('Split failed: ' + String(err));
                    }
                });
            })
            .addButton(btn => {
                btn.setButtonText('Cancel').onClick(() => this.close());
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

// ────────────────────────────────────────────────────────
//  Merge Scenes Modal
// ────────────────────────────────────────────────────────

/**
 * Modal that shows a preview of merging 2+ scenes, highlighting
 * metadata conflicts and letting the user confirm or adjust the title.
 */
export class MergeSceneModal extends Modal {
    private plugin: SceneCardsPlugin;
    private scenes: Scene[];
    private onDone: () => void;
    private mergedTitle: string;

    constructor(plugin: SceneCardsPlugin, scenes: Scene[], onDone: () => void) {
        super(plugin.app);
        this.plugin = plugin;
        this.scenes = scenes;
        this.onDone = onDone;
        this.mergedTitle = scenes[0]?.title || 'Merged Scene';
    }

    onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText('Merge scenes');
        contentEl.addClass('storyline-merge-modal');

        if (this.scenes.length < 2) {
            contentEl.createEl('p', { text: 'Select at least 2 scenes to merge.' });
            new Setting(contentEl).addButton(btn =>
                btn.setButtonText('Close').onClick(() => this.close())
            );
            return;
        }

        // List scenes being merged
        contentEl.createEl('p', {
            text: `Merging ${this.scenes.length} scenes (in sequence order). The first scene's file will be kept.`,
            cls: 'setting-item-description',
        });

        const list = contentEl.createEl('ol', { cls: 'storyline-merge-scene-list' });
        for (const s of this.scenes) {
            const li = list.createEl('li');
            li.createEl('strong', { text: s.title || 'Untitled' });
            li.createSpan({ text: ` — status: ${BUILTIN_STATUS_CONFIG[s.status as SceneStatus]?.label || s.status}` });
        }

        // Title
        new Setting(contentEl)
            .setName('Merged scene title')
            .addText(text => {
                text.setValue(this.mergedTitle);
                text.onChange(v => (this.mergedTitle = v));
            });

        // Metadata conflict preview
        const conflicts = this.detectConflicts();
        if (conflicts.length > 0) {
            const conflictSection = contentEl.createDiv('storyline-merge-conflicts');
            conflictSection.createEl('h4', { text: 'Metadata differences (will be resolved automatically):' });
            const ul = conflictSection.createEl('ul');
            for (const c of conflicts) {
                ul.createEl('li', { text: c });
            }
        }

        // Buttons
        new Setting(contentEl)
            .addButton(btn => {
                btn.setButtonText('Merge').setCta().onClick(async () => {
                    try {
                        const paths = this.scenes.map(s => s.filePath);
                        await this.plugin.sceneManager.mergeScenes(paths, this.mergedTitle.trim() || undefined);
                        this.close();
                        this.onDone();
                    } catch (err) {
                        new Notice('Merge failed: ' + String(err));
                    }
                });
            })
            .addButton(btn => {
                btn.setButtonText('Cancel').onClick(() => this.close());
            });
    }

    /**
     * Detect any metadata differences between the scenes being merged
     * and describe how they'll be resolved.
     */
    private detectConflicts(): string[] {
        const conflicts: string[] = [];
        const scenes = this.scenes;
        const primary = scenes[0];

        // Locations
        const locs = [...new Set(scenes.flatMap(s => s.locations || []))];
        if (locs.length > 1) {
            conflicts.push(`Locations differ (${locs.join(', ')}) → combining all of them`);
        }

        // Characters
        const chars = [...new Set(scenes.flatMap(s => s.characters || []))];
        if (chars.length > 1) {
            conflicts.push(`Characters differ (${chars.join(', ')}) → combining all of them`);
        }

        // Status
        const statuses = [...new Set(scenes.map(s => s.status).filter(Boolean))];
        if (statuses.length > 1) {
            const statusOrder = getStatusOrder();
            const lowest = statuses.reduce((lo, s) => {
                const iC = statusOrder.indexOf(s as SceneStatus);
                const iL = statusOrder.indexOf(lo as SceneStatus);
                return (iC === -1 ? 99 : iC) < (iL === -1 ? 99 : iL) ? s : lo;
            });
            conflicts.push(`Status differs (${statuses.join(', ')}) → using lowest: "${lowest}"`);
        }

        // Act
        const acts = [...new Set(scenes.map(s => s.act).filter(a => a !== undefined))];
        if (acts.length > 1) {
            conflicts.push(`Acts differ (${acts.join(', ')}) → keeping ${primary.act}`);
        }

        // Chapter
        const chapters = [...new Set(scenes.map(s => s.chapter).filter(c => c !== undefined))];
        if (chapters.length > 1) {
            conflicts.push(`Chapters differ (${chapters.join(', ')}) → keeping Chapter ${primary.chapter}`);
        }

        return conflicts;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
