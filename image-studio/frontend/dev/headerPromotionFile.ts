import fs from "node:fs/promises";
import path from "node:path";

export const HEADER_PROMOTION_FILE_NAME = "顶部推广信息.txt";
export const HEADER_PROMOTION_ROUTE = "/header-promotion";
export const HEADER_PROMOTION_MAX_BYTES = 16 * 1024;

export type HeaderPromotionFileResponse = {
  status: number;
  body: Buffer;
};

export async function resolveHeaderPromotionFileResponse(
  publicRoot: string,
  method: string | undefined,
): Promise<HeaderPromotionFileResponse> {
  if (method !== "GET" && method !== "HEAD") {
    return { status: 405, body: Buffer.from("method not allowed", "utf8") };
  }

  const filePath = path.join(publicRoot, HEADER_PROMOTION_FILE_NAME);
  let body: Buffer;
  try {
    const info = await fs.stat(filePath);
    if (info.size > HEADER_PROMOTION_MAX_BYTES) {
      return { status: 413, body: Buffer.alloc(0) };
    }
    body = await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: 204, body: Buffer.alloc(0) };
    }
    return { status: 500, body: Buffer.alloc(0) };
  }
  if (body.byteLength > HEADER_PROMOTION_MAX_BYTES) {
    return { status: 413, body: Buffer.alloc(0) };
  }
  return { status: 200, body: method === "HEAD" ? Buffer.alloc(0) : body };
}
