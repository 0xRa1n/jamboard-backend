const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const express = require("express");
const createAuthRouter = require("../routes/auth.routes");
const { initializeDatabase, query, closeDatabase } = require("../database");

const requiredDbEnvKeys = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DATABASE",
];

const canRunIntegrationTests = requiredDbEnvKeys.every((key) => Boolean(process.env[key]));

let server;
let baseUrl = "";

function request(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function requestWithToken(path, token, body, method = "PATCH") {
  const hasBody = body !== undefined;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });
}

before(async () => {
  if (!canRunIntegrationTests) {
    return;
  }

  await initializeDatabase();
  await query("TRUNCATE TABLE boards, users RESTART IDENTITY CASCADE");

  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ query, jwtSecret: "integration-test-secret" }));

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  if (!canRunIntegrationTests) {
    return;
  }

  await query("TRUNCATE TABLE boards, users RESTART IDENTITY CASCADE");
});

after(async () => {
  if (!canRunIntegrationTests) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  await closeDatabase();
});

test("register creates a new user", { skip: !canRunIntegrationTests }, async () => {
  const response = await request("/api/auth/register", {
    firstName: "Sam",
    lastName: "Lee",
    username: "sam",
    password: "secure-password-123",
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.message, "User registered successfully.");
  assert.equal(payload.user.username, "sam");
  assert.equal(typeof payload.user.id, "number");
});

test(
  "register rejects duplicate usernames case-insensitively",
  { skip: !canRunIntegrationTests },
  async () => {
    await request("/api/auth/register", {
      firstName: "Sam",
      lastName: "One",
      username: "Sam",
      password: "secure-password-123",
    });

    const duplicateResponse = await request("/api/auth/register", {
      firstName: "Sam",
      lastName: "Two",
      username: "sam",
      password: "another-secure-password-123",
    });
    const payload = await duplicateResponse.json();

    assert.equal(duplicateResponse.status, 409);
    assert.equal(payload.message, "Username already exists.");
  },
);

test("login returns token for valid credentials", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponse = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const payload = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(payload.message, "Login successful.");
  assert.equal(typeof payload.token, "string");
  assert.equal(payload.user.username, "jam-user");
});

test("login rejects invalid credentials", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponse = await request("/api/auth/login", {
    username: "jam-user",
    password: "wrong-password",
  });
  const payload = await loginResponse.json();

  assert.equal(loginResponse.status, 401);
  assert.equal(payload.message, "Invalid username or password.");
});

test("me returns the authenticated user", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponse = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayload = await loginResponse.json();

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${loginPayload.token}`,
    },
  });
  const mePayload = await meResponse.json();

  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.user.username, "jam-user");
  assert.equal(mePayload.user.firstName, "Jam");
  assert.equal(mePayload.user.lastName, "User");
  assert.equal(mePayload.user.themePreference, "light");
  assert.equal(typeof mePayload.user.id, "number");
});

test("me profile can be updated", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponse = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayload = await loginResponse.json();

  const updateResponse = await fetch(`${baseUrl}/api/auth/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginPayload.token}`,
    },
    body: JSON.stringify({
      username: "reen-dev",
      firstName: "Reen",
      lastName: "Dev",
      email: "reen@example.com",
    }),
  });
  const updatePayload = await updateResponse.json();

  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.user.firstName, "Reen");
  assert.equal(updatePayload.user.lastName, "Dev");
  assert.equal(updatePayload.user.username, "reen-dev");
  assert.equal(updatePayload.user.email, "reen@example.com");
});

test("theme preference can be updated", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponse = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayload = await loginResponse.json();

  const updateThemeResponse = await fetch(`${baseUrl}/api/auth/me/theme`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginPayload.token}`,
    },
    body: JSON.stringify({
      themePreference: "dark",
    }),
  });
  const updateThemePayload = await updateThemeResponse.json();

  assert.equal(updateThemeResponse.status, 200);
  assert.equal(updateThemePayload.user.themePreference, "dark");
});

test("notification preferences can be updated", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponse = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayload = await loginResponse.json();

  const updateResponse = await requestWithToken("/api/auth/me/notifications", loginPayload.token, {
    collaboratorInvites: false,
    askPermission: true,
  });
  const updatePayload = await updateResponse.json();

  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.user.notificationPreferences.collaboratorInvites, false);
  assert.equal(updatePayload.user.notificationPreferences.askPermission, true);
});

test("password can be updated", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponse = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayload = await loginResponse.json();

  const updatePasswordResponse = await requestWithToken(
    "/api/auth/me/password",
    loginPayload.token,
    {
      currentPassword: "secure-password-123",
      newPassword: "new-secure-password-123",
      confirmNewPassword: "new-secure-password-123",
    },
  );
  assert.equal(updatePasswordResponse.status, 200);

  const oldPasswordLogin = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  assert.equal(oldPasswordLogin.status, 401);

  const newPasswordLogin = await request("/api/auth/login", {
    username: "jam-user",
    password: "new-secure-password-123",
  });
  assert.equal(newPasswordLogin.status, 200);
});

test("active sessions can be listed and revoked", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponseOne = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayloadOne = await loginResponseOne.json();

  const loginResponseTwo = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayloadTwo = await loginResponseTwo.json();

  const sessionsResponse = await fetch(`${baseUrl}/api/auth/me/sessions`, {
    headers: {
      Authorization: `Bearer ${loginPayloadOne.token}`,
    },
  });
  const sessionsPayload = await sessionsResponse.json();
  assert.equal(sessionsResponse.status, 200);
  assert.equal(Array.isArray(sessionsPayload.sessions), true);
  assert.equal(sessionsPayload.sessions.length >= 2, true);

  const sessionToRevoke = sessionsPayload.sessions.find((session) => !session.isCurrentSession);
  assert.ok(sessionToRevoke);

  const revokeResponse = await requestWithToken(
    `/api/auth/me/sessions/${sessionToRevoke.id}`,
    loginPayloadOne.token,
    undefined,
    "DELETE",
  );
  assert.equal(revokeResponse.status, 200);

  const meWithRevokedSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${loginPayloadTwo.token}`,
    },
  });
  assert.equal(meWithRevokedSession.status, 401);
});

test("other sessions can be signed out", { skip: !canRunIntegrationTests }, async () => {
  await request("/api/auth/register", {
    firstName: "Jam",
    lastName: "User",
    username: "jam-user",
    password: "secure-password-123",
  });

  const loginResponseOne = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayloadOne = await loginResponseOne.json();

  const loginResponseTwo = await request("/api/auth/login", {
    username: "jam-user",
    password: "secure-password-123",
  });
  const loginPayloadTwo = await loginResponseTwo.json();

  const signOutOthersResponse = await requestWithToken(
    "/api/auth/me/sessions/revoke-others",
    loginPayloadOne.token,
    {},
    "POST",
  );
  assert.equal(signOutOthersResponse.status, 200);

  const meCurrentResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${loginPayloadOne.token}`,
    },
  });
  assert.equal(meCurrentResponse.status, 200);

  const meOtherResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${loginPayloadTwo.token}`,
    },
  });
  assert.equal(meOtherResponse.status, 401);
});
