# Build with the clean context produced by prepare-context.mjs, not the full repo.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    WORD_STUDIO_HOST=0.0.0.0 \
    WORD_STUDIO_PORT=8080 \
    WORD_STUDIO_CHROME=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium ffmpeg ca-certificates fonts-liberation fonts-noto-core \
       fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

WORKDIR /app/word-studio
# One parent dependency tree keeps React shared by the composition and Remotion.
COPY --chown=node:node word-studio/ ./

RUN mkdir -p exports preview-audio public/captures/placed-v3 \
    && chown -R node:node /app

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node --input-type=module -e "const r=await fetch('http://127.0.0.1:8080/api/health');if(!r.ok)process.exit(1)"
CMD ["node", "server.mjs"]
