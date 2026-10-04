import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { signToken, requireMember, requireAdmin } from "../lib/auth";
import { activity, audit, memberLabel, normPhone } from "../lib/util";
import { toSelf } from "../lib/serializers";
import { includeTags } from "../lib/matching";

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: "Too many login attempts. Please try again in 15 minutes." } });

const passwordRule = z.string().min(8, "Use at least 8 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");

// Member login: mobile number OR profile code + password
authRouter.post("/login", loginLimiter, wrap(async (req, res) => {
  const { username, password } = z.object({ username: z.string().trim().min(3, "Enter your mobile number or Member ID"), password: z.string().min(1, "Enter your password") }).parse(req.body);
  const u = username.toUpperCase().startsWith("SS-") ? { profileCode: username.toUpperCase() } : { phone: normPhone(username) };
  const m = await prisma.member.findUnique({ where: u, include: includeTags });
  if (!m?.passwordHash || !(await bcrypt.compare(password, m.passwordHash))) {
    await activity({ type: "PUBLIC", name: username }, "FAILED_LOGIN", "Member", m?.id);
    throw new HttpError(401, "Incorrect mobile number / Member ID or password.");
  }
  if (m.status === "SUSPENDED") throw new HttpError(403, "Your account is suspended. Please contact Sathsangath.");
  if (m.status !== "APPROVED") throw new HttpError(403, "Your bio data is still under review.");
  await prisma.member.update({ where: { id: m.id }, data: { lastLoginAt: new Date() } });
  await activity({ type: "MEMBER", memberId: m.id, name: memberLabel(m) }, "LOGIN", "Member", m.id);
  res.json({ token: signToken({ kind: "member", id: m.id }), member: toSelf(m) });
}));

authRouter.post("/change-password", requireMember, wrap(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordRule }).parse(req.body);
  const m = await prisma.member.findUniqueOrThrow({ where: { id: req.actor!.id } });
  if (!m.passwordHash || !(await bcrypt.compare(currentPassword, m.passwordHash))) throw new HttpError(422, "Current password is incorrect.", { fields: { currentPassword: "Current password is incorrect" } });
  if (currentPassword === newPassword) throw new HttpError(422, "Choose a different password from the current one.");
  await prisma.member.update({ where: { id: m.id }, data: { passwordHash: await bcrypt.hash(newPassword, 11), mustChangePassword: false } });
  await activity({ type: "MEMBER", memberId: m.id, name: memberLabel(m) }, "CHANGED_PASSWORD", "Member", m.id);
  res.json({ ok: true });
}));

authRouter.post("/admin/login", loginLimiter, wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().email("Enter a valid email"), password: z.string().min(1, "Enter your password") }).parse(req.body);
  const a = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  if (!a?.active || !(await bcrypt.compare(password, a.passwordHash))) throw new HttpError(401, "Incorrect email or password.");
  await audit(a.id, "LOGIN", "AdminUser", a.id);
  res.json({ token: signToken({ kind: "admin", id: a.id, role: a.role }), admin: { id: a.id, name: a.name, email: a.email, role: a.role } });
}));

authRouter.get("/admin/me", requireAdmin(), wrap(async (req, res) => {
  const a = await prisma.adminUser.findUniqueOrThrow({ where: { id: req.actor!.id } });
  res.json({ id: a.id, name: a.name, email: a.email, role: a.role });
}));
