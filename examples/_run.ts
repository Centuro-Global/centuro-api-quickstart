import { CenturoApiError, CenturoClient } from "../src/centuro.js";

/** Loads .env, builds a client and runs an example, printing errors in a readable way. */
export async function run(example: (client: CenturoClient) => Promise<void>): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: fall back to variables already set in the shell.
  }

  try {
    await example(CenturoClient.fromEnv());
  } catch (error) {
    if (error instanceof CenturoApiError) {
      console.error(`\n✖ ${error.message}`);
      console.error(`  code: ${error.code}`);
      for (const e of error.errors ?? []) console.error(`  ${e.parameter}: ${e.message}`);
    } else {
      console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  }
}
