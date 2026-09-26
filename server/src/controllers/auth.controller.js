import bcrypt from "bcryptjs";
import User from "../models/user.js";
import {
  issueTokens,
  refreshCookieOptions,
  verifyRefreshToken,
} from "../utils/tokens.js";
const publicUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
});
function respondWithSession(res, user) {
  const { accessToken, refreshToken } = issueTokens(user);
  res.cookie("patcheck_refresh", refreshToken, {
    ...refreshCookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return res.status(200).json({ accessToken, user: publicUser(user) });
}
export async function signup(req, res) {
  const { name, email, password } = req.body || {};
  if (
    !name?.trim() ||
    !email?.trim() ||
    typeof password !== "string" ||
    password.length < 8
  )
    return res
      .status(400)
      .json({
        error:
          "Name, email, and a password of at least 8 characters are required.",
      });
  const normalizedEmail = email.trim().toLowerCase();
  if (await User.exists({ email: normalizedEmail }))
    return res
      .status(409)
      .json({ error: "An account with that email already exists." });
  const passwordHash = await bcrypt.hash(password, 12);
  return respondWithSession(
    res,
    await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
    }),
  );
}
export async function login(req, res) {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: email?.trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash)))
    return res.status(401).json({ error: "Invalid email or password." });
  return respondWithSession(res, user);
}
export async function refresh(req, res) {
  try {
    const payload = verifyRefreshToken(req.cookies?.patcheck_refresh);
    const user = await User.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.tokenVersion)
      throw new Error("invalid session");
    return respondWithSession(res, user);
  } catch {
    res.clearCookie("patcheck_refresh", refreshCookieOptions);
    return res
      .status(401)
      .json({ error: "Session expired. Please sign in again." });
  }
}
export async function logout(req, res) {
  try {
    const payload = verifyRefreshToken(req.cookies?.patcheck_refresh);
    await User.findByIdAndUpdate(payload.sub, { $inc: { tokenVersion: 1 } });
  } catch {}
  res.clearCookie("patcheck_refresh", refreshCookieOptions);
  return res.status(204).send();
}
