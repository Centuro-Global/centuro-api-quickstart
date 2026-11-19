// npm run test:postman            runs the Postman tests against QAT, using the key in your .env
// npm run test:postman -- local   runs them against a Centuro API on http://localhost:8080
//
// Your secret is passed to Newman from .env. It is never written into the environment files.

import newman from "newman";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: fall back to variables already set in the shell.
}

const target = process.argv[2] ?? "qat";
const {
  CENTURO_CLIENT_ID: clientId,
  CENTURO_CLIENT_SECRET: clientSecret,
  CENTURO_API_URL: apiUrl,
  CENTURO_SCOPES: scopes,
} = process.env;

if (!clientId || !clientSecret) {
  console.error("Set CENTURO_CLIENT_ID and CENTURO_CLIENT_SECRET in your .env file. See .env.example.");
  process.exit(1);
}

const envVar = [
  { key: "clientId", value: clientId },
  { key: "clientSecret", value: clientSecret },
  ...(scopes ? [{ key: "scopes", value: scopes.split(/[\s,]+/).filter(Boolean).join(" ") }] : []),
  // CENTURO_API_URL wins over the environment file, so the tests call the same API as the examples.
  ...(apiUrl && target === "qat" ? [{ key: "apiUrl", value: apiUrl }] : []),
];

newman.run(
  {
    collection: "postman/centuro-public-api.postman_collection.json",
    environment: `postman/${target}.postman_environment.json`,
    envVar,
    reporters: ["cli"],
  },
  (error, summary) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exitCode = summary.run.failures.length > 0 ? 1 : 0;
  },
);
