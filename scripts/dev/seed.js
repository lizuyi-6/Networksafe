const fetch = require('node-fetch');

async function register(email, username, password) {
    const res = await fetch('http://localhost:3005/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password })
    });
    const data = await res.json();
    console.log('Registered', email, res.status);
}

async function run() {
    await register('tenant_test@AetherGuard.local', 'TenantTest', 'Password123!');
    await register('admin_test@AetherGuard.local', 'AdminTest', 'Password123!');
}

run();
