ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY --chown=1000:1000 server.mjs /app/server.mjs
USER 1000:1000
ENV NODE_ENV=production
CMD ["node", "/app/server.mjs"]
