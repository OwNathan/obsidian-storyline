/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
import { Modal, Notice } from 'obsidian';
import type SceneCardsPlugin from '../../main';
import type { DynamicNarrativeManager } from '../services/DynamicNarrativeManager';

export class DNUpdateBodyModal extends Modal {
    private plugin: SceneCardsPlugin;
    private manager: DynamicNarrativeManager;

    private progressFillEl: HTMLElement | null = null;
    private progressLabelEl: HTMLElement | null = null;

    constructor(plugin: SceneCardsPlugin, manager: DynamicNarrativeManager) {
        super(plugin.app);
        this.plugin = plugin;
        this.manager = manager;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dn-update-body-modal');

        contentEl.createEl('h3', { text: 'Update Notes Body' });
        contentEl.createEl('p', {
            text: 'Reflecting plugin data into note bodies...',
            cls: 'dn-update-body-hint',
        });

        const track = contentEl.createDiv('dn-progress-track');
        this.progressFillEl = track.createDiv('dn-progress-fill');

        this.progressLabelEl = contentEl.createDiv('dn-progress-label');
        this.progressLabelEl.setText('0 / 0');

        this.run();
    }

    private async run(): Promise<void> {
        const total = this.countDirty();
        this.updateProgress(0, total);
        if (total === 0) {
            new Notice('Updated 0 entities');
            this.close();
            return;
        }
        const updated = await this.manager.syncAllDirtyBodies((done, count) => {
            this.updateProgress(done, count);
        });
        new Notice(`Updated ${updated} entities`);
        this.close();
    }

    private countDirty(): number {
        let count = 0;
        for (const entityType of ['scenario', 'objective-type', 'objective-variant', 'arc-type', 'arc-variant', 'quest'] as const) {
            for (const entity of this.manager.getEntities(entityType)) {
                if (entity.dirty === true) count++;
            }
        }
        return count;
    }

    private updateProgress(done: number, total: number): void {
        if (this.progressFillEl) {
            this.progressFillEl.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '100%';
        }
        if (this.progressLabelEl) {
            this.progressLabelEl.setText(`${done} / ${total}`);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
