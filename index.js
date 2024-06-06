const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const ytdl = require('ytdl-core');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');

// Configuração do logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level}]: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Configuração do servidor web
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
});

// Página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname)));

// Inicialização do cliente WhatsApp
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    const logMessage = `QR Code received, scan please: ${qr}`;
    logger.info(logMessage);
    io.emit('log', logMessage);
});

client.on('ready', () => {
    const logMessage = 'Client is ready!';
    logger.info(logMessage);
    io.emit('log', logMessage);
});

const processMessage = async (msg) => {
    const chat = await msg.getChat();
    if (chat.isGroup && chat.name === 'BOCAS BLINDERS') {
        const logMessage = `Received message: ${msg.body}`;
        logger.info(logMessage);
        io.emit('log', logMessage);

        if (msg.body.includes('facebook.com') || msg.body.includes('youtube.com') || msg.body.includes('instagram.com')) {
            const urlMatch = msg.body.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                const url = urlMatch[0];
                const logUrl = `Found URL: ${url}`;
                logger.info(logUrl);
                io.emit('log', logUrl);

                try {
                    if (url.includes('youtube.com')) {
                        await downloadYouTubeVideo(url, msg);
                    } else {
                        await downloadSocialMediaVideo(url, msg);
                    }
                } catch (err) {
                    const errorLog = `Error downloading video: ${err}`;
                    logger.error(errorLog);
                    io.emit('log', errorLog);
                }
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
            const logMessage = `Downloaded YouTube video: ${info.videoDetails.title}`;
            logger.info(logMessage);
            io.emit('log', logMessage);
            msg.reply(logMessage);
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
        const logMessage = 'Downloaded social media video.';
        logger.info(logMessage);
        io.emit('log', logMessage);
        msg.reply(logMessage);
        client.sendMessage(msg.from, buffer, { filename: 'video.mp4', caption: 'Here is your video!' });
    } else {
        const errorLog = 'Could not download video.';
        logger.error(errorLog);
        io.emit('log', errorLog);
        msg.reply(errorLog);
    }

    await browser.close();
};

client.initialize().catch(err => {
    const errorLog = `Client initialization failed: ${err}`;
    logger.error(errorLog);
    io.emit('log', errorLog);
});

// Iniciar o servidor
const PORT = 3000;
server.listen(PORT, () => {
    const logMessage = `Server is running on port ${PORT}`;
    logger.info(logMessage);
    io.emit('log', logMessage);
});

// Socket.io para logs em tempo real
io.on('connection', (socket) => {
    const logMessage = `New client connected: ${socket.handshake.address}`;
    logger.info(logMessage);

    // Enviar logs anteriores
    fs.readFile('combined.log', 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading log file:', err);
            return;
        }
        const logs = data.split('\n');
        logs.forEach(log => {
            if (log.trim()) {
                socket.emit('log', log);
            }
        });
    });

    socket.on('disconnect', () => {
        const disconnectLog = `Client disconnected: ${socket.handshake.address}`;
        logger.info(disconnectLog);
    });
});
