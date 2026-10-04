import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config";
import { HttpError } from "./http";
import { prisma } from "./db";

export type Actor = { kind: "admin" | "member"; id: string; role?: string };
declare global { namespace Express { interface Request { actor?: Actor } } }

export const signToken = (a: Actor) =>
  jwt.sign(a, config.jwtSecret, { expiresIn: config.jwtExpires as jwt.SignOptions["expiresIn"] });

function readActor(req: Request): Actor {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) throw new HttpError(401, "Please log in to continue.");
  try { return jwt.verify(h.slice(7), config.jwtSecret) as Actor; }
  catch { throw new HttpError(401, "Your session has expired. Please log in again."); }
}

export const requireAdmin = (roles?: string[]) => async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const a = readActor(req);
    if (a.kind !== "admin") throw new HttpError(403, "Admin access only.");
    const admin = await prisma.adminUser.findUnique({ where: { id: a.id } });
    if (!admin?.active) throw new HttpError(401, "Account disabled.");
    if (roles && !roles.includes(admin.role)) throw new HttpError(403, "You do not have permission for this action.");
    req.actor = { ...a, role: admin.role };
    next();
  } catch (e) { next(e); }
};

export const requireMember = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const a = readActor(req);
    if (a.kind !== "member") throw new HttpError(403, "Member access only.");
    const m = await prisma.member.findUnique({ where: { id: a.id }, select: { status: true } });
    if (m?.status !== "APPROVED") throw new HttpError(403, "Your account is not active. Please contact Sathsangath.");
    req.actor = a;
    next();
  } catch (e) { next(e); }
};
