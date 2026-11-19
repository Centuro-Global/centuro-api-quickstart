// npm run all-cases
// Pages through every live case and counts them by status.
// `cases.all()` follows `nextCursor` for you, fetching each page only when the loop needs it.

import { run } from "./_run.js";

await run(async (centuro) => {
  const byStatus = new Map<string, number>();
  let total = 0;

  for await (const c of centuro.cases.all({ limit: 100 })) {
    const status = c.standardisedStatus ?? "(no status)";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    total++;
  }

  console.log(`${total} live cases\n`);
  console.table(
    [...byStatus].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count })),
  );
});
