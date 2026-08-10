export const DN_CATEGORY_COLOR_CLASSES = 8;

export function getCategoryColorClass(category: string, categories: string[]): string {
    const sorted = [...new Set(categories)].sort((a, b) => a.localeCompare(b));
    const index = sorted.indexOf(category);
    const bucket = index >= 0 ? index : hashFallback(category);
    return `dn-cat-color-${bucket % DN_CATEGORY_COLOR_CLASSES}`;
}

function hashFallback(category: string): number {
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
        hash = ((hash << 5) - hash + category.charCodeAt(i)) >>> 0;
    }
    return hash;
}
