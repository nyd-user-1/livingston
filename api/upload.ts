// /api/upload — presigned S3 PUT for canvas file-drop, plus the library list.
// The browser uploads directly to s3://nsr-pdfs/workspace/… ; nothing streams
// through the function.
//
//   GET ?name=report.pdf&type=application/pdf → { url, key }
//   GET ?list=1                               → { files: [{key,name,size,modified}] }

import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const config = { maxDuration: 10 };

const BUCKET = "nsr-pdfs";
const MAX_NAME = 120;

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (req.query?.list) {
    try {
      const s3 = new S3Client({ region: "us-east-1" });
      const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "workspace/", MaxKeys: 200 }));
      const files = (out.Contents ?? [])
        .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))
        .map((o) => ({
          key: o.Key,
          name: String(o.Key).replace(/^workspace\/[a-z0-9]+-/, ""),
          size: o.Size ?? 0,
          modified: o.LastModified?.toISOString() ?? null,
        }));
      return res.status(200).json({ files });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }
  const name = String(req.query?.name ?? "file").slice(0, MAX_NAME).replace(/[^\w.\- ()]/g, "_");
  const type = String(req.query?.type ?? "application/octet-stream").slice(0, 100);
  const key = `workspace/${Date.now().toString(36)}-${name}`;
  try {
    // nsr-pdfs lives in us-east-1; BEDROCK_REGION is us-east-2 and must not leak here
    const s3 = new S3Client({ region: "us-east-1" });
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: type }),
      { expiresIn: 300 },
    );
    return res.status(200).json({ url, key, bucket: BUCKET });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
