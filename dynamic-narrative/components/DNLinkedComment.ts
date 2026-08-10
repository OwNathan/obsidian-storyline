/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unused-vars, no-unused-vars -- Obsidian's DOM event handlers are intentionally callback-driven */
import { App, setIcon } from 'obsidian';
import { attachTooltip } from '../../components/Tooltip';
import { DNCommentModal } from './DNCommentModal';

export function renderDNLinkedComment(
    container: HTMLElement,
    titleRow: HTMLElement,
    app: App,
    comment: string | undefined,
    onSave: (comment: string) => Promise<void> | void,
): void {
    const hasComment = Boolean(comment?.trim());
    const commentBtn = titleRow.createEl('button', {
        cls: 'dn-linked-comment-btn dn-card-comment-btn dn-inspector-linked-action-btn',
        attr: {
            type: 'button',
            'aria-label': hasComment ? 'Edit linked entity comment' : 'Add linked entity comment',
            title: hasComment ? 'Edit comment' : 'Add comment',
        },
    });
    setIcon(commentBtn, 'message-square');
    if (hasComment) commentBtn.addClass('has-comment');

    // Keep the full text in the tooltip while the card only reserves one line.
    if (hasComment && comment) {
        const preview = container.createDiv('dn-linked-comment');
        preview.setText(comment);
        attachTooltip(preview, comment);
    }

    commentBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        new DNCommentModal(app, comment ?? '', onSave).open();
    });
}

/* eslint-enable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unused-vars, no-unused-vars */
