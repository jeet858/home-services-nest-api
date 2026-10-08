import { createApp } from './bootstrap';

// Local/server entry (replaces src/server.js).
async function main() {
  const app = await createApp();
  const PORT = process.env.PORT || 5000;
  await app.listen(PORT);
  console.log(`Server running on port ${PORT}`);
}

main();
