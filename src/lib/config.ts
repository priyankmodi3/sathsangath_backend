import "dotenv/config";
export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  jwtExpires: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  webhookSecret: process.env.INTAKE_WEBHOOK_SECRET ?? "",
  webLoginUrl: process.env.WEB_LOGIN_URL ?? "http://localhost:3000/login",
  storage: {
    provider: "r2", // "r2" | "s3" - change here when moving to AWS S3 (GCS needs a new driver)
    bucket: "sathsangath",
    region: "auto", // R2 uses "auto"; for AWS S3 use e.g. "ap-south-1"
    // Provider-neutral names win; the CLOUDFLARE_* names are accepted for R2.
    accessKeyId: process.env.STORAGE_ACCESS_KEY ?? process.env.CLOUDFLARE_ACCESS_KEY ?? "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY ?? process.env.CLOUDFLARE_SECRET_KEY ?? "",
    endpoint: process.env.STORAGE_ENDPOINT ?? process.env.CLOUDFLARE_S3_API_ENDPOINT ?? undefined,
    urlTtl: Number(process.env.STORAGE_URL_TTL ?? 3600),
  },
};
