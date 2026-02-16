/**
 * Vulnerable Test Application
 * WARNING: This app is INTENTIONALLY vulnerable for security testing
 * DO NOT deploy in production!
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        password TEXT,
        email TEXT,
        role TEXT
    )`);
    
    db.run(`CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT,
        price REAL,
        description TEXT
    )`);

    const stmt = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)');
    stmt.run(1, 'admin', 'supersecret123', 'admin@example.com', 'admin');
    stmt.run(2, 'user1', 'password123', 'user1@example.com', 'user');
    stmt.run(3, 'user2', 'letmein', 'user2@example.com', 'user');
    stmt.finalize();

    const productStmt = db.prepare('INSERT INTO products VALUES (?, ?, ?, ?)');
    productStmt.run(1, 'Laptop', 999.99, 'High performance laptop');
    productStmt.run(2, 'Phone', 699.99, 'Smartphone with great camera');
    productStmt.run(3, 'Tablet', 399.99, 'Portable tablet device');
    productStmt.finalize();
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>VulnShop - Test Application</title>
            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                h1 { color: #e74c3c; }
                .warning { background: #ffe6e6; border: 2px solid #e74c3c; padding: 15px; border-radius: 5px; }
                .vuln-link { display: inline-block; margin: 10px; padding: 10px 20px; 
                            background: #3498db; color: white; text-decoration: none; border-radius: 5px; }
                .vuln-link:hover { background: #2980b9; }
                code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
            </style>
        </head>
        <body>
            <h1>🛒 VulnShop - Vulnerable Test Application</h1>
            <div class="warning">
                <strong>⚠️ WARNING:</strong> This application is intentionally vulnerable!
                Only use for security testing in isolated environments.
            </div>
            
            <h2>Available Vulnerable Endpoints:</h2>
            
            <h3>1. SQL Injection</h3>
            <a href="/login" class="vuln-link">Login Page</a>
            <a href="/search" class="vuln-link">Product Search</a>
            <p>Try: <code>' OR '1'='1</code> or <code>admin'--</code></p>
            
            <h3>2. Cross-Site Scripting (XSS)</h3>
            <a href="/comment" class="vuln-link">Comments</a>
            <a href="/profile" class="vuln-link">User Profile</a>
            <p>Try: <code>&lt;script&gt;alert('XSS')&lt;/script&gt;</code></p>
            
            <h3>3. Path Traversal</h3>
            <a href="/file?name=readme.txt" class="vuln-link">File Viewer</a>
            <p>Try: <code>../../../etc/passwd</code></p>
            
            <h3>4. Command Injection</h3>
            <a href="/ping" class="vuln-link">Network Tools</a>
            <p>Try: <code>127.0.0.1; cat /etc/passwd</code></p>
            
            <h3>5. API Endpoints</h3>
            <a href="/api/users" class="vuln-link">User API</a>
            <a href="/api/products" class="vuln-link">Product API</a>
        </body>
        </html>
    `);
});

app.get('/login', (req, res) => {
    res.send(`
        <h2>Login (SQL Injection Vulnerable)</h2>
        <form method="POST" action="/login">
            <input type="text" name="username" placeholder="Username"><br><br>
            <input type="password" name="password" placeholder="Password"><br><br>
            <button type="submit">Login</button>
        </form>
        <p>Hint: Try <code>' OR '1'='1' --</code> as username</p>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
    
    console.log('[VULN] Executing query:', query);
    
    db.get(query, (err, row) => {
        if (err) {
            res.send(`<p>Error: ${err.message}</p><p>Query: <code>${query}</code></p>`);
            return;
        }
        
        if (row) {
            res.send(`<h2>Welcome, ${row.username}!</h2><p>Role: ${row.role}</p><p>Email: ${row.email}</p>`);
        } else {
            res.send('<p>Invalid credentials</p>');
        }
    });
});

app.get('/search', (req, res) => {
    res.send(`
        <h2>Product Search (SQL Injection Vulnerable)</h2>
        <form method="GET" action="/search">
            <input type="text" name="q" placeholder="Search products..." value="${req.query.q || ''}">
            <button type="submit">Search</button>
        </form>
    `);
    
    if (req.query.q) {
        const query = `SELECT * FROM products WHERE name LIKE '%${req.query.q}%' OR description LIKE '%${req.query.q}%'`;
        console.log('[VULN] Executing query:', query);
        
        db.all(query, (err, rows) => {
            if (err) {
                res.send(`<p>Error: ${err.message}</p>`);
                return;
            }
            
            let html = '<h3>Results:</h3><ul>';
            rows.forEach(row => {
                html += `<li><strong>${row.name}</strong> - $${row.price}<br>${row.description}</li>`;
            });
            html += '</ul>';
            res.send(res.send.bind(null, html));
        });
    }
});

app.get('/comment', (req, res) => {
    const comments = req.query.comments || [];
    
    let html = `
        <h2>Comments (XSS Vulnerable)</h2>
        <form method="POST" action="/comment">
            <textarea name="comment" rows="4" cols="50" placeholder="Leave a comment..."></textarea><br>
            <button type="submit">Post Comment</button>
        </form>
        <h3>Comments:</h3>
    `;
    
    if (req.app.locals.comments) {
        req.app.locals.comments.forEach(c => {
            html += `<div style="border: 1px solid #ccc; padding: 10px; margin: 10px 0;">
                ${c.text}
                <small> - ${c.date}</small>
            </div>`;
        });
    }
    
    res.send(html);
});

app.post('/comment', (req, res) => {
    if (!req.app.locals.comments) {
        req.app.locals.comments = [];
    }
    
    req.app.locals.comments.push({
        text: req.body.comment,
        date: new Date().toISOString()
    });
    
    res.redirect('/comment');
});

app.get('/file', (req, res) => {
    const fileName = req.query.name;
    
    if (!fileName) {
        res.send(`
            <h2>File Viewer (Path Traversal Vulnerable)</h2>
            <form method="GET" action="/file">
                <input type="text" name="name" placeholder="File name">
                <button type="submit">View</button>
            </form>
            <p>Try: <code>../../../etc/passwd</code> or <code>../../../../windows/system32/config/sam</code></p>
        `);
        return;
    }
    
    const filePath = path.join(__dirname, 'files', fileName);
    
    console.log('[VULN] Attempting to read:', filePath);
    
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            res.send(`<p>Error reading file: ${err.message}</p>`);
            return;
        }
        res.send(`<pre>${data}</pre>`);
    });
});

app.get('/ping', (req, res) => {
    res.send(`
        <h2>Network Tools (Command Injection Vulnerable)</h2>
        <form method="GET" action="/ping">
            <input type="text" name="host" placeholder="Enter IP or hostname">
            <button type="submit">Ping</button>
        </form>
        <p>Try: <code>127.0.0.1; ls -la</code> or <code>127.0.0.1 && cat /etc/passwd</code></p>
    `);
    
    if (req.query.host) {
        const { exec } = require('child_process');
        const command = `ping -c 1 ${req.query.host}`;
        
        console.log('[VULN] Executing command:', command);
        
        exec(command, (error, stdout, stderr) => {
            let output = `<h3>Output:</h3><pre>${stdout || stderr || error}</pre>`;
            res.send(output);
        });
    }
});

app.get('/profile', (req, res) => {
    const name = req.query.name || 'Guest';
    
    res.send(`
        <h2>User Profile (XSS Vulnerable)</h2>
        <form method="GET" action="/profile">
            <input type="text" name="name" placeholder="Your name" value="${name}">
            <button type="submit">Update</button>
        </form>
        <h3>Hello, ${name}!</h3>
        <p>Try: <code>&lt;img src=x onerror=alert('XSS')&gt;</code></p>
    `);
});

app.get('/api/users', (req, res) => {
    db.all('SELECT id, username, email, role FROM users', (err, rows) => {
        res.json({ users: rows });
    });
});

app.get('/api/products', (req, res) => {
    db.all('SELECT * FROM products', (err, rows) => {
        res.json({ products: rows });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VULN] Vulnerable app running on http://0.0.0.0:${PORT}`);
    console.log('[VULN] WARNING: This application is intentionally vulnerable!');
});
