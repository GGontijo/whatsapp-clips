const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const ytdl = require('ytdl-core');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
});

const processMessage = async (msg) => {
    console.log(`Received message: ${msg.body}`);

    if (msg.body.includes('facebook.com') || msg.body.includes('youtube.com') || msg.body.includes('instagram.com')) {
        const urlMatch = msg.body.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
            const url = urlMatch[0];
            console.log(`Found URL: ${url}`);

            try {
                if (url.includes('youtube.com')) {
                    await downloadYouTubeVideo(url, msg);
                } else {
                    await downloadSocialMediaVideo(url, msg);
                }
            } catch (err) {
                console.error('Error downloading video:', err);
            }
        }
    }
};

client.on('message', async (msg) => {
    await processMessage(msg);
});

client.on('message_create', async (msg) => {
    if (msg.fromMe) {
        await processMessage(msg);
    }
});


const downloadYouTubeVideo = async (url, msg) => {
    const info = await ytdl.getInfo(url);
    const videoFormat = ytdl.chooseFormat(info.formats, { quality: 'highest' });
    const filePath = path.resolve(__dirname, 'videos', `${info.videoDetails.title}.mp4`);
    
    ytdl(url, { format: videoFormat })
        .pipe(fs.createWriteStream(filePath))
        .on('finish', () => {
            msg.reply(`Downloaded YouTube video: ${info.videoDetails.title}`);
            client.sendMessage(msg.from, fs.readFileSync(filePath), { filename: `${info.videoDetails.title}.mp4`, caption: 'Here is your video!' });
        });
};

const downloadSocialMediaVideo = async (url, msg) => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });

    const videoSrc = await page.evaluate(() => {
        const video = document.querySelector('video');
        return video ? video.src : null;
    });

    if (videoSrc) {
        const viewSource = await page.goto(videoSrc);
        const buffer = await viewSource.buffer();
        const filePath = path.resolve(__dirname, 'videos', 'video.mp4');
        fs.writeFileSync(filePath, buffer);
        msg.reply('Downloaded social media video.');
        client.sendMessage(msg.from, buffer, { filename: 'video.mp4', caption: 'Here is your video!' });
    } else {
        msg.reply('Could not download video.');
    }

    await browser.close();
};

client.initialize().catch(err => {
    console.error('Client initialization failed:', err);
});
