import { SignJWT, jwtVerify } from "jose";

export interface AuthClaims {
  employeeId: number;
  isAdmin: boolean;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueToken(
  claims: AuthClaims,
  secret: string,
  ttlSec = 6 * 3600,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({ employeeId: claims.employeeId, isAdmin: claims.isAdmin })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ttlSec)
    .sign(key(secret));
}

export async function verifyToken(token: string, secret: string): Promise<AuthClaims> {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
  return { employeeId: payload.employeeId as number, isAdmin: payload.isAdmin as boolean };
}
