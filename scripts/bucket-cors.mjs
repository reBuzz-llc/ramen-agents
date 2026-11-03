// Let browsers upload to and read from the "files" bucket from ramen-agents's own addresses:
// the live app and this Mac. Run once after `neon deploy` has made the bucket and written the AWS_* variables:
//
//   node --env-file=.env.local scripts/bucket-cors.mjs                      # the live app and localhost:3100
//   node --env-file=.env.local scripts/bucket-cors.mjs https://other.example  # extra origins after it
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.FILES_BUCKET?.trim() || "files";
if (!process.env.AWS_ENDPOINT_URL_S3) {
  console.error("No AWS_ENDPOINT_URL_S3: run `neon deploy` first, then this with --env-file=.env.local");
  process.exit(2);
}
const origins = [...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []), "http://localhost:3100", "http://127.0.0.1:3100", ...process.argv.slice(2)];
const s3 = new S3Client({ forcePathStyle: true, region: process.env.AWS_REGION || "us-east-2" });
await s3.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: { CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ["PUT", "GET", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 3600 }] },
  }),
);
const now = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log(`${bucket}: browsers may now upload from ${now.CORSRules?.[0]?.AllowedOrigins?.join(", ")}`);
