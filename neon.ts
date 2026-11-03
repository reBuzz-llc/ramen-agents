// Neon services for the ramen-agents portal. Lakebase Postgres comes with every project; Auth is the sign-in.
// Functions is an empty slot: nothing runs there. The AI Gateway is left out: Neon refuses it on the Free plan and the
// portal makes no model calls.
import { defineConfig } from "@neon/config/v1";

// Object Storage: one private bucket, "files", for the team's PDFs and logos (/files). `neon deploy`
// creates it on the linked branch and writes the AWS_* variables (endpoint, region, key id, secret) to .env.local;
// those four go to Vercel too. Private: every read is a short presigned link from the app.
export default defineConfig({
  auth: true,
  functions: {},
  buckets: {
    files: {},
  },
});
