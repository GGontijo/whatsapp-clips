const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const qrimage = require("qr-image");
const readline = require("readline");
const ytdl = require("ytdl-core");
const puppeteer = require("puppeteer");
const request = require("request");
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const winston = require("winston");

// Configuração do logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Configuração do servidor web
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: process.env.CHROME_BIN || undefined,
    browserWSEndpoint: process.env.CHROME_WS || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// Página inicial
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const staticPath = path.join(__dirname, "public", "static");

const videosPath = path.join(__dirname, "videos");

// Cria a pasta de arquivos estáticos, se não existir
if (!fs.existsSync(staticPath)) {
  fs.mkdirSync(staticPath);
}

// Cria a pasta de videos, se não existir
if (!fs.existsSync(videosPath)) {
  fs.mkdirSync(videosPath);
}

// Servir arquivos estáticos
app.use(express.static(staticPath));

const qrPath = path.join(staticPath, "qrcode.png");

// Inicialização do cliente WhatsApp
client.on("qr", (qr) => {
  // Apagar o arquivo qrcode.png se existir
  if (fs.existsSync(qrPath)) {
    fs.unlinkSync(qrPath);
  }
  // Gerar QR code e exibir no terminal
  qrcode.generate(qr, { small: true });
  // Salvar como imagem
  qrimage.image(qr, { type: "png" }).pipe(fs.createWriteStream(qrPath));
});

client.on("ready", () => {
  const logMessage = "Client is ready!";
  logger.info(logMessage);
  io.emit("log", logMessage);

  // Apagar o arquivo qrcode.png, se existir
  if (fs.existsSync(qrPath)) {
    fs.unlinkSync(qrPath);
  }
});

const processMessage = async (msg) => {
  const chat = await msg.getChat();
  const contact = await msg.getContact();
  if (chat.isGroup && chat.name === "Anotações importantes") {
    const logMessage = `Mensagem recebida de ${contact.pushname}: ${msg.body}`;
    logger.info(logMessage);
    io.emit("log", logMessage);

    if (
      msg.body.includes("facebook.com") ||
      msg.body.includes("youtube.com") ||
      msg.body.includes("instagram.com")
    ) {
      const urlMatch = msg.body.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        const url = urlMatch[0];
        const logUrl = `Found URL: ${url}`;
        logger.info(logUrl);
        io.emit("log", logUrl);

        try {
          if (url.includes("facebook.com")) {
            await downloadFacebookVideo(url, msg);
          } else {
            await downloadSocialMediaVideo(url, msg);
          }
        } catch (err) {
          const errorLog = `Erro ao tentar baixar o vídeo: ${err}`;
          logger.error(errorLog);
          io.emit("log", errorLog);
        }
      }
    }
  }
};

client.on("message", async (msg) => {
  await processMessage(msg);
});

client.on("message_create", async (msg) => {
  if (msg.fromMe) {
    await processMessage(msg);
  }
});

const downloadVideo = async (url, msg) => {
  const info = await ytdl.getInfo(url);
  const videoFormat = ytdl.chooseFormat(info.formats, { quality: "highest" });
  const filePath = path.resolve(
    __dirname,
    "videos",
    `${info.videoDetails.title}.mp4`
  );
  const contact = await msg.getContact();
  const senderName = contact.pushname;

  ytdl(url, { format: videoFormat })
    .pipe(fs.createWriteStream(filePath))
    .on("finish", () => {
      const logMessage = `Downloaded YouTube video: ${info.videoDetails.title}`;
      logger.info(logMessage);
      io.emit("log", logMessage);
      msg.reply(logMessage);
      client.sendMessage(msg.from, fs.readFileSync(filePath), {
        filename: `${info.videoDetails.title}.mp4`,
        caption: `Tome seu video @${senderName}, cacete!`,
      });
    });
};

const downloadFacebookVideo = (url, msg) => {
  const options = {
    method: "POST",
    url: "https://www.getfvid.com/downloader",
    formData: { url },
  };
  let videoName = Math.floor(Math.random() * 6666) + ".mp4";
  const sanitizedName = videoName.replace(/[\\/:"*?<>|]/g, "");
  const filePath = path.join(videosPath, videoName);

  fs.writeFile(filePath, "", (err) => {
    if (err) throw err;
  });

  request(options, (error, response) => {
    if (error) throw new Error(error);

    const linkMatch = [
      ...response.body.matchAll(
        /<a href="(.+?)" target="_blank" class="btn btn-download"(.+?)>(.+?)<\/a>/g
      ),
    ];
    if (linkMatch.length === 0) {
      const logMessage = "Url de video inválida!";
      logger.info(logMessage);
      io.emit("log", logMessage);
      msg.reply(logMessage);
      return;
    }

    const results = linkMatch.map((item, i) => {
      const quality = item[3].includes("<strong>HD</strong>")
        ? "Download in HD Quality"
        : item[3];
      return { quality, url: item[1].replace(/amp;/g, "") };
    });

    const selected = results[1];

    request({
      uri: selected.url,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      gzip: true,
      rejectUnauthorized: false,
    })
      .pipe(fs.createWriteStream(filePath))
      .on("finish", () => {
        const logMessage = `Download realizado com Sucesso: ${sanitizedName}`;
        logger.info(logMessage);
        io.emit("log", logMessage);
        sendVideo(filePath, msg);
      });
  });
};

async function sendVideo(videoPath, msg) {
  try {
    const contact = await msg.getContact();
    const senderName = contact.pushname || contact.number || "usuário";

    // Criar uma instância de MessageMedia
    const media = MessageMedia.fromFilePath(videoPath);

    // Enviar a mensagem com o vídeo
    await client.sendMessage(msg.from, media);

    const logMessage = "Vídeo enviado com sucesso!";
    logger.info(logMessage);
    io.emit("log", logMessage);
  } catch (error) {
    const logMessage = `Erro ao enviar o vídeo: ${error}`;
    logger.info(logMessage);
    io.emit("log", logMessage);
  }
}

client.initialize().catch((err) => {
  const errorLog = `Client initialization failed: ${err}`;
  logger.error(errorLog);
  io.emit("log", errorLog);
});

// Iniciar o servidor
const PORT = 3000;
server.listen(PORT, () => {
  const logMessage = `Server is running on port ${PORT}`;
  logger.info(logMessage);
  io.emit("log", logMessage);
});

// Socket.io para logs em tempo real
io.on("connection", (socket) => {
  const logMessage = `New client connected: ${socket.handshake.address}`;
  logger.info(logMessage);

  // Enviar logs anteriores
  fs.readFile("combined.log", "utf8", (err, data) => {
    if (err) {
      console.error("Error reading log file:", err);
      return;
    }
    const logs = data.split("\n");
    logs.forEach((log) => {
      if (log.trim()) {
        socket.emit("log", log);
      }
    });
  });

  socket.on("disconnect", () => {
    const disconnectLog = `Client disconnected: ${socket.handshake.address}`;
    logger.info(disconnectLog);
  });
});
