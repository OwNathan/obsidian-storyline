 
/**
 * Renders a single Comment as a clickable capsule (pill).
 */
export function renderCommentCapsule(
    container: HTMLElement,
    title: string,
    status: string,
    filePath: string,
    onClick: (filePath: string) => void,
): HTMLElement {
    const capsule = container.createSpan({
        cls: 'sl-comment-capsule',
        attr: { 'data-status': status.toLowerCase() },
    });

    const dot = capsule.createSpan({ cls: 'sl-comment-capsule-dot' });
    dot.style.backgroundColor = status.toLowerCase() === 'open'
        ? 'var(--sl-status-outlined, #2196F3)'
        : status.toLowerCase() === 'resolved'
            ? 'var(--sl-status-written, #4CAF50)'
            : 'var(--sl-status-final, #F44336)';

    capsule.createSpan({ cls: 'sl-comment-capsule-title', text: title });

    capsule.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(filePath);
    });

    return capsule;
}
