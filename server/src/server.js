import { buildApp } from "./app.js";
import { writeFileSync } from "node:fs";
import { config } from "./config.js";
import { runPush, webPushSender } from "./push.js";

const app = await buildApp({ config });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}

try {
  // §9: bound to loopback only — nginx is the sole entry point.
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err, "failed to start");
  process.exit(1);
}

// #248: "Deine nächsten Karten sind bereit", checked once a minute.
if (config.pushSender) {
  const send = webPushSender(app.db);
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runPush(app.db, Math.floor(Date.now() / 1000), send);
      if (result.users > 0) app.log.info({ push: result }, "push pass");
      // Readiness, not liveness (CLAUDE.md): only a pass without errors.
      if (result.errors === 0) writeFileSync(config.pushStampFile, `${new Date().toISOString()}\n`);
      else app.log.warn({ push: result }, "push pass had errors");
    } catch (err) {
      app.log.error(err, "push pass failed");
    } finally {
      running = false;
    }
  };
  setInterval(pass, 60_000).unref();
  pass();
}
