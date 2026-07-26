import { PUBLIC_ROUTE_CONTRACT } from './public-route-contract';

export const SHOW_PITCH_ROUTES = import.meta.env.VITE_ENABLE_PITCH_ROUTES === 'true';

export const STANDALONE_ROUTES: ReadonlySet<string> = new Set(
    PUBLIC_ROUTE_CONTRACT
        .filter((route) => !route.pitchOnly || SHOW_PITCH_ROUTES)
        .map((route) => route.path),
);

export const isPublicStandaloneRoute = (pathname: string): boolean => STANDALONE_ROUTES.has(pathname);
