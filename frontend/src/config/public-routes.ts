export const SHOW_PITCH_ROUTES = import.meta.env.VITE_ENABLE_PITCH_ROUTES === 'true';

export const STANDALONE_ROUTES: ReadonlySet<string> = new Set([
    '/',
    '/login',
    '/privacy',
    '/terms',
    '/promo',
    '/promo-film',
    '/landing-workshop',
    '/landing-workshop/remodel',
    '/landing-workshop/industrial',
    '/landing-workshop/enterprise',
    '/landing-workshop/terminal',
    '/landing-workshop/story',
    ...(SHOW_PITCH_ROUTES ? ['/aetherguard-deck', '/xiongcai-final'] : []),
]);

export const isPublicStandaloneRoute = (pathname: string): boolean => STANDALONE_ROUTES.has(pathname);
