FROM node

COPY . .

RUN npm install

CMD ["node", "main.js"]
