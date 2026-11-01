# InsightBI

InsightBI is a browser-first business analytics workspace for CSV and Excel data. It includes a real data-import and cleaning workflow, calculated KPIs, an isolated SQL.js laboratory, interactive charts, six analysis workspaces, and printable reports.

## Requirements

- Node.js 20 or newer
- npm
- A Supabase project only if account authentication and cross-device metadata sync are needed

## Run locally

```sh
npm install
npm run dev
```

Vite prints the local development URL. Build the production bundle with `npm run build`; run focused unit tests with `npm test`.

## Supabase setup

1. Create a Supabase project and enable email/password authentication. Configure the project's site URL and redirect URLs for local development and the deployed app.
2. Apply [`supabase/migrations/202610270001_insightbi_schema.sql`](supabase/migrations/202610270001_insightbi_schema.sql) in the Supabase SQL editor or with the Supabase CLI.
3. Create `.env.local` with the project URL and the public anon/publishable key:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

4. Restart the Vite server. Registration, login, logout, and password recovery are available at `/auth`. Project, dataset, chart, and report metadata uses user-scoped tables with Row Level Security.

Only the public anon/publishable key belongs in frontend environment variables. Never add a Supabase service-role key to this app. If either variable is absent, InsightBI runs in local mode without pretending that account authentication is active.

## Data handling

- CSV and Excel files are parsed in the browser. The 15 MB, 25,000-row, and 80-column upload limits keep the local analytics workflow responsive.
- Dataset rows and local project/chart/report history are stored in the browser's IndexedDB. They are not uploaded to Supabase Storage, and they do not follow a user to another device or browser profile.
- When Supabase is configured, authenticated dataset metadata and project/report metadata can sync to the user's Supabase tables. Dataset row contents remain in IndexedDB. Clearing browser site data removes those local rows.
- The optional retail sample is synthetic. `sales` is gross item value after applying the row's discount; `cost` is per-item cost multiplied by quantity; `profit = sales - cost`; and `profit margin = profit / sales * 100`. Dashboard calculations use the uploaded values as provided and do not assume the sample formula applies to other datasets.
- SQL runs against temporary SQL.js databases inside disposable Web Workers, not the production Supabase database. Only one read-only `SELECT` or `WITH ... SELECT` statement is accepted. Queries have a five-second worker timeout; datasets have a 25,000-row ceiling; results are capped at 1,000 rows. SQL uses SQLite syntax, so dialect-specific syntax from PostgreSQL, BigQuery, and other engines is not supported.
- The visualization studio exports SVG. Reports can be printed or saved as PDF through the browser print dialog and exported as CSV.
- KPIs and recommendations depend on inferred column names. Confirm field mappings, currency, definitions, and business context before using results for decisions.

## Deploy

Build with `npm run build` and deploy the generated `dist/` directory to any static host that supports SPA history fallback. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as build-time environment variables if using Supabase. Add the deployed origin to Supabase Auth's site and redirect URL allowlists. No application server or service-role key is required.

## Known limitations

- Files are not durably stored in cloud object storage. Cross-device dataset access requires a future authenticated Supabase Storage integration and matching storage policies.
- The SQL engine is SQLite/WASM and operates on in-memory copies of local datasets. Complex or long-running SQL is terminated after five seconds.
- The automatic column mapper recognizes common English business field names; review mappings before interpreting inferred KPIs.
- PDF export relies on the browser's print-to-PDF feature. Saved reports store report metadata, while their content is regenerated from the current local dataset.