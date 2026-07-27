export function requireInternalRoute(route: string): string {
    const normalizedRoute = String(route || '').trim();
    const containsControlCharacter = /[\u0000-\u001f\u007f]/.test(normalizedRoute);
    const startsWithProtocolRelativePrefix = normalizedRoute.startsWith('//');

    if (
        !normalizedRoute.startsWith('/')
        || startsWithProtocolRelativePrefix
        || normalizedRoute.includes('\\')
        || containsControlCharacter
    ) {
        throw new Error('Only normalized same-origin routes are allowed.');
    }

    return normalizedRoute;
}
