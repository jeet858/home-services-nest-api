// Vercel serverless entry. Uses the compiled app from `npm run vercel-build`.
const { createApp } = require('../dist/bootstrap');

// Cached per warm instance so Nest boots once, not on every request.
let serverPromise;

module.exports = async (req, res) => {
  serverPromise ??= createApp().then((app) => app.getHttpAdapter().getInstance());
  const server = await serverPromise;
  return server(req, res);
};
