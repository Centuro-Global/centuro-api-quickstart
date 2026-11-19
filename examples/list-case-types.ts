// npm run case-types [search]
// Lists the types of case Centuro handles. Pass a word to search, e.g. `npm run case-types -- visa`.

import { run } from "./_run.js";

const search = process.argv[2];

await run(async (centuro) => {
  const rows = [];
  for await (const type of centuro.caseTypes.all({ q: search, limit: 100 })) {
    rows.push({ id: type.id, name: type.name, category: type.category.name });
  }
  console.table(rows);
});
