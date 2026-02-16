const bcrypt = require('/app/backend/node_modules/bcryptjs');
const hash = '$2a$12$jyEw8mYR8PupPsnJsu5PjeyKETMJmSHKNK3Iv0pNtV3qiFWXcOm.C';
console.log('compare', bcrypt.compareSync('FluxGuard@123456', hash));
