export type PublicRouteContract = {
    path: string;
    landmarkTestId: string;
    pitchOnly?: boolean;
    redirectsTo?: string;
};

export const PUBLIC_ROUTE_CONTRACT: readonly PublicRouteContract[] = [
    { path: '/', landmarkTestId: 'landing-main' },
    { path: '/login', landmarkTestId: 'login-page' },
    { path: '/privacy', landmarkTestId: 'privacy-page' },
    { path: '/terms', landmarkTestId: 'terms-page' },
    { path: '/promo', landmarkTestId: 'promo-page' },
    { path: '/promo-film', landmarkTestId: 'promo-film-page' },
    { path: '/landing-workshop', landmarkTestId: 'landing-workshop-hub' },
    { path: '/landing-workshop/remodel', landmarkTestId: 'landing-workshop-remodel' },
    { path: '/landing-workshop/industrial', landmarkTestId: 'landing-workshop-industrial' },
    { path: '/landing-workshop/enterprise', landmarkTestId: 'landing-workshop-enterprise' },
    { path: '/landing-workshop/terminal', landmarkTestId: 'landing-workshop-terminal' },
    { path: '/landing-workshop/story', landmarkTestId: 'landing-workshop-story' },
    { path: '/aetherguard-deck', landmarkTestId: 'pitch-deck', pitchOnly: true },
    {
        path: '/xiongcai-final',
        landmarkTestId: 'pitch-deck',
        pitchOnly: true,
        redirectsTo: '/aetherguard-deck',
    },
] as const;

export const DEFAULT_PUBLIC_ROUTE_CONTRACT = PUBLIC_ROUTE_CONTRACT.filter((route) => !route.pitchOnly);
export const PITCH_PUBLIC_ROUTE_CONTRACT = PUBLIC_ROUTE_CONTRACT.filter((route) => route.pitchOnly);
