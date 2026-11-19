// npm run cases
// Lists the first page of your company's cases, newest first.
//
// Try changing the filters, for example:
//   { archived: true }
//   { country: "DE" }
//   { updatedAt: { gte: "2026-01-01" }, sort: "updatedAt" }

import { run } from "./_run.js";

await run(async (centuro) => {
  const page = await centuro.cases.list({ limit: 10 });

  if (page.data.length === 0) {
    console.log("No cases yet.");
    return;
  }

  console.table(
    page.data.map((c) => ({
      id: c.id,
      reference: c.reference,
      applicant: c.applicant.name,
      country: c.country,
      status: c.standardisedStatus ?? c.stage,
      updated: c.updatedAt.slice(0, 10),
    })),
  );

  if (page.pagination.hasMore) {
    console.log(`More cases are available. Pass cursor "${page.pagination.nextCursor}" to get the next page,`);
    console.log("or run `npm run all-cases` to page through them all.");
  }
});
