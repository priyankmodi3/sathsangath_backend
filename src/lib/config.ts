import "dotenv/config";
export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  jwtExpires: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  webhookSecret: process.env.INTAKE_WEBHOOK_SECRET ?? "",
  webLoginUrl: process.env.WEB_LOGIN_URL ?? "http://localhost:3000/login",
};
