const fs = require('fs');
let c = fs.readFileSync('src/middleware/auth.middleware.ts', 'utf8');

c = c.replace(/role: 'admin' \| 'tenant' \| 'viewer';\r?\n\s*tenantId\?: string;/g, "role: 'admin' | 'tenant' | 'viewer';\n    plan?: 'starter' | 'pro' | 'ultra';\n    tenantId?: string;");

c = c.replace(/username: 'API Client',\r?\n\s*role: 'tenant'\r?\n\s*\};/g, "username: 'API Client',\n        role: 'tenant',\n        plan: 'ultra'\n    };");

fs.writeFileSync('src/middleware/auth.middleware.ts', c);
console.log('Fixed auth middleware');
