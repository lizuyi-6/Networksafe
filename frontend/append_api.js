const fs = require('fs');
const content = `
export const fetchAdminUsersList = async () => {
    const response = await fetchWithCredentials(\`\${API_BASE_URL}/admin/users\`);
    if (!response.ok) throw new Error('Failed to fetch admin users');
    return response.json();
};

export const updateAdminUserPlan = async (userId: string, plan: string) => {
    const response = await fetchWithCredentials(\`\${API_BASE_URL}/admin/users/\${userId}/plan\`, {
        method: 'PUT',
        body: JSON.stringify({ plan })
    });
    if (!response.ok) throw new Error('Failed to update plan');
    return response.json();
};

export const updateAdminUserRole = async (userId: string, role: string) => {
    const response = await fetchWithCredentials(\`\${API_BASE_URL}/admin/users/\${userId}/role\`, {
        method: 'PUT',
        body: JSON.stringify({ role })
    });
    if (!response.ok) throw new Error('Failed to update role');
    return response.json();
};

export const updateAdminUserStatus = async (userId: string, status: string) => {
    const response = await fetchWithCredentials(\`\${API_BASE_URL}/admin/users/\${userId}/status\`, {
        method: 'PUT',
        body: JSON.stringify({ status })
    });
    if (!response.ok) throw new Error('Failed to update status');
    return response.json();
};
`;
fs.appendFileSync('src/services/api.ts', content);
console.log('Appended to api.ts');
