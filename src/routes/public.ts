import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { z } from "zod";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { config } from "../lib/config";
import { activity, memberLabel, nextProfileCode, normPhone } from "../lib/util";
import { rateLimit } from "express-rate-limit";

export const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(path.join(UPLOAD_DIR, "photos"), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, "docs"), { recursive: true });

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const storage = multer.diskStorage({
  destination: (_r, f, cb) => cb(null, path.join(UPLOAD_DIR, f.fieldname === "photo" ? "photos" : "docs")),
  filename: (_r, f, cb) => cb(null, crypto.randomBytes(16).toString("hex") + path.extname(f.originalname).toLowerCase()),
});
export const upload = multer({
  storage, limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  fileFilter: (_r, f, cb) => (ALLOWED.has(f.mimetype) ? cb(null, true) : cb(new HttpError(422, "Only JPG, PNG, WebP or PDF files are allowed."))),
});
/** Member photo gallery uploads: images only, up to 6 files of 6 MB. */
export const photoUpload = multer({
  storage, limits: { fileSize: 6 * 1024 * 1024, files: 6 },
  fileFilter: (_r, f, cb) => (f.mimetype.startsWith("image/") && ALLOWED.has(f.mimetype) ? cb(null, true) : cb(new HttpError(422, "Photos must be JPG, PNG or WebP."))),
});

const arr = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return v.startsWith("[") ? JSON.parse(v) : v.split(",");
  return [];
}, z.array(z.string().trim()));
const opt = z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined));
const num = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().optional());
const bool = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());

export const intakeSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name").max(100),
  gender: z.string().transform((s) => s.toUpperCase()).pipe(z.enum(["MALE", "FEMALE"], { message: "Select gender" })),
  dob: z.string().refine((s) => {
    const d = new Date(s); const age = (Date.now() - d.getTime()) / 31557600000;
    return !isNaN(d.getTime()) && age >= 18 && age <= 80;
  }, "Enter a valid date of birth (18 years or older)"),
  phone: z.string().transform(normPhone).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number")),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)),
  familyPhone: z.string().transform(normPhone).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit number")).optional().or(z.literal("").transform(() => undefined)),
  familyEmail: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)),
  heightCm: num,
  maritalStatus: opt, community: opt, subCommunity: opt, city: opt, state: opt,
  education: opt, profession: opt, income: opt, diet: opt,
  fatherOccupation: opt, motherOccupation: opt, siblings: opt, familyBackground: opt, about: opt,
  prefCommunities: arr.optional(), prefCities: arr.optional(),
  prefAgeMin: num, prefAgeMax: num, prefNotes: opt,
  consent: bool.refine((v) => v, "Consent is required to submit your bio data"),
});

/** Shared by the website form, the Google-Form webhook and admin manual entry. */
export async function createSubmission(input: z.infer<typeof intakeSchema>, source: string, files?: { photoUrl?: string; biodataFileUrl?: string }) {
  const dupe = await prisma.member.findFirst({
    where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true },
  });
  if (dupe) throw new HttpError(409, "A bio data with this mobile number or email already exists. Please contact Sathsangath if you need to update it.");
  const { consent, prefCommunities, prefCities, dob, ...rest } = input;
  const created = await prisma.member.create({
    data: {
      ...rest, dob: new Date(dob), source, consentGiven: consent,
      profileCode: await nextProfileCode(),
      prefCommunities: (prefCommunities ?? []).join(","), prefCities: (prefCities ?? []).join(","),
      ...files,
      ...(files?.photoUrl && { photos: { create: { url: files.photoUrl, isMain: true } } }),
    },
  });
  await activity({ type: "PUBLIC", name: memberLabel(created) }, "SUBMITTED_BIODATA", "Member", created.id, { source });
  return created;
}

export const publicRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please try again later." } });

publicRouter.post("/biodata", limiter, upload.fields([{ name: "photo", maxCount: 1 }, { name: "biodata", maxCount: 1 }]), wrap(async (req, res) => {
  const input = intakeSchema.parse(req.body);
  const f = req.files as Record<string, Express.Multer.File[]> | undefined;
  const m = await createSubmission(input, "WEB", {
    photoUrl: f?.photo?.[0] ? `/uploads/photos/${f.photo[0].filename}` : undefined,
    biodataFileUrl: f?.biodata?.[0] ? `docs/${f.biodata[0].filename}` : undefined,
  });
  res.status(201).json({ ok: true, reference: m.profileCode });
}));

// Google Form / Apps Script -> POST with header x-webhook-secret. Same validation & duplicate rules.
publicRouter.post("/intake-webhook", wrap(async (req, res) => {
  if (!config.webhookSecret || req.headers["x-webhook-secret"] !== config.webhookSecret) throw new HttpError(401, "Invalid webhook secret.");
  const m = await createSubmission(intakeSchema.parse(req.body), "GOOGLE_FORM", { biodataFileUrl: typeof req.body.biodataLink === "string" ? req.body.biodataLink : undefined });
  res.status(201).json({ ok: true, reference: m.profileCode });
}));

publicRouter.post("/contact", limiter, wrap(async (req, res) => {
  const d = z.object({
    name: z.string().trim().min(2, "Enter your name"),
    phone: z.string().trim().optional(),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
    message: z.string().trim().min(5, "Please write a short message").max(3000),
  }).parse(req.body);
  await prisma.contactMessage.create({ data: d });
  await activity({ type: "PUBLIC", name: d.name }, "SENT_MESSAGE", "ContactMessage");
  res.status(201).json({ ok: true });
}));
