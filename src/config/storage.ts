/**
 * Cloudflare R2 (S3-compatible) storage.
 * Falls back to local disk when R2 env vars are not set.
 *
 * Required env vars for R2:
 *   R2_ACCOUNT_ID    — Cloudflare account ID
 *   R2_ACCESS_KEY_ID — R2 API token (Access Key ID)
 *   R2_SECRET_ACCESS_KEY — R2 API token (Secret)
 *   R2_BUCKET        — bucket name
 *   R2_PUBLIC_URL    — optional: public domain for the bucket
 *                      (e.g. https://pub-xxxx.r2.dev or your custom domain)
 *                      If unset, download goes through a signed URL.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import { Readable } from 'stream';
import type { Response } from 'express';

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const bucket = process.env.R2_BUCKET?.trim();
const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, '');

export const isR2Enabled = Boolean(accountId && accessKeyId && secretAccessKey && bucket);

let s3: S3Client | null = null;

if (isR2Enabled) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId!}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  });
}

/**
 * Upload a file to R2.
 * @param key     e.g. "submissions/2026/05/uuid.pdf"
 * @param body    Buffer or Readable stream
 * @param mimeType e.g. "application/pdf"
 */
export async function uploadToR2(key: string, body: Buffer | Readable, mimeType: string): Promise<void> {
  if (!s3 || !bucket) throw new Error('R2 not configured');
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    })
  );
}

/**
 * Delete an object from R2.
 */
export async function deleteFromR2(key: string): Promise<void> {
  if (!s3 || !bucket) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    // Ignore missing file errors on delete
  }
}

/**
 * Stream an R2 object directly to an Express response.
 * Sets Content-Type, Content-Disposition, and Content-Length if available.
 */
export async function streamFromR2(
  key: string,
  res: Response,
  filename: string,
  mimeType = 'application/octet-stream'
): Promise<void> {
  if (!s3 || !bucket) throw new Error('R2 not configured');
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const obj = await s3.send(cmd);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (obj.ContentLength) res.setHeader('Content-Length', obj.ContentLength);
  (obj.Body as Readable).pipe(res);
}

/**
 * Get a public URL for an R2 object.
 * Uses the public bucket domain if R2_PUBLIC_URL is set,
 * otherwise generates a signed URL valid for 1 hour.
 */
export async function getR2Url(key: string, expiresInSeconds = 3600): Promise<string> {
  if (!s3 || !bucket) throw new Error('R2 not configured');
  if (publicUrl) {
    return `${publicUrl}/${key}`;
  }
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

/**
 * Upload a local file path to R2, then optionally delete the local copy.
 */
export async function uploadFileToR2(
  localPath: string,
  key: string,
  mimeType: string,
  deleteLocal = true
): Promise<void> {
  const body = fs.readFileSync(localPath);
  await uploadToR2(key, body, mimeType);
  if (deleteLocal) {
    try { fs.unlinkSync(localPath); } catch { /* ignore */ }
  }
}
