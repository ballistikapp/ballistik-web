import { getEnv } from "@/lib/config/env";
import { AppError } from "@/server/errors/app-error";
import { PinataSDK } from "pinata";

const DEFAULT_PINATA_GATEWAY_URL = "https://gateway.pinata.cloud";

const fileExtensionForMime = (mime: string) => {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    default:
      return "bin";
  }
};

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new AppError("Invalid token media payload", 400);
  }
  const mime = match[1];
  const base64 = match[2];
  return {
    mime,
    buffer: Buffer.from(base64, "base64"),
  };
};

const toSafeFileName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "token-media";

export const storageService = {
  async uploadImage(mediaSource: string, fileName: string): Promise<string> {
    if (!mediaSource || !mediaSource.startsWith("data:")) {
      return mediaSource;
    }

    const env = getEnv();
    const pinataJwt = env.PINATA_JWT;
    if (!pinataJwt) {
      return mediaSource;
    }

    const { mime, buffer } = parseDataUrl(mediaSource);
    const extension = fileExtensionForMime(mime);
    const normalizedFileName = `${toSafeFileName(fileName)}.${extension}`;
    const file = new File([buffer], normalizedFileName, { type: mime });
    const pinata = new PinataSDK({ pinataJwt });
    const uploaded = await pinata.upload.public.file(file);
    const gatewayBaseUrl = (
      env.PINATA_GATEWAY_URL ?? DEFAULT_PINATA_GATEWAY_URL
    ).replace(/\/+$/, "");
    return `${gatewayBaseUrl}/ipfs/${uploaded.cid}`;
  },
};
