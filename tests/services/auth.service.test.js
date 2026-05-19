const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createAuthService } = require("../../services/authService");
const { ServiceError } = require("../../services/serviceError");

function makeBcryptStub() {
  return {
    hash: async () => "hash",
    compare: async () => true,
  };
}

function makeJwtStub() {
  return {
    sign: () => "token",
  };
}

test("registerUser normalizes username and assigns default email", async () => {
  const queries = [];
  const query = async (text, params) => {
    const normalized = String(text).replace(/\s+/g, " ").trim();
    queries.push({ normalized, params });

    if (normalized.startsWith("SELECT id FROM users")) {
      return { rows: [] };
    }

    if (normalized.startsWith("INSERT INTO users")) {
      return {
        rows: [
          {
            id: 1,
            username: params[0],
            email: params[2],
            first_name: params[3],
            last_name: params[4],
            created_at: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
    }

    if (normalized.startsWith("INSERT INTO workspaces")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const authService = createAuthService({
    query,
    jwtSecret: "secret",
    bcryptImpl: makeBcryptStub(),
    jwtImpl: makeJwtStub(),
  });

  const user = await authService.registerUser({
    firstName: "Sam",
    lastName: "Lee",
    username: " Sam ",
    password: "password123",
    email: "",
  });

  assert.equal(user.username, "Sam");
  assert.equal(user.email, "sam@example.com");
  assert.equal(user.firstName, "Sam");
  assert.equal(user.lastName, "Lee");
  assert.equal(user.id, 1);
});

test("loginUser rejects invalid credentials", async () => {
  const query = async (text) => {
    const normalized = String(text).replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT id, username")) {
      return {
        rows: [
          {
            id: 2,
            username: "jam-user",
            password_hash: "hash",
            email: "jam-user@example.com",
            first_name: "Jam",
            last_name: "User",
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  };

  const authService = createAuthService({
    query,
    jwtSecret: "secret",
    bcryptImpl: { compare: async () => false },
    jwtImpl: makeJwtStub(),
  });

  let error;
  try {
    await authService.loginUser({ username: "jam-user", password: "wrong" });
  } catch (err) {
    error = err;
  }

  assert.ok(error instanceof ServiceError);
  assert.equal(error.status, 401);
});

test("updateProfileById updates username and profile fields", async () => {
  const query = async (text, params) => {
    const normalized = String(text).replace(/\s+/g, " ").trim();

    if (
      normalized.startsWith("SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2")
    ) {
      return { rows: [] };
    }

    if (normalized.startsWith("UPDATE users SET username = $1")) {
      return {
        rows: [
          {
            id: 1,
            username: params[0],
            first_name: params[1],
            last_name: params[2],
            email: params[3],
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const authService = createAuthService({
    query,
    jwtSecret: "secret",
    bcryptImpl: makeBcryptStub(),
    jwtImpl: makeJwtStub(),
  });

  const user = await authService.updateProfileById(1, {
    username: "reen-dev",
    firstName: "Reen",
    lastName: "Dev",
    email: "reen@example.com",
  });

  assert.equal(user.username, "reen-dev");
  assert.equal(user.firstName, "Reen");
  assert.equal(user.lastName, "Dev");
  assert.equal(user.email, "reen@example.com");
});

test("uploadAvatarById reuses cached avatar path from previous uploads", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jamboard-avatar-test-"));
  const avatarUploadDir = path.join(tempDir, "avatars");

  try {
    const calls = [];
    const query = async (text, params) => {
      const normalized = String(text).replace(/\s+/g, " ").trim();
      calls.push({ normalized, params });

      if (
        normalized.startsWith(
          "SELECT id, username, email, first_name, last_name, avatar_path, avatar_hash, theme_preference",
        )
      ) {
        return {
          rows: [
            {
              id: 7,
              username: "jam-user",
              email: "jam-user@example.com",
              first_name: "Jam",
              last_name: "User",
              avatar_path: null,
              avatar_hash: null,
              theme_preference: "light",
            },
          ],
        };
      }

      if (
        normalized.startsWith(
          "SELECT avatar_path FROM users WHERE avatar_hash = $1 AND avatar_path IS NOT NULL LIMIT 1",
        )
      ) {
        return { rows: [{ avatar_path: "/uploads/avatars/existing-shared-avatar.png" }] };
      }

      if (
        normalized.startsWith(
          "UPDATE users SET avatar_path = $1, avatar_hash = $2, updated_at = NOW() WHERE id = $3",
        )
      ) {
        return {
          rows: [
            {
              id: 7,
              username: "jam-user",
              email: "jam-user@example.com",
              first_name: "Jam",
              last_name: "User",
              avatar_path: params[0],
              avatar_hash: params[1],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    };

    const authService = createAuthService({
      query,
      jwtSecret: "secret",
      bcryptImpl: makeBcryptStub(),
      jwtImpl: makeJwtStub(),
      avatarUploadDir,
    });

    const user = await authService.uploadAvatarById(7, {
      buffer: Buffer.from("sample-image"),
      mimeType: "image/png",
    });

    assert.equal(user.avatarUrl, "/uploads/avatars/existing-shared-avatar.png");
    await fs.access(path.join(avatarUploadDir, "existing-shared-avatar.png"));

    const updateCall = calls.find((entry) =>
      entry.normalized.startsWith(
        "UPDATE users SET avatar_path = $1, avatar_hash = $2, updated_at = NOW() WHERE id = $3",
      ),
    );
    assert.ok(updateCall);
    assert.equal(updateCall.params[0], "/uploads/avatars/existing-shared-avatar.png");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("updateThemePreferenceById updates user theme preference", async () => {
  const query = async (text, params) => {
    const normalized = String(text).replace(/\s+/g, " ").trim();

    if (
      normalized.startsWith(
        "UPDATE users SET theme_preference = $1, updated_at = NOW() WHERE id = $2",
      )
    ) {
      return {
        rows: [
          {
            id: params[1],
            username: "jam-user",
            email: "jam@example.com",
            first_name: "Jam",
            last_name: "User",
            avatar_path: "",
            theme_preference: params[0],
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const authService = createAuthService({
    query,
    jwtSecret: "secret",
    bcryptImpl: makeBcryptStub(),
    jwtImpl: makeJwtStub(),
  });

  const updated = await authService.updateThemePreferenceById(3, "dark");
  assert.equal(updated.themePreference, "dark");
});

test("updateNotificationPreferencesById updates notification settings", async () => {
  const query = async (text, params) => {
    const normalized = String(text).replace(/\s+/g, " ").trim();

    if (
      normalized.startsWith(
        "UPDATE users SET notification_collaborator_invites = $1, notification_ask_permission = $2, updated_at = NOW() WHERE id = $3",
      )
    ) {
      return {
        rows: [
          {
            id: params[2],
            username: "jam-user",
            email: "jam@example.com",
            first_name: "Jam",
            last_name: "User",
            avatar_path: "",
            theme_preference: "light",
            notification_collaborator_invites: params[0],
            notification_ask_permission: params[1],
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const authService = createAuthService({
    query,
    jwtSecret: "secret",
    bcryptImpl: makeBcryptStub(),
    jwtImpl: makeJwtStub(),
  });

  const updated = await authService.updateNotificationPreferencesById(3, {
    collaboratorInvites: false,
    askPermission: true,
  });
  assert.equal(updated.notificationPreferences.collaboratorInvites, false);
  assert.equal(updated.notificationPreferences.askPermission, true);
});

test("changePasswordById validates current password and updates hash", async () => {
  const calls = [];
  const query = async (text, params) => {
    const normalized = String(text).replace(/\s+/g, " ").trim();
    calls.push({ normalized, params });

    if (normalized.startsWith("SELECT id, password_hash FROM users WHERE id = $1")) {
      return {
        rows: [{ id: params[0], password_hash: "old-hash" }],
      };
    }

    if (
      normalized.startsWith("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2")
    ) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const bcryptStub = {
    hash: async (password) => `hash:${password}`,
    compare: async (password, hash) => password === "old-password" && hash === "old-hash",
  };

  const authService = createAuthService({
    query,
    jwtSecret: "secret",
    bcryptImpl: bcryptStub,
    jwtImpl: makeJwtStub(),
  });

  await authService.changePasswordById(3, {
    currentPassword: "old-password",
    newPassword: "new-password-123",
    confirmNewPassword: "new-password-123",
  });

  const updateCall = calls.find((entry) =>
    entry.normalized.startsWith(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
    ),
  );
  assert.ok(updateCall);
  assert.equal(updateCall.params[0], "hash:new-password-123");
  assert.equal(updateCall.params[1], 3);
});

test("listSessionsByUserId returns mapped active sessions", async () => {
  const query = async (text) => {
    const normalized = String(text).replace(/\s+/g, " ").trim();
    if (
      normalized.startsWith(
        "SELECT id, user_agent, created_at, last_active_at, expires_at FROM user_sessions",
      )
    ) {
      return {
        rows: [
          {
            id: "session-1",
            user_agent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
            created_at: "2026-01-01T00:00:00.000Z",
            last_active_at: "2026-01-01T00:10:00.000Z",
            expires_at: "2026-01-01T12:00:00.000Z",
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  };

  const authService = createAuthService({
    query,
    jwtSecret: "secret",
    bcryptImpl: makeBcryptStub(),
    jwtImpl: makeJwtStub(),
  });

  const sessions = await authService.listSessionsByUserId(3, "session-1");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].isCurrentSession, true);
  assert.equal(sessions[0].deviceLabel, "Mac OS • Chrome");
});
