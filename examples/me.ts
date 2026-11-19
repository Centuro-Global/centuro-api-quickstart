// npm run me
// Checks your key works: shows which key you're using, its scopes, and your company.

import { run } from "./_run.js";

await run(async (centuro) => {
  const me = await centuro.me();

  console.log("✔ Connected to the Centuro API\n");
  console.log(`  Company: ${me.corporate?.name ?? "(none)"}`);
  console.log(`  Key:     ${me.client.id}`);
  console.log(`  Scopes:  ${me.scopes.join(", ")}`);
});
