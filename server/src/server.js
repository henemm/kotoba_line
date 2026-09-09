import { buildApp } from "./app.js";
import { config } from "./config.js";

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
