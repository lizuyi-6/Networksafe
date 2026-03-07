const fs = require('fs');
const initSqlJs = require('sql.js');

async function run() {
    const SQL = await initSqlJs();
    const dbData = fs.readFileSync('newsecurity.db');
    const db = new SQL.Database(dbData);

    try {
        db.run("UPDATE users SET plan='starter' WHERE email='starter@test.com'");
        console.log('Starter Updated');
    } catch (e) { }

    try {
        db.run("UPDATE users SET plan='professional' WHERE email='pro@test.com'");
        console.log('Pro Updated');
    } catch (e) { }

    // Create enterprise if missing
    const e = db.exec("SELECT * FROM users WHERE email='enterprise@test.com'");
    if (e.length === 0) {
        db.run("INSERT INTO users (id, email, username, password_hash, role, plan, tenant_id, created_at) VALUES ('usr-ent-1', 'enterprise@test.com', 'Enterprise Plan', '$2a$12$R.S2C/.WjV6U2gKj0HnQMeQo4Z3Y0l7lJ10G9LgG2xO5O/', 'tenant', 'enterprise', 'tenant-1', datetime('now'))");
        console.log('Enterprise Inserted');
    } else {
        db.run("UPDATE users SET plan='enterprise', password_hash='$2a$12$R.S2C/.WjV6U2gKj0HnQMeQo4Z3Y0l7lJ10G9LgG2xO5O/' WHERE email='enterprise@test.com'");
        console.log('Enterprise Updated');
    }

    fs.writeFileSync('newsecurity.db', Buffer.from(db.export()));
    console.log("Database updated successfully");
}

run().catch(console.error);
