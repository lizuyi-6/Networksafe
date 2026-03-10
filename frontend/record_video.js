import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
    // Ensure output directory exists
    const videoDir = path.join(__dirname, 'public', 'videos');
    if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
    }

    console.log('Starting Playwright...');
    const browser = await chromium.launch({ headless: true });

    // We record video directly into the public folder
    const context = await browser.newContext({
        recordVideo: {
            dir: videoDir,
            size: { width: 1024, height: 720 }
        },
        viewport: { width: 1024, height: 720 }
    });

    const page = await context.newPage();

    console.log('Navigating to AetherGuard Promo page...');
    await page.goto('http://127.0.0.1:5173/promo', { waitUntil: 'domcontentloaded' });

    // Ensure React actually renders by waiting for the main wrapping div to be attached
    // This avoids the 'White screen of death' in recordings. 
    console.log('Waiting for React to mount...');
    await page.waitForTimeout(2000); // Give Vite/React 2 seconds to bootstrap

    console.log('Recording animation for 60 seconds (1 minute)...');
    // The animation takes around 13-15 seconds for a full loop
    // Running for 1 minute covers ~4 full loops
    await page.waitForTimeout(60000);

    console.log('Closing and saving video...');
    await context.close(); // Closes context and saves video to disk
    await browser.close();

    // Playwright generates a random filename for the video, 
    // we want to rename it to something predictable
    const files = fs.readdirSync(videoDir);
    const videoFile = files.find(f => f.endsWith('.webm') && f !== 'aetherguard_promo.webm');

    if (videoFile) {
        const oldPath = path.join(videoDir, videoFile);
        const newPath = path.join(videoDir, 'aetherguard_promo.webm');
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath); // Remove old one if exists
        fs.renameSync(oldPath, newPath);
        console.log(`\nSuccess! Video saved to: ${newPath}`);
        console.log(`You can view it in the frontend at /videos/aetherguard_promo.webm`);
    } else {
        console.log('\nCould not find generated video file.');
    }

})();
