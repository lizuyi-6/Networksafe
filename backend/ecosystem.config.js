module.exports = {
    apps: [{
        name: "api-security-backend",
        script: "./dist/index.js",
        env: {
            NODE_ENV: "production",
            PORT: 8080
        }
    }]
}
