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

import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

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
  contentType: string,
  options?: { cacheControl?: string }
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
      CacheControl: options?.cacheControl ?? "public, max-age=31536000, immutable",
    })
  )

  return `${publicUrl}/${key}`
}

function getBucketAndPublicUrl() {
  const bucket = process.env.R2_BUCKET_NAME
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, "")

  if (!bucket) throw new Error("R2_BUCKET_NAME is not set.")
  if (!publicUrl) throw new Error("R2_PUBLIC_URL is not set.")

  return { bucket, publicUrl }
}

export function getR2KeyFromPublicUrl(url: string): string | null {
  const { publicUrl } = getBucketAndPublicUrl()
  if (!url.startsWith(`${publicUrl}/`)) return null
  return url.slice(publicUrl.length + 1)
}

export async function deleteFromR2ByPublicUrl(url: string | null | undefined): Promise<void> {
  if (!url) return

  const key = getR2KeyFromPublicUrl(url)
  if (!key) return

  const { bucket } = getBucketAndPublicUrl()
  const client = getR2Client()
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  )
}

/**
 * Download an object from R2 and return its content as a Buffer.
 */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const { bucket } = getBucketAndPublicUrl()
  const client = getR2Client()
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const chunks: Uint8Array[] = []
  // @ts-expect-error Body is a readable stream
  for await (const chunk of resp.Body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/**
 * Re-upload an existing key with updated metadata (CacheControl, ContentType)
 * by using copy-object with MetadataDirective: REPLACE.
 */
export async function updateR2Metadata(
  key: string,
  contentType: string,
  cacheControl: string,
): Promise<void> {
  const { bucket } = getBucketAndPublicUrl()
  const client = getR2Client()
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${bucket}/${key}`,
      ContentType: contentType,
      CacheControl: cacheControl,
      MetadataDirective: "REPLACE",
    })
  )
}

/**
 * List all object keys in the bucket with an optional prefix.
 */
export async function listR2Keys(prefix?: string): Promise<string[]> {
  const { bucket } = getBucketAndPublicUrl()
  const client = getR2Client()
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    )
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key)
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined
  } while (continuationToken)

  return keys
}
