import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config";

// Firebase ID tokens are RS256 JWTs signed by Google; verifying them needs no service account.
const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

export async function verifyFirebaseIdToken(idToken: string) {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: `https://securetoken.google.com/${config.firebaseProjectId}`,
    audience: config.firebaseProjectId,
  });
  if (!payload.sub) throw new Error("no subject");
  return { uid: payload.sub, email: (payload.email as string | undefined)?.toLowerCase() ?? null, emailVerified: payload.email_verified === true };
}
