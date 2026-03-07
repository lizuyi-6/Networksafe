#!/bin/bash
set -e

echo "==========================================="
echo "   AetherGuard Native Deployment Script"
echo "==========================================="

# Install dependencies (Node.js 20.x, Nginx)
echo "--> Installing OS dependencies..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx

echo "--> Installing PM2 globally..."
npm install -g pm2

# Setup directories
APP_DIR="/opt/aetherguard"
mkdir -p $APP_DIR/backend
mkdir -p $APP_DIR/frontend
mkdir -p /var/www/aetherguard

# Extract artifacts
echo "--> Extracting backend..."
tar -xzf backend-dist.tar.gz -C $APP_DIR/backend/
echo "--> Extracting frontend..."
tar -xzf frontend-dist.tar.gz -C $APP_DIR/frontend/

# Setup Backend
echo "--> Setting up backend..."
cd $APP_DIR/backend
npm install --production

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    # Generate random secrets for production
    sed -i "s/your-super-secret-jwt-key-change-in-production/$(openssl rand -hex 32)/g" .env
    echo "AUDIT_LOG_SECRET=$(openssl rand -hex 32)" >> .env
    # Modify environment
    sed -i "s/NODE_ENV=development/NODE_ENV=production/g" .env
    sed -i "s/DISABLE_REDIS=false/DISABLE_REDIS=true/g" .env
    echo "DISABLE_REDIS=true" >> .env
fi

# Start backend via PM2
echo "--> Starting backend with PM2..."
pm2 restart fluxguard-backend || pm2 start dist/index.js --name "fluxguard-backend"
pm2 save
pm2 startup | grep "sudo env" | sh || true

# Setup Frontend
echo "--> Setting up frontend..."
cp -r $APP_DIR/frontend/dist/* /var/www/aetherguard/
chown -R www-data:www-data /var/www/aetherguard

# Configure Nginx
echo "--> Configuring Nginx..."
cat > /etc/nginx/conf.d/aetherguard.conf << 'EOF'
server {
    listen 80;
    server_name _;

    root /var/www/aetherguard;
    index index.html index.htm;

    gzip on;
    gzip_min_length 1000;
    gzip_types text/plain text/css application/json application/javascript application/x-javascript text/xml application/xml application/xml+rss text/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
EOF

# Restart Nginx
echo "--> Restarting Nginx..."
systemctl restart nginx
systemctl enable nginx

echo "==========================================="
echo "   Deployment Completed Successfully!"
echo "   Access via http://YOUR_SERVER_IP/"
echo "==========================================="
