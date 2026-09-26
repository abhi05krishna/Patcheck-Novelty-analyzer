import jwt from "jsonwebtoken";
const accessSecret = () => process.env.JWT_ACCESS_SECRET || "replace-this-development-access-secret";
const refreshSecret = () => process.env.JWT_REFRESH_SECRET || "replace-this-development-refresh-secret";
export function issueTokens(user) { const payload = { sub: user._id.toString(), email: user.email, tokenVersion: user.tokenVersion }; return { accessToken: jwt.sign(payload, accessSecret(), { expiresIn: process.env.ACCESS_TOKEN_TTL || "15m" }), refreshToken: jwt.sign(payload, refreshSecret(), { expiresIn: process.env.REFRESH_TOKEN_TTL || "7d" }) }; }
export const verifyAccessToken = (token) => jwt.verify(token, accessSecret()); export const verifyRefreshToken = (token) => jwt.verify(token, refreshSecret());
export const refreshCookieOptions = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth" };