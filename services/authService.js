const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs/promises");
const jwt = require("jsonwebtoken");
const path = require("path");
const { ServiceError } = require("./serviceError");

const MAX_USERNAME_LENGTH = 64;
const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PROFILE_NAME_LENGTH = 128;
const MAX_AVATAR_SIZE_BYTES = 1024 * 1024;
const BCRYPT_SALT_ROUNDS = 12;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const THEME_PREFERENCE_SET = new Set(["light", "dark", "system"]);
const DEFAULT_NOTIFICATION_COLLABORATOR_INVITES = true;
const DEFAULT_NOTIFICATION_ASK_PERMISSION = false;
const TOKEN_TTL_HOURS = 12;
const SESSION_TTL_SQL_INTERVAL = `${TOKEN_TTL_HOURS} hours`;
const AVATAR_EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function toUserPayload(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    avatarUrl: user.avatar_path || "",
    themePreference:
      typeof user.theme_preference === "string" && THEME_PREFERENCE_SET.has(user.theme_preference)
        ? user.theme_preference
        : "light",
    notificationPreferences: {
      collaboratorInvites:
        typeof user.notification_collaborator_invites === "boolean"
          ? user.notification_collaborator_invites
          : DEFAULT_NOTIFICATION_COLLABORATOR_INVITES,
      askPermission:
        typeof user.notification_ask_permission === "boolean"
          ? user.notification_ask_permission
          : DEFAULT_NOTIFICATION_ASK_PERMISSION,
    },
  };
}

function normalizeUsername(username) {
  return username.trim();
}

function normalizeProfileName(name) {
  return String(name || "").trim();
}

function ensureValidEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ServiceError(400, "Please provide a valid email address.");
  }
}

function ensureValidProfileName(label, value, { required = false } = {}) {
  if (!value && required) {
    throw new ServiceError(400, `${label} is required.`);
  }

  if (value && value.length > MAX_PROFILE_NAME_LENGTH) {
    throw new ServiceError(400, `${label} must be at most ${MAX_PROFILE_NAME_LENGTH} characters.`);
  }
}

function ensureValidUsername(username) {
  if (username.length < MIN_USERNAME_LENGTH) {
    throw new ServiceError(400, `Username must be at least ${MIN_USERNAME_LENGTH} characters.`);
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    throw new ServiceError(400, `Username must be at most ${MAX_USERNAME_LENGTH} characters.`);
  }

  if (!USERNAME_PATTERN.test(username)) {
    throw new ServiceError(
      400,
      "Username can only contain letters, numbers, dots, underscores, and hyphens.",
    );
  }

  if (/^[._-]/.test(username) || /[._-]$/.test(username)) {
    throw new ServiceError(400, "Username cannot start or end with a special character.");
  }
}

function ensureValidPassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ServiceError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

function ensureValidThemePreference(themePreference) {
  if (!THEME_PREFERENCE_SET.has(themePreference)) {
    throw new ServiceError(400, "Theme preference must be light, dark, or system.");
  }
}

function normalizeNotificationPreferenceValue(value, fallbackValue) {
  return typeof value === "boolean" ? value : fallbackValue;
}

function generateSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(24).toString("hex");
}

function formatSessionLabel(userAgent) {
  const normalized = String(userAgent || "");
  const lower = normalized.toLowerCase();

  const os = lower.includes("windows")
    ? "Windows"
    : lower.includes("mac os") || lower.includes("macintosh")
      ? "Mac OS"
      : lower.includes("iphone") || lower.includes("ios")
        ? "iOS"
        : lower.includes("android")
          ? "Android"
          : "Unknown OS";

  const browser = lower.includes("edg/")
    ? "Edge"
    : lower.includes("chrome/") && !lower.includes("edg/")
      ? "Chrome"
      : lower.includes("safari/") && !lower.includes("chrome/")
        ? "Safari"
        : lower.includes("firefox/")
          ? "Firefox"
          : "Unknown Browser";

  return `${os} • ${browser}`;
}

function createAuthService({
  query,
  jwtSecret,
  avatarUploadDir,
  emailService,
  bcryptImpl = bcrypt,
  jwtImpl = jwt,
}) {
  async function registerUser({ firstName, lastName, username, password, email }) {
    const normalizedUsername = normalizeUsername(String(username || ""));
    const normalizedFirstName = normalizeProfileName(firstName);
    const normalizedLastName = normalizeProfileName(lastName);
    const passwordValue = String(password || "");
    let normalizedEmail = String(email || "").trim();

    if (!normalizedUsername || !passwordValue) {
      throw new ServiceError(400, "Username and password are required.");
    }

    if (!normalizedEmail) {
      normalizedEmail = `${normalizedUsername.toLowerCase()}@example.com`;
    }

    ensureValidProfileName("First name", normalizedFirstName, { required: true });
    ensureValidProfileName("Last name", normalizedLastName, { required: true });
    ensureValidEmail(normalizedEmail);
    ensureValidUsername(normalizedUsername);
    ensureValidPassword(passwordValue);

    const existingUser = await query(
      `
        SELECT id
        FROM users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `,
      [normalizedUsername],
    );

    if (existingUser.rows.length > 0) {
      throw new ServiceError(409, "Username already exists.");
    }

    const passwordHash = await bcryptImpl.hash(passwordValue, BCRYPT_SALT_ROUNDS);
    const createdUser = await query(
      `
        INSERT INTO users (username, password_hash, email, first_name, last_name)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, username, email, first_name, last_name, created_at, theme_preference, notification_collaborator_invites, notification_ask_permission
      `,
      [normalizedUsername, passwordHash, normalizedEmail, normalizedFirstName, normalizedLastName],
    );

    const user = createdUser.rows[0];

    await query(
      `
        INSERT INTO workspaces (user_id, name)
        VALUES ($1, 'Personal Workspace')
      `,
      [user.id],
    );

    return {
      ...toUserPayload(user),
      createdAt: user.created_at,
    };
  }

  async function loginUser({ username, password, userAgent = "" }) {
    const normalizedUsername = normalizeUsername(String(username || ""));
    const passwordValue = String(password || "");

    if (!normalizedUsername || !passwordValue) {
      throw new ServiceError(400, "Username and password are required.");
    }

    const userLookup = await query(
      `
        SELECT id, username, password_hash, email, first_name, last_name, avatar_path, theme_preference, notification_collaborator_invites, notification_ask_permission
        FROM users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `,
      [normalizedUsername],
    );

    if (userLookup.rows.length === 0) {
      throw new ServiceError(401, "Invalid username or password.");
    }

    const user = userLookup.rows[0];
    const isPasswordValid = await bcryptImpl.compare(passwordValue, user.password_hash);

    if (!isPasswordValid) {
      throw new ServiceError(401, "Invalid username or password.");
    }

    const sessionId = generateSessionId();
    await query(
      `
        INSERT INTO user_sessions (id, user_id, user_agent, expires_at)
        VALUES ($1, $2, $3, NOW() + INTERVAL '${SESSION_TTL_SQL_INTERVAL}')
      `,
      [
        sessionId,
        user.id,
        String(userAgent || "")
          .trim()
          .slice(0, 1024),
      ],
    );

    const token = jwtImpl.sign(
      {
        sub: user.id,
        sid: sessionId,
        username: user.username,
        email: user.email,
        firstName: user.first_name || "",
        lastName: user.last_name || "",
        avatarUrl: user.avatar_path || "",
        themePreference: user.theme_preference || "light",
      },
      jwtSecret,
      { expiresIn: `${TOKEN_TTL_HOURS}h` },
    );

    return {
      token,
      user: toUserPayload(user),
    };
  }

  async function getProfileById(userId) {
    const profileLookup = await query(
      `
        SELECT id, username, email, first_name, last_name, avatar_path, theme_preference, notification_collaborator_invites, notification_ask_permission
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId],
    );

    if (profileLookup.rows.length === 0) {
      throw new ServiceError(404, "User not found.");
    }

    return toUserPayload(profileLookup.rows[0]);
  }

  async function updateProfileById(userId, { firstName, lastName, username, email }) {
    const normalizedFirstName = normalizeProfileName(firstName);
    const normalizedLastName = normalizeProfileName(lastName);
    const normalizedUsername = normalizeUsername(String(username || ""));
    const normalizedEmail = String(email || "").trim();

    ensureValidUsername(normalizedUsername);
    ensureValidProfileName("First name", normalizedFirstName, { required: true });
    ensureValidProfileName("Last name", normalizedLastName, { required: true });
    ensureValidEmail(normalizedEmail);

    const existingUser = await query(
      `
        SELECT id
        FROM users
        WHERE LOWER(username) = LOWER($1) AND id != $2
        LIMIT 1
      `,
      [normalizedUsername, userId],
    );

    if (existingUser.rows.length > 0) {
      throw new ServiceError(409, "Username already exists.");
    }

    const updated = await query(
      `
        UPDATE users
        SET username = $1, first_name = $2, last_name = $3, email = $4, updated_at = NOW()
        WHERE id = $5
        RETURNING id, username, email, first_name, last_name, avatar_path, theme_preference, notification_collaborator_invites, notification_ask_permission
      `,
      [normalizedUsername, normalizedFirstName, normalizedLastName, normalizedEmail, userId],
    );

    if (updated.rows.length === 0) {
      throw new ServiceError(404, "User not found.");
    }

    return toUserPayload(updated.rows[0]);
  }

  async function uploadAvatarById(userId, { buffer, mimeType }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new ServiceError(400, "Please upload an avatar image.");
    }

    if (buffer.length > MAX_AVATAR_SIZE_BYTES) {
      throw new ServiceError(400, "Avatar must be 1MB or smaller.");
    }

    const extension = AVATAR_EXTENSION_BY_MIME[mimeType];
    if (!extension) {
      throw new ServiceError(400, "Avatar must be JPG, PNG, GIF, or WEBP.");
    }

    if (!avatarUploadDir) {
      throw new ServiceError(500, "Avatar upload directory is not configured.");
    }

    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const currentUser = await query(
      `
        SELECT id, username, email, first_name, last_name, avatar_path, avatar_hash, theme_preference, notification_collaborator_invites, notification_ask_permission
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId],
    );

    if (currentUser.rows.length === 0) {
      throw new ServiceError(404, "User not found.");
    }

    const existingProfile = currentUser.rows[0];
    if (existingProfile.avatar_hash === hash && existingProfile.avatar_path) {
      return toUserPayload(existingProfile);
    }

    const cachedAvatarLookup = await query(
      `
        SELECT avatar_path
        FROM users
        WHERE avatar_hash = $1 AND avatar_path IS NOT NULL
        LIMIT 1
      `,
      [hash],
    );

    await fs.mkdir(avatarUploadDir, { recursive: true });

    const cachedAvatarPath = cachedAvatarLookup.rows[0]?.avatar_path || "";
    const cachedFilename =
      typeof cachedAvatarPath === "string" && cachedAvatarPath.startsWith("/uploads/avatars/")
        ? cachedAvatarPath.slice("/uploads/avatars/".length)
        : "";
    const filename = cachedFilename || `${hash}${extension}`;
    const absoluteFilePath = path.join(avatarUploadDir, filename);
    const publicAvatarPath = `/uploads/avatars/${filename}`;

    await fs.access(absoluteFilePath).catch(async () => {
      await fs.writeFile(absoluteFilePath, buffer);
    });

    const updated = await query(
      `
        UPDATE users
        SET avatar_path = $1, avatar_hash = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, username, email, first_name, last_name, avatar_path, avatar_hash, theme_preference, notification_collaborator_invites, notification_ask_permission
      `,
      [publicAvatarPath, hash, userId],
    );

    if (updated.rows.length === 0) {
      throw new ServiceError(404, "User not found.");
    }

    return toUserPayload(updated.rows[0]);
  }

  async function updateThemePreferenceById(userId, themePreference) {
    const normalizedThemePreference = String(themePreference || "")
      .trim()
      .toLowerCase();
    ensureValidThemePreference(normalizedThemePreference);

    const updated = await query(
      `
        UPDATE users
        SET theme_preference = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, username, email, first_name, last_name, avatar_path, theme_preference, notification_collaborator_invites, notification_ask_permission
      `,
      [normalizedThemePreference, userId],
    );

    if (updated.rows.length === 0) {
      throw new ServiceError(404, "User not found.");
    }

    return toUserPayload(updated.rows[0]);
  }

  async function updateNotificationPreferencesById(userId, notificationPreferences) {
    const collaboratorInvites = normalizeNotificationPreferenceValue(
      notificationPreferences?.collaboratorInvites,
      DEFAULT_NOTIFICATION_COLLABORATOR_INVITES,
    );
    const askPermission = normalizeNotificationPreferenceValue(
      notificationPreferences?.askPermission,
      DEFAULT_NOTIFICATION_ASK_PERMISSION,
    );

    const updated = await query(
      `
        UPDATE users
        SET notification_collaborator_invites = $1, notification_ask_permission = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, username, email, first_name, last_name, avatar_path, theme_preference, notification_collaborator_invites, notification_ask_permission
      `,
      [collaboratorInvites, askPermission, userId],
    );

    if (updated.rows.length === 0) {
      throw new ServiceError(404, "User not found.");
    }

    return toUserPayload(updated.rows[0]);
  }

  async function changePasswordById(userId, { currentPassword, newPassword, confirmNewPassword }) {
    const currentPasswordValue = String(currentPassword || "");
    const newPasswordValue = String(newPassword || "");
    const confirmNewPasswordValue = String(confirmNewPassword || "");

    if (!currentPasswordValue || !newPasswordValue || !confirmNewPasswordValue) {
      throw new ServiceError(400, "Current password, new password, and confirmation are required.");
    }

    if (newPasswordValue !== confirmNewPasswordValue) {
      throw new ServiceError(400, "New password and confirmation do not match.");
    }

    if (currentPasswordValue === newPasswordValue) {
      throw new ServiceError(400, "New password must be different from current password.");
    }

    ensureValidPassword(newPasswordValue);

    const userLookup = await query(
      `
        SELECT id, password_hash
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId],
    );

    if (userLookup.rows.length === 0) {
      throw new ServiceError(404, "User not found.");
    }

    const isCurrentPasswordValid = await bcryptImpl.compare(
      currentPasswordValue,
      userLookup.rows[0].password_hash,
    );
    if (!isCurrentPasswordValid) {
      throw new ServiceError(400, "Current password is incorrect.");
    }

    const passwordHash = await bcryptImpl.hash(newPasswordValue, BCRYPT_SALT_ROUNDS);
    await query(
      `
        UPDATE users
        SET password_hash = $1, updated_at = NOW()
        WHERE id = $2
      `,
      [passwordHash, userId],
    );
  }

  async function listSessionsByUserId(userId, currentSessionId) {
    const sessionsResult = await query(
      `
        SELECT id, user_agent, created_at, last_active_at, expires_at
        FROM user_sessions
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        ORDER BY last_active_at DESC, created_at DESC
      `,
      [userId],
    );

    const normalizedCurrentSessionId = String(currentSessionId || "").trim();
    return sessionsResult.rows.map((session) => ({
      id: session.id,
      deviceLabel: formatSessionLabel(session.user_agent),
      locationLabel: "Unknown location",
      createdAt: session.created_at,
      lastActiveAt: session.last_active_at,
      expiresAt: session.expires_at,
      isCurrentSession: normalizedCurrentSessionId === session.id,
    }));
  }

  async function revokeSessionById(userId, sessionId, currentSessionId) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw new ServiceError(400, "Session ID is required.");
    }

    if (normalizedSessionId === String(currentSessionId || "").trim()) {
      throw new ServiceError(400, "Current session cannot be revoked from this action.");
    }

    const revoked = await query(
      `
        UPDATE user_sessions
        SET revoked_at = NOW(), revoked_reason = 'manual'
        WHERE id = $1
          AND user_id = $2
          AND revoked_at IS NULL
        RETURNING id
      `,
      [normalizedSessionId, userId],
    );

    if (revoked.rows.length === 0) {
      throw new ServiceError(404, "Session not found.");
    }

    return revoked.rows[0].id;
  }

  async function revokeOtherSessionsByUserId(userId, currentSessionId) {
    const normalizedCurrentSessionId = String(currentSessionId || "").trim();
    const revoked = await query(
      `
        UPDATE user_sessions
        SET revoked_at = NOW(), revoked_reason = 'logout_others'
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND id != $2
        RETURNING id
      `,
      [userId, normalizedCurrentSessionId],
    );

    return revoked.rows.map((row) => row.id);
  }

  async function initiatePasswordReset(email) {
    const normalizedEmail = String(email || "").trim();
    if (!normalizedEmail) {
      throw new ServiceError(400, "Email is required.");
    }

    const userRow = await query(
      `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail],
    );

    if (userRow.rows.length === 0) {
      throw new ServiceError(404, "Email is not registered.");
    }

    const user = userRow.rows[0];
    const code = crypto.randomBytes(3).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await query(
      `
        INSERT INTO password_reset_tokens (user_id, code, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET
          code = $2,
          expires_at = $3,
          created_at = NOW()
      `,
      [user.id, code, expiresAt],
    );

    try {
      if (emailService) {
        await emailService.sendPasswordResetEmail({
          to: user.email,
          code,
        });
      }
    } catch (error) {
      console.error("Failed to send password reset email:", error);
    }

    return { email: user.email, code };
  }

  async function verifyPasswordResetCode(email, code) {
    const normalizedEmail = String(email || "").trim();
    const normalizedCode = String(code || "")
      .trim()
      .toUpperCase();

    if (!normalizedEmail || !normalizedCode) {
      throw new ServiceError(400, "Email and code are required.");
    }

    const userRow = await query(
      `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail],
    );

    if (userRow.rows.length === 0) {
      throw new ServiceError(404, "Email is not registered.");
    }

    const user = userRow.rows[0];

    const tokenRow = await query(
      `
        SELECT code, expires_at FROM password_reset_tokens
        WHERE user_id = $1 AND expires_at > NOW()
        LIMIT 1
      `,
      [user.id],
    );

    if (tokenRow.rows.length === 0) {
      throw new ServiceError(400, "No valid reset request found. Please request a new reset.");
    }

    const token = tokenRow.rows[0];
    if (token.code !== normalizedCode) {
      throw new ServiceError(400, "Invalid verification code.");
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await query(
      `UPDATE password_reset_tokens SET verified_at = NOW(), reset_token = $1, reset_expires_at = $2 WHERE user_id = $3`,
      [resetToken, resetExpiresAt, user.id],
    );

    return resetToken;
  }

  async function resetPassword(resetToken, newPassword) {
    const normalizedToken = String(resetToken || "").trim();
    const passwordValue = String(newPassword || "");

    if (!normalizedToken || !passwordValue) {
      throw new ServiceError(400, "Reset token and password are required.");
    }

    ensureValidPassword(passwordValue);

    const tokenRow = await query(
      `
        SELECT user_id, reset_expires_at FROM password_reset_tokens
        WHERE reset_token = $1 AND reset_expires_at > NOW()
        LIMIT 1
      `,
      [normalizedToken],
    );

    if (tokenRow.rows.length === 0) {
      throw new ServiceError(400, "Invalid or expired reset token.");
    }

    const userId = tokenRow.rows[0].user_id;
    const passwordHash = await bcryptImpl.hash(passwordValue, BCRYPT_SALT_ROUNDS);

    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);

    await query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);

    const userRow = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
    if (userRow.rows.length === 0) {
      throw new ServiceError(404, "User not found.");
    }

    return toUserPayload(userRow.rows[0]);
  }

  return {
    registerUser,
    loginUser,
    getProfileById,
    updateProfileById,
    uploadAvatarById,
    updateThemePreferenceById,
    updateNotificationPreferencesById,
    changePasswordById,
    listSessionsByUserId,
    revokeSessionById,
    revokeOtherSessionsByUserId,
    initiatePasswordReset,
    verifyPasswordResetCode,
    resetPassword,
  };
}

module.exports = {
  createAuthService,
};
