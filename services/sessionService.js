const jwt = require("jsonwebtoken");

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
}

function verifySessionToken(token, jwtSecret) {
  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}

function toNumericId(id) {
  const numericId = Number(id);
  return Number.isFinite(numericId) ? numericId : id;
}

function buildAuthenticatedUserFromPayload(payload) {
  if (!payload?.sub) {
    return null;
  }

  return {
    id: toNumericId(payload.sub),
    username: payload.username || "",
    email: payload.email || "",
    sessionId: payload.sid || "",
  };
}

function getAuthenticatedUser(req, jwtSecret) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  const payload = verifySessionToken(token, jwtSecret);
  return buildAuthenticatedUserFromPayload(payload);
}

async function validateAuthenticatedSession({
  token,
  jwtSecret,
  query,
  touchLastActiveAt = false,
}) {
  const payload = verifySessionToken(token, jwtSecret);
  const authenticatedUser = buildAuthenticatedUserFromPayload(payload);
  if (!authenticatedUser) {
    return null;
  }

  if (!query) {
    return authenticatedUser;
  }

  const sessionId = String(payload.sid || "").trim();
  if (!sessionId) {
    return null;
  }

  const activeSessionLookup = await query(
    `
      SELECT id
      FROM user_sessions
      WHERE id = $1
        AND user_id = $2
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `,
    [sessionId, authenticatedUser.id],
  );

  if (activeSessionLookup.rows.length === 0) {
    return null;
  }

  if (touchLastActiveAt) {
    await query(
      `
        UPDATE user_sessions
        SET last_active_at = NOW()
        WHERE id = $1
      `,
      [sessionId],
    );
  }

  return authenticatedUser;
}

module.exports = {
  getAuthenticatedUser,
  getBearerToken,
  toNumericId,
  verifySessionToken,
  validateAuthenticatedSession,
};
