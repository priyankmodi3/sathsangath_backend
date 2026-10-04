import type { Member, MemberTag, TagValue, TagCategory, Photo } from "@prisma/client";
import { ageFrom, list } from "./util";

type FullMember = Member & { tags?: (MemberTag & { tagValue: TagValue & { category: TagCategory } })[]; photos?: Photo[] };
const toPhotos = (m: FullMember) => (m.photos ?? []).map((p) => ({ id: p.id, url: p.url, isMain: p.isMain }));

/**
 * PRIVACY: this is the ONLY shape another member ever receives.
 * Name, phone, email, family contacts, DOB and the original document are never included —
 * masking happens here on the server, not with CSS.
 */
export function toPublicProfile(m: FullMember) {
  return {
    id: m.id,
    profileCode: m.profileCode,
    gender: m.gender,
    age: ageFrom(m.dob),
    heightCm: m.heightCm,
    maritalStatus: m.maritalStatus,
    community: m.community,
    subCommunity: m.subCommunity,
    city: m.city,
    state: m.state,
    education: m.education,
    profession: m.profession,
    diet: m.diet,
    fatherOccupation: m.fatherOccupation,
    motherOccupation: m.motherOccupation,
    siblings: m.siblings,
    familyBackground: m.familyBackground,
    about: m.about,
    photoUrl: m.photoUrl,
    photos: toPhotos(m),
  };
}

/**
 * After BOTH members have liked each other the other side also sees the full name.
 * Phone, email and family contacts still stay private: only the admin shares those.
 */
export const toMutualProfile = (m: FullMember) => ({ ...toPublicProfile(m), fullName: m.fullName, mutual: true });

/** A member's own account: includes their own contact details, never admin notes. */
export function toSelf(m: FullMember) {
  return {
    ...toPublicProfile(m),
    fullName: m.fullName, phone: m.phone, email: m.email,
    familyPhone: m.familyPhone, familyEmail: m.familyEmail,
    dob: m.dob, status: m.status, mustChangePassword: m.mustChangePassword,
    prefs: { communities: list(m.prefCommunities), cities: list(m.prefCities), ageMin: m.prefAgeMin, ageMax: m.prefAgeMax, notes: m.prefNotes },
  };
}

/** Full record: admin only. */
export function toAdminMember(m: FullMember) {
  const { passwordHash, ...rest } = m;
  return {
    ...rest, age: ageFrom(m.dob), hasPassword: !!passwordHash, photos: toPhotos(m),
    prefCommunities: list(m.prefCommunities), prefCities: list(m.prefCities),
    tags: (m.tags ?? []).map((t) => ({ id: t.tagValueId, value: t.tagValue.value, category: t.tagValue.category.name })),
  };
}
