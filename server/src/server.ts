import { createApp } from "./app.js";
import { validateStartupConfiguration } from "./config/security.js";
import { DomainError } from "./shared/errors.js";

/**
 * Configuration is validated before anything is constructed, so a
 * misconfigured production process exits immediately instead of serving
 * traffic on an unsafe signing key.
 */
try {
  validateStartupConfiguration();
} catch (error) {
  if (error instanceof DomainError) {
    // The message names the variable and the reason — never the value.
    console.error(`[startup] ${error.code}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const port = Number(process.env.PORT ?? 4000);
const { app } = createApp();

app.listen(port, () => {
  console.log(`Small Lending OS API listening on http://localhost:${port}`);
});
