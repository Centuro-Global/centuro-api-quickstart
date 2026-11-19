// npm run case -- <case id>
// Shows one case. Get an ID from `npm run cases`.

import { run } from "./_run.js";

const id = process.argv[2];
if (!id) {
  console.error("Usage: npm run case -- <case id>    (e.g. npm run case -- case_8f3k2m...)");
  process.exit(1);
}

await run(async (centuro) => {
  const found = await centuro.cases.get(id);
  console.log(JSON.stringify(found, null, 2));
});
