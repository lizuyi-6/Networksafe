export const API_BASE_URL = '/api';

export const fetchStats = async () => {
    const response = await fetch(`${API_BASE_URL}/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
};

export const fetchSites = async () => {
    const response = await fetch(`${API_BASE_URL}/sites`);
    if (!response.ok) throw new Error('Failed to fetch sites');
    return response.json();
};
