import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { HttpError, wrap } from "../lib/http";
import { requireMember } from "../lib/auth";
import { matchesFor, includeTags, mutualIds } from "../lib/matching";
import { toMutualProfile, toPublicProfile, toSelf } from "../lib/serializers";
import { activity, memberLabel, normPhone } from "../lib/util";
import { photoUpload } from "./public";
import { removeObject, saveUpload } from "../lib/storage";

export const memberRouter = Router();
memberRouter.use(requireMember);

const MAX_PHOTOS = 6;
const STATUS_LABEL: Record<string, string> = {
  NEW: "Request received",
  UNDER_REVIEW: "Under review by Sathsangath",
  INTRODUCTION_FACILITATED: "Introduction arranged",
  CLOSED: "Closed",
};

const me = (req: { actor?: { id: string } }) => req.actor!.id;
const loadMe = (id: string) => prisma.member.findUniqueOrThrow({ where: { id }, include: includeTags });
const who = (m: { id: string; profileCode: string; fullName: string }) => ({ type: "MEMBER" as const, memberId: m.id, name: memberLabel(m) });

/** Keeps Member.photoUrl equal to the chosen main photo (used for cards and lists). */
async function syncMainPhoto(memberId: string) {
  let main = await prisma.photo.findFirst({ where: { memberId, isMain: true } });
  if (!main) {
    main = await prisma.photo.findFirst({ where: { memberId }, orderBy: { createdAt: "asc" } });
    if (main) await prisma.photo.update({ where: { id: main.id }, data: { isMain: true } });
  }
  await prisma.member.update({ where: { id: memberId }, data: { photoUrl: main?.url ?? null } });
}

// ---------- Account ----------
memberRouter.get("/me", wrap(async (req, res) => { res.json(await toSelf(await loadMe(me(req)))); }));

// Only contact details are editable by the member. Bio data changes go through the admin.
memberRouter.patch("/me", wrap(async (req, res) => {
  const d = z.object({
    phone: z.string().transform(normPhone).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number")).optional(),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => null)),
    familyPhone: z.string().transform(normPhone).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit number")).optional(),
    familyEmail: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => null)),
  }).parse(req.body);
  if (d.phone) {
    const other = await prisma.member.findFirst({ where: { phone: d.phone, id: { not: me(req) } } });
    if (other) throw new HttpError(409, "This mobile number is already registered.");
  }
  const m = await prisma.member.update({ where: { id: me(req) }, data: d, include: includeTags });
  await activity(who(m), "UPDATED_CONTACT_DETAILS", "Member", m.id);
  res.json(await toSelf(m));
}));

memberRouter.get("/summary", wrap(async (req, res) => {
  const [notifications, announcements] = await Promise.all([
    prisma.notification.count({ where: { audience: "MEMBER", memberId: me(req), read: false } }),
    prisma.announcement.count({ where: { active: true } }),
  ]);
  res.json({ unreadNotifications: notifications, announcements });
}));

// ---------- Photos (member chooses which one is the main photo) ----------
memberRouter.post("/photos", photoUpload.array("photo", MAX_PHOTOS), wrap(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw new HttpError(422, "Choose at least one photo to upload.");
  const have = await prisma.photo.count({ where: { memberId: me(req) } });
  if (have + files.length > MAX_PHOTOS) throw new HttpError(422, `You can keep up to ${MAX_PHOTOS} photos. Remove one to add another.`);
  const wantMain = String(req.body.mainIndex ?? "") !== "" ? Number(req.body.mainIndex) : -1;
  const hasMain = !!(await prisma.photo.findFirst({ where: { memberId: me(req), isMain: true } }));
  if (wantMain >= 0 && files[wantMain]) await prisma.photo.updateMany({ where: { memberId: me(req) }, data: { isMain: false } });
  const keys = await Promise.all(files.map((f) => saveUpload("photos", f)));
  for (const [i, key] of keys.entries()) {
    await prisma.photo.create({ data: { memberId: me(req), url: key, isMain: wantMain >= 0 ? i === wantMain : !hasMain && i === 0 } });
  }
  await syncMainPhoto(me(req));
  const m = await loadMe(me(req));
  await activity(who(m), "UPLOADED_PHOTOS", "Photo", undefined, { count: files.length });
  res.status(201).json((await toSelf(m)).photos);
}));

memberRouter.patch("/photos/:id/main", wrap(async (req, res) => {
  const p = await prisma.photo.findFirst({ where: { id: String(req.params.id), memberId: me(req) } });
  if (!p) throw new HttpError(404, "Photo not found.");
  await prisma.$transaction([
    prisma.photo.updateMany({ where: { memberId: me(req) }, data: { isMain: false } }),
    prisma.photo.update({ where: { id: p.id }, data: { isMain: true } }),
  ]);
  await syncMainPhoto(me(req));
  const m = await loadMe(me(req));
  await activity(who(m), "CHANGED_MAIN_PHOTO", "Photo", p.id);
  res.json((await toSelf(m)).photos);
}));

memberRouter.delete("/photos/:id", wrap(async (req, res) => {
  const p = await prisma.photo.findFirst({ where: { id: String(req.params.id), memberId: me(req) } });
  if (!p) throw new HttpError(404, "Photo not found.");
  await prisma.photo.delete({ where: { id: p.id } });
  await removeObject(p.url);
  await syncMainPhoto(me(req));
  const m = await loadMe(me(req));
  await activity(who(m), "DELETED_PHOTO", "Photo", p.id);
  res.json((await toSelf(m)).photos);
}));

// ---------- Matches & profiles ----------
memberRouter.get("/matches", wrap(async (req, res) => {
  const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12) }).parse(req.query);
  const [all, mutual, likes] = await Promise.all([
    matchesFor(me(req)), mutualIds(me(req)),
    prisma.like.findMany({ where: { likerId: me(req) }, select: { likedId: true } }),
  ]);
  const liked = new Set(likes.map((l) => l.likedId));
  const slice = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  res.json({
    total: all.length, page: q.page, pageSize: q.pageSize,
    items: await Promise.all(slice.map(async (m) => ({ ...(await (mutual.has(m.id) ? toMutualProfile(m) : toPublicProfile(m))), liked: liked.has(m.id), mutual: mutual.has(m.id) }))),
  });
}));

/** A profile can be opened if it is in the viewer's curated feed, or if the two members liked each other. */
async function loadVisible(viewerId: string, profileId: string) {
  const [feed, mutual] = await Promise.all([matchesFor(viewerId), mutualIds(viewerId)]);
  const isMutual = mutual.has(profileId);
  const p = feed.find((m) => m.id === profileId) ?? (isMutual ? await prisma.member.findFirst({ where: { id: profileId, status: "APPROVED" }, include: includeTags }) : null);
  if (!p) throw new HttpError(404, "This profile is not available.");
  return { p, isMutual };
}

memberRouter.get("/profiles/:id", wrap(async (req, res) => {
  const { p, isMutual } = await loadVisible(me(req), String(req.params.id));
  const [like, intro] = await Promise.all([
    prisma.like.findUnique({ where: { likerId_likedId: { likerId: me(req), likedId: p.id } } }),
    prisma.introRequest.findUnique({ where: { requesterId_targetId: { requesterId: me(req), targetId: p.id } } }),
  ]);
  res.json({
    ...(await (isMutual ? toMutualProfile(p) : toPublicProfile(p))), liked: !!like, mutual: isMutual,
    introduction: intro ? { status: intro.status, label: STATUS_LABEL[intro.status] } : null,
  });
}));

// ---------- Likes ----------
memberRouter.put("/likes/:id", wrap(async (req, res) => {
  const { p } = await loadVisible(me(req), String(req.params.id));
  const existing = await prisma.like.findUnique({ where: { likerId_likedId: { likerId: me(req), likedId: p.id } } });
  let mutual = false;
  if (!existing) {
    await prisma.like.create({ data: { likerId: me(req), likedId: p.id } });
    const meRow = await prisma.member.findUniqueOrThrow({ where: { id: me(req) } });
    await activity(who(meRow), "LIKED_PROFILE", "Member", p.id, { profile: p.profileCode });
    const back = await prisma.like.findUnique({ where: { likerId_likedId: { likerId: p.id, likedId: me(req) } } });
    if (back) {
      mutual = true;
      const first = (n: string) => n.split(" ")[0];
      await prisma.$transaction([
        // the person who liked first
        prisma.notification.create({ data: { audience: "MEMBER", memberId: p.id, type: "MUTUAL_LIKE", title: "It's a match! 💞",
          body: `${first(meRow.fullName)} (${meRow.profileCode}) liked your profile as well. You can now view their profile properly.`, data: JSON.stringify({ memberId: meRow.id }) } }),
        // the person who just liked
        prisma.notification.create({ data: { audience: "MEMBER", memberId: meRow.id, type: "MUTUAL_LIKE", title: "It's a match! 💞",
          body: `${first(p.fullName)} (${p.profileCode}) had already liked you. You can now view their profile properly.`, data: JSON.stringify({ memberId: p.id }) } }),
        // staff bell
        prisma.notification.create({ data: { audience: "ADMIN", type: "MUTUAL_LIKE", title: "Mutual like",
          body: `${memberLabel(meRow)} and ${memberLabel(p)} liked each other.`, data: JSON.stringify({ a: meRow.id, b: p.id }) } }),
      ]);
      await activity(who(meRow), "MUTUAL_MATCH", "Member", p.id, { with: p.profileCode });
    }
  } else mutual = (await mutualIds(me(req))).has(p.id);
  res.json({ liked: true, mutual });
}));

memberRouter.delete("/likes/:id", wrap(async (req, res) => {
  const r = await prisma.like.deleteMany({ where: { likerId: me(req), likedId: String(req.params.id) } });
  if (r.count) { const m = await prisma.member.findUniqueOrThrow({ where: { id: me(req) } }); await activity(who(m), "REMOVED_LIKE", "Member", String(req.params.id)); }
  res.json({ liked: false });
}));

memberRouter.get("/likes", wrap(async (req, res) => {
  const [likes, mutual, intros] = await Promise.all([
    prisma.like.findMany({ where: { likerId: me(req), liked: { status: "APPROVED" } }, include: { liked: { include: includeTags } }, orderBy: { createdAt: "desc" } }),
    mutualIds(me(req)),
    prisma.introRequest.findMany({ where: { requesterId: me(req) } }),
  ]);
  const byTarget = new Map(intros.map((i) => [i.targetId, i]));
  res.json(await Promise.all(likes.map(async (l) => {
    const i = byTarget.get(l.likedId); const isMutual = mutual.has(l.likedId);
    return { ...(await (isMutual ? toMutualProfile(l.liked) : toPublicProfile(l.liked))), liked: true, mutual: isMutual, likedAt: l.createdAt, introduction: i ? { status: i.status, label: STATUS_LABEL[i.status] } : null };
  })));
}));

memberRouter.post("/introductions", wrap(async (req, res) => {
  const { profileId, message } = z.object({ profileId: z.string().min(1), message: z.string().trim().max(500).optional() }).parse(req.body);
  const like = await prisma.like.findUnique({ where: { likerId_likedId: { likerId: me(req), likedId: profileId } } });
  if (!like) throw new HttpError(422, "Like this profile first to request an introduction.");
  const r = await prisma.introRequest.upsert({
    where: { requesterId_targetId: { requesterId: me(req), targetId: profileId } },
    create: { requesterId: me(req), targetId: profileId, message }, update: {},
  });
  const m = await prisma.member.findUniqueOrThrow({ where: { id: me(req) } });
  await activity(who(m), "REQUESTED_INTRODUCTION", "IntroRequest", r.id);
  res.status(201).json({ status: r.status, label: STATUS_LABEL[r.status] });
}));

// ---------- Notifications & announcements ----------
memberRouter.get("/notifications", wrap(async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { audience: "MEMBER", memberId: me(req) }, orderBy: { createdAt: "desc" }, take: 100 }));
}));
memberRouter.post("/notifications/read-all", wrap(async (req, res) => {
  await prisma.notification.updateMany({ where: { audience: "MEMBER", memberId: me(req), read: false }, data: { read: true } });
  res.json({ ok: true });
}));
memberRouter.get("/announcements", wrap(async (_req, res) => {
  res.json(await prisma.announcement.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 50 }));
}));
