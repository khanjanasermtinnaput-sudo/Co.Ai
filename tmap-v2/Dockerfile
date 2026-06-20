FROM node:22-alpine
WORKDIR /app

# install runtime deps only
COPY package*.json ./
RUN npm install --omit=dev

# app source
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 8787

# JWT_SECRET and COAGENTIX_MASTER_KEY must be provided as environment variables.
CMD ["npm", "run", "server"]
