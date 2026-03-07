const fs = require('fs');
const initSqlJs = require('sql.js');

async function run() {
    const SQL = await initSqlJs();
    const dbData = fs.readFileSync('newsecurity.db');
    const db = new SQL.Database(dbData);

    db.run("UPDATE users SET plan='starter' WHERE email='starter@test.com'");
    db.run("UPDATE users SET plan='professional' WHERE email='pro@test.com'");
    db.run("UPDATE users SET plan='enterprise' WHERE email='enterprise@test.com'");

    fs.writeFileSync('newsecurity.db', Buffer.from(db.export()));
    console.log("Database updated successfully");
}

run().catch(console.error);
