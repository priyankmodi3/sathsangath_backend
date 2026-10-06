import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join(".") || "_"] = i.message;
    return res.status(422).json({ error: "Please correct the highlighted fields.", fields });
  }
  if (err instanceof MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "That file is too large. Photos can be up to 5 MB and documents up to 8 MB."
      : err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT" ? "Too many files were attached." : "The upload could not be processed.";
    return res.status(413).json({ error: msg, fields: err.code === "LIMIT_FILE_SIZE" ? { photos: msg } : {} });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
