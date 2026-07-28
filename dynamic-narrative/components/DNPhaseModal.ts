/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
import { Modal, App } from 'obsidian';
import type { DNPhase } from '../models/types';
import { isDefaultPhase } from '../models/types';

export class DNPhaseModal extends Modal {
    private phase: DNPhase | null;
    private onSubmit: (phase: DNPhase) => void;
    private isEdit: boolean;

    private nameValue = '';
    private descValue = '';
    private startCondValue = '';
    private endCondValue = '';
    private startCmdValue = '';
    private endCmdValue = '';

    constructor(app: App, phase: DNPhase | null, onSubmit: (phase: DNPhase) => void) {
        super(app);
        this.phase = phase;
        this.onSubmit = onSubmit;
        this.isEdit = phase !== null;

        if (phase) {
            this.nameValue = phase.name;
            this.descValue = phase.description;
            this.startCondValue = phase.startConditions;
            this.endCondValue = phase.endConditions;
            this.startCmdValue = phase.startCommands;
            this.endCmdValue = phase.endCommands;
        }
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dn-phase-modal');

        const title = this.isEdit ? 'Edit phase' : 'Add custom phase';
        contentEl.createEl('h3', { text: title });

        const form = contentEl.createDiv('dn-phase-modal-form');

        const nameField = form.createDiv('dn-modal-field');
        nameField.createEl('label', { text: 'Name', cls: 'dn-modal-label' });
        const nameInput = nameField.createEl('input', { type: 'text', cls: 'dn-modal-input' });
        nameInput.value = this.nameValue;
        nameInput.placeholder = 'Phase name...';
        if (this.isEdit && this.phase && isDefaultPhase(this.phase.name)) {
            nameInput.disabled = true;
            nameInput.addClass('dn-modal-input-disabled');
        }
        nameInput.addEventListener('input', () => {
            this.nameValue = nameInput.value;
        });

        const descField = form.createDiv('dn-modal-field');
        descField.createEl('label', { text: 'Description', cls: 'dn-modal-label' });
        const descInput = descField.createEl('textarea', { cls: 'dn-modal-textarea' });
        descInput.value = this.descValue;
        descInput.placeholder = 'Phase description...';
        descInput.addEventListener('input', () => {
            this.descValue = descInput.value;
        });

        const startCondField = form.createDiv('dn-modal-field');
        startCondField.createEl('label', { text: 'Start conditions', cls: 'dn-modal-label' });
        const startCondInput = startCondField.createEl('textarea', { cls: 'dn-modal-textarea' });
        startCondInput.value = this.startCondValue;
        startCondInput.placeholder = 'Conditions to enter this phase...';
        startCondInput.addEventListener('input', () => {
            this.startCondValue = startCondInput.value;
        });

        const endCondField = form.createDiv('dn-modal-field');
        endCondField.createEl('label', { text: 'End conditions', cls: 'dn-modal-label' });
        const endCondInput = endCondField.createEl('textarea', { cls: 'dn-modal-textarea' });
        endCondInput.value = this.endCondValue;
        endCondInput.placeholder = 'Conditions to exit this phase...';
        endCondInput.addEventListener('input', () => {
            this.endCondValue = endCondInput.value;
        });

        const startCmdField = form.createDiv('dn-modal-field');
        startCmdField.createEl('label', { text: 'Start commands', cls: 'dn-modal-label' });
        const startCmdInput = startCmdField.createEl('textarea', { cls: 'dn-modal-textarea' });
        startCmdInput.value = this.startCmdValue;
        startCmdInput.placeholder = 'Commands executed on phase start...';
        startCmdInput.addEventListener('input', () => {
            this.startCmdValue = startCmdInput.value;
        });

        const endCmdField = form.createDiv('dn-modal-field');
        endCmdField.createEl('label', { text: 'End commands', cls: 'dn-modal-label' });
        const endCmdInput = endCmdField.createEl('textarea', { cls: 'dn-modal-textarea' });
        endCmdInput.value = this.endCmdValue;
        endCmdInput.placeholder = 'Commands executed on phase end...';
        endCmdInput.addEventListener('input', () => {
            this.endCmdValue = endCmdInput.value;
        });

        const actions = contentEl.createDiv('dn-modal-actions');
        const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'dn-modal-cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = actions.createEl('button', {
            text: this.isEdit ? 'Save' : 'Add',
            cls: 'dn-modal-submit mod-cta',
        });
        submitBtn.addEventListener('click', () => {
            if (!this.nameValue.trim()) {
                nameInput.addClass('has-error');
                return;
            }
            const result: DNPhase = {
                name: this.nameValue.trim(),
                description: this.descValue.trim(),
                startConditions: this.startCondValue.trim(),
                endConditions: this.endCondValue.trim(),
                startCommands: this.startCmdValue.trim(),
                endCommands: this.endCmdValue.trim(),
                isDefault: this.phase ? this.phase.isDefault : false,
                overrides: this.phase ? this.phase.overrides : [],
            };
            this.onSubmit(result);
            this.close();
        });

        nameInput.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unused-vars, no-unused-vars, no-useless-escape, no-control-regex, no-empty */
