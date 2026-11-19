import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase } from "./database/client.js";
import { startCalendarPollAutomation } from "./services/calendar-poll-automation.js";

const app = await buildApp();
let calendarAutomation: ReturnType<typeof startCalendarPollAutomation> | undefined;

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Encerrando aplicacao.");
  await calendarAutomation?.stop();
  await app.close();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT,
  });
  calendarAutomation = startCalendarPollAutomation();
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}
