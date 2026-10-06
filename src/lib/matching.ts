import { prisma } from "./db";
import { ageFrom, list } from "./util";

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

/** Optional member-chosen filters that narrow the curated feed. Empty/undefined means "no restriction". */
export type FeedFilters = {
  ageMin?: number; ageMax?: number; heightMin?: number; heightMax?: number;
  city?: string[]; maritalStatus?: string[]; education?: string[]; profession?: string[]; diet?: string[]; community?: string[];
};

const oneOf = (wanted: string[] | undefined, value: string | null) =>
  !wanted?.length || (!!value && wanted.some((w) => w.toLowerCase() === value.trim().toLowerCase()));

type Candidate = Awaited<ReturnType<typeof curatedFeed>>[number];

function applyFilters(items: Candidate[], f: FeedFilters) {
  return items.filter((c) => {
    const age = ageFrom(c.dob);
    if (f.ageMin !== undefined && age < f.ageMin) return false;
    if (f.ageMax !== undefined && age > f.ageMax) return false;
    if (f.heightMin !== undefined && (c.heightCm == null || c.heightCm < f.heightMin)) return false;
    if (f.heightMax !== undefined && (c.heightCm == null || c.heightCm > f.heightMax)) return false;
    return oneOf(f.city, c.city) && oneOf(f.maritalStatus, c.maritalStatus) && oneOf(f.education, c.education)
      && oneOf(f.profession, c.profession) && oneOf(f.diet, c.diet) && oneOf(f.community, c.community);
  });
}

/** Distinct values (and age/height ranges) present in the viewer's own feed, so the app only offers filters that can match. */
export async function filterOptionsFor(viewerId: string) {
  const feed = await matchesFor(viewerId);
  const distinct = (pick: (c: Candidate) => string | null) =>
    [...new Set(feed.map(pick).filter((v): v is string => !!v && !!v.trim()).map((v) => v.trim()))].sort((a, b) => a.localeCompare(b));
  const ages = feed.map((c) => ageFrom(c.dob));
  const heights = feed.map((c) => c.heightCm).filter((h): h is number => h != null);
  return {
    ageMin: ages.length ? Math.min(...ages) : null, ageMax: ages.length ? Math.max(...ages) : null,
    heightMin: heights.length ? Math.min(...heights) : null, heightMax: heights.length ? Math.max(...heights) : null,
    cities: distinct((c) => c.city), maritalStatuses: distinct((c) => c.maritalStatus), educations: distinct((c) => c.education),
    professions: distinct((c) => c.profession), diets: distinct((c) => c.diet), communities: distinct((c) => c.community),
  };
}

/**
 * Curated feed for one viewer:
 *  - opposite gender, APPROVED only
 *  - admin overrides win (SHOW forces in, HIDE forces out)
 *  - otherwise the profile must satisfy the viewer's stated preferences against the tags the
 *    admin applied (Community / City), falling back to submitted values, plus the age range.
 * An empty preference means "no restriction" for that criterion.
 */
export async function matchesFor(viewerId: string, filters?: FeedFilters) {
  const feed = await curatedFeed(viewerId);
  return filters ? applyFilters(feed, filters) : feed;
}

async function curatedFeed(viewerId: string) {
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
