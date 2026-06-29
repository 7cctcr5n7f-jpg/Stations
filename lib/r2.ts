/**
 * lib/r2.ts
 *
 * Shared Cloudflare R2 helper used by the upload API route and any other
 * server-side code that needs to put objects into R2.
 *
 * Required environment variables (add in Vercel → Settings → Environment Variables):
 *   R2_ACCOUNT_ID        — Cloudflare account ID (found in R2 dashboard URL)
 *   R2_ACCESS_KEY_ID     — R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY — R2 API token Secret Access Key
 *   R2_BUCKET_NAME       — R2 bucket name (e.g. "stations-videos")
 *   R2_PUBLIC_URL        — Public bucket URL (e.g. "https://pub-xxx.r2.dev" or custom domain)
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials are not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY."
    )
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

/**
 * Upload a file to Cloudflare R2 and return its public URL.
 *
 * @param key         Object key inside the bucket, e.g. "videos/1234-exercise.mp4"
 * @param body        File content as Buffer, Uint8Array, ReadableStream, or Blob
 * @param contentType MIME type, e.g. "video/mp4"
 * @returns           The full public URL of the uploaded object
 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | ReadableStream | Blob,
  contentType: string
): Promise<string> {
  const bucket = process.env.R2_BUCKET_NAME
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, "")

  if (!bucket) throw new Error("R2_BUCKET_NAME is not set.")
  if (!publicUrl) throw new Error("R2_PUBLIC_URL is not set.")

  const client = getR2Client()

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body as any,
      ContentType: contentType,
    })
  )

  return `${publicUrl}/${key}`
}
