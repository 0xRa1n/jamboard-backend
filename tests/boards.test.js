const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const createBoardsRouter = require("../routes/boards.routes");

const jwtSecret = "boards-test-secret";
const boardsByUser = new Map();
let nextBoardId = 1;

function makeQuery() {
  return async (text, params = []) => {
    const normalizedText = String(text).replace(/\s+/g, " ").trim();

    if (normalizedText.startsWith("SELECT id FROM user_sessions")) {
      return {
        rows: [{ id: params[0] }],
      };
    }

    if (normalizedText.startsWith("UPDATE user_sessions SET last_active_at = NOW()")) {
      return {
        rows: [],
      };
    }

    if (
      normalizedText.startsWith(
        "SELECT id, title, thumbnail, theme, created_at, updated_at FROM boards",
      )
    ) {
      const userId = params[0];
      const workspaceId = params[1];
      const boards = boardsByUser.get(userId) || [];
      const workspaceBoards = boards.filter((b) => b.workspaceId === workspaceId);
      return {
        rows: workspaceBoards.map((board) => ({
          id: board.id,
          title: board.title,
          thumbnail: board.thumbnail || null,
          theme: "light",
          created_at: board.createdAt,
          updated_at: board.updatedAt,
        })),
      };
    }

    if (normalizedText.startsWith("INSERT INTO boards (user_id, workspace_id, title)")) {
      const [userId, workspaceId, title] = params;
      const now = new Date().toISOString();
      const board = {
        id: nextBoardId++,
        title,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      };
      const boards = boardsByUser.get(userId) || [];
      boards.unshift(board);
      boardsByUser.set(userId, boards);
      return {
        rows: [
          {
            id: board.id,
            title: board.title,
            theme: "light",
            created_at: board.createdAt,
            updated_at: board.updatedAt,
          },
        ],
      };
    }

    if (
      normalizedText.startsWith(
        "UPDATE boards SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING id, title, thumbnail, theme, created_at, updated_at",
      )
    ) {
      const [title, boardId, userId] = params;
      const boards = boardsByUser.get(userId) || [];
      const board = boards.find((item) => item.id === boardId);

      if (!board) {
        return { rows: [] };
      }

      const now = new Date().toISOString();
      board.title = title;
      board.updatedAt = now;

      return {
        rows: [
          {
            id: board.id,
            title: board.title,
            theme: "light",
            created_at: board.createdAt,
            updated_at: board.updatedAt,
          },
        ],
      };
    }

    if (
      normalizedText.startsWith(
        "UPDATE boards SET thumbnail = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
      )
    ) {
      const [thumbnail, boardId, userId] = params;
      const boards = boardsByUser.get(userId) || [];
      const board = boards.find((item) => item.id === boardId);
      if (!board) return { rows: [] };
      board.thumbnail = thumbnail;
      return { rows: [{ id: board.id }] };
    }

    if (normalizedText.startsWith("DELETE FROM boards WHERE id = $1 AND user_id = $2")) {
      const [boardId, userId] = params;
      const boards = boardsByUser.get(userId) || [];
      const index = boards.findIndex((item) => item.id === boardId);
      if (index === -1) return { rows: [] };
      const [removed] = boards.splice(index, 1);
      return { rows: [{ id: removed.id }] };
    }

    throw new Error(`Unexpected query: ${normalizedText}`);
  };
}

beforeEach(() => {
  boardsByUser.clear();
  nextBoardId = 1;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/boards", createBoardsRouter({ query: makeQuery(), jwtSecret }));
  return app;
}

function authHeaders(userId = 1, username = "sam") {
  return {
    Authorization: `Bearer ${jwt.sign(
      { sub: userId, username, sid: `session-${userId}` },
      jwtSecret,
    )}`,
  };
}

test("boards list is scoped to the authenticated user", async () => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    await fetch(`http://127.0.0.1:${server.address().port}/api/boards`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(1, "sam"),
      },
      body: JSON.stringify({ title: "Planning", workspaceId: 1 }),
    });

    await fetch(`http://127.0.0.1:${server.address().port}/api/boards`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(2, "alex"),
      },
      body: JSON.stringify({ title: "Design", workspaceId: 1 }),
    });

    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/boards?workspaceId=1`,
      {
        headers: authHeaders(1, "sam"),
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.boards.length, 1);
    assert.equal(payload.boards[0].title, "Planning");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("boards create applies a fallback title", async () => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/boards`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ title: "   ", workspaceId: 1 }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.board.title, "Untitled board");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("boards rename updates the title for the owning user", async () => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    await fetch(`http://127.0.0.1:${server.address().port}/api/boards`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(1, "sam"),
      },
      body: JSON.stringify({ title: "Old title", workspaceId: 1 }),
    });

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/boards/1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(1, "sam"),
      },
      body: JSON.stringify({ title: "New title" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.board.title, "New title");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
