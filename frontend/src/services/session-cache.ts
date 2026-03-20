export type SessionUserIdentity = {
    userId?: string;
    email?: string;
    username?: string;
};

const SESSION_USER_KEY = 'aetherguard:session-user';

function readSessionStorage(): Storage | null {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

export const normalizeSessionUserKey = (value?: string | null): string | null => {
    const normalized = value?.trim().toLowerCase();
    return normalized || null;
};

export const setSessionUserIdentity = (user: SessionUserIdentity | null): void => {
    const storage = readSessionStorage();
    if (!storage) {
        return;
    }

    if (!user) {
        storage.removeItem(SESSION_USER_KEY);
        return;
    }

    storage.setItem(SESSION_USER_KEY, JSON.stringify(user));
};

export const getSessionUserIdentity = (): SessionUserIdentity | null => {
    const storage = readSessionStorage();
    if (!storage) {
        return null;
    }

    const raw = storage.getItem(SESSION_USER_KEY);
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as SessionUserIdentity;
    } catch {
        storage.removeItem(SESSION_USER_KEY);
        return null;
    }
};

export const getSessionUserKey = (): string | null => {
    const user = getSessionUserIdentity();
    return normalizeSessionUserKey(user?.email || user?.userId || user?.username || null);
};
