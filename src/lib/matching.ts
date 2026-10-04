import { prisma } from "./db";
import { list } from "./util";

export const includeTags = {
  tags: { include: { tagValue: { include: { category: true } } } },
  photos: { orderBy: [{ isMain: "desc" as const }, { createdAt: "asc" as const }] },
};

/** Ids of members who have liked each other with `memberId` (mutual likes). */
export async function mutualIds(memberId: string) {
  const [mine, theirs] = await Promise.all([
    prisma.like.findMany({ where: { likerId: memberId }, select: { likedId: true } }),
    prisma.like.findMany({ where: { likedId: memberId }, select: { likerId: true } }),
  ]);
  const them = new Set(theirs.map((l) => l.likerId));
  return new Set(mine.map((l) => l.likedId).filter((id) => them.has(id)));
}

/**
 * Curated feed for one viewer:
 *  - opposite gender, APPROVED only
 *  - admin overrides win (SHOW forces in, HIDE forces out)
 *  - otherwise the profile must satisfy the viewer's stated preferences against the tags the
 *    admin applied (Community / City), falling back to submitted values, plus the age range.
 * An empty preference means "no restriction" for that criterion.
 */
export async function matchesFor(viewerId: string) {
  const viewer = await prisma.member.findUniqueOrThrow({ where: { id: viewerId } });
  const overrides = await prisma.visibilityOverride.findMany({ where: { viewerId } });
  const hide = new Set(overrides.filter((o) => o.action === "HIDE").map((o) => o.profileId));
  const show = new Set(overrides.filter((o) => o.action === "SHOW").map((o) => o.profileId));

  const candidates = await prisma.member.findMany({
    where: { status: "APPROVED", id: { not: viewerId }, gender: viewer.gender === "MALE" ? "FEMALE" : "MALE" },
    include: includeTags,
    orderBy: { approvedAt: "desc" },
  });

  const wantComm = list(viewer.prefCommunities).map((s) => s.toLowerCase());
  const wantCity = list(viewer.prefCities).map((s) => s.toLowerCase());
  const now = Date.now();

  return candidates.filter((c) => {
    if (hide.has(c.id)) return false;
    if (show.has(c.id)) return true;
    const tagVals = (cat: string) =>
      c.tags.filter((t) => t.tagValue.category.name.toLowerCase() === cat).map((t) => t.tagValue.value.toLowerCase());
    const comm = tagVals("community"); if (!comm.length && c.community) comm.push(c.community.toLowerCase());
    const city = tagVals("city"); if (!city.length && c.city) city.push(c.city.toLowerCase());
    if (wantComm.length && !comm.some((x) => wantComm.includes(x))) return false;
    if (wantCity.length && !city.some((x) => wantCity.includes(x))) return false;
    const age = Math.floor((now - c.dob.getTime()) / 31557600000);
    if (viewer.prefAgeMin && age < viewer.prefAgeMin) return false;
    if (viewer.prefAgeMax && age > viewer.prefAgeMax) return false;
    return true;
  });
}
