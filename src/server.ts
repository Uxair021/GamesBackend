import { createApp } from "./app";
import { connectDb } from "./config/db";
import { env } from "./config/env";

async function main() {
  await connectDb();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[server] listening on port ${env.port}`);
  });
}

main().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
