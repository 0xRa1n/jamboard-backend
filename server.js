const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const WebSocket = require("ws");
const { config, assertJwtSecret } = require("./config");
const createAuthRouter = require("./routes/auth.routes");
const createBoardsRouter = require("./routes/boards.routes");
const createNotificationsRouter = require("./routes/notifications.routes");
const createWorkspacesRouter = require("./routes/workspaces.routes");
const { errorHandler } = require("./middleware/errorHandler");
const { query, initializeDatabase, closeDatabase } = require("./database");
const { verifySessionToken, toNumericId } = require("./services/sessionService");

assertJwtSecret();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const sessionSockets = new Map();

const uploadsRootDir = path.join(__dirname, "uploads");
const avatarUploadDir = path.join(uploadsRootDir, "avatars");

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(cors({
  origin: frontendUrl,
  credentials: true,
}));
app.use(express.json());
app.use(
  "/uploads",
  express.static(uploadsRootDir, {
    etag: true,
    immutable: true,
    maxAge: "1y",
  }),
);
app.use(
  "/api/v1/auth",
  createAuthRouter({
    query,
    jwtSecret: config.jwtSecret,
    avatarUploadDir,
    onSessionRevoked: handleSessionRevoked,
    onOtherSessionsRevoked: handleOtherSessionsRevoked,
    emailConfig: {
      connectionString: config.acsConnectionString,
      senderAddress: config.acsSenderAddress,
    },
  }),
);
app.use("/api/v1/workspaces", createWorkspacesRouter({ query, jwtSecret: config.jwtSecret }));

function handleShareRevoked(boardId) {
  const session = boardSessions.get(boardId);
  if (session) {
    const revokedMsg = JSON.stringify({ type: "access_revoked" });
    session.clients.forEach((client) => {
      if (client.isReadOnly) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(revokedMsg);
          client.close(4003, "Share link revoked");
        }
      }
    });
  }
}

function handlePermissionGranted(boardId, userId) {
  const session = boardSessions.get(boardId);
  if (!session) return;

  const message = JSON.stringify({ type: "permission_updated" });
  session.clients.forEach((client) => {
    if (client.userId === userId && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function registerSessionSocket(sessionId, ws) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return;

  if (!sessionSockets.has(normalizedSessionId)) {
    sessionSockets.set(normalizedSessionId, new Set());
  }
  sessionSockets.get(normalizedSessionId).add(ws);
}

function unregisterSessionSocket(sessionId, ws) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !sessionSockets.has(normalizedSessionId)) {
    return;
  }

  const sockets = sessionSockets.get(normalizedSessionId);
  sockets.delete(ws);
  if (sockets.size === 0) {
    sessionSockets.delete(normalizedSessionId);
  }
}

function terminateSessionSockets(sessionId, reason = "Session revoked") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return;

  const sockets = sessionSockets.get(normalizedSessionId);
  if (!sockets || sockets.size === 0) return;

  const message = JSON.stringify({ type: "session_revoked" });
  sockets.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      socket.close(4001, reason);
    }
  });
}

function handleSessionRevoked(sessionId) {
  terminateSessionSockets(sessionId, "Session revoked");
}

function handleOtherSessionsRevoked(sessionIds) {
  if (!Array.isArray(sessionIds)) return;
  sessionIds.forEach((sessionId) =>
    terminateSessionSockets(sessionId, "Signed out from another device"),
  );
}

app.use(
  "/api/v1/boards",
  createBoardsRouter({
    query,
    jwtSecret: config.jwtSecret,
    onShareRevoked: handleShareRevoked,
    emailConfig: {
      connectionString: config.acsConnectionString,
      senderAddress: config.acsSenderAddress,
    },
  }),
);

app.use(
  "/api/v1/notifications",
  createNotificationsRouter({
    query,
    jwtSecret: config.jwtSecret,
    onPermissionGranted: handlePermissionGranted,
  }),
);

// Health endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// --- Per-board session management ---

const boardSessions = new Map();
const FLUSH_DELAY_MS = 1500;
const SESSION_GRACE_MS = 5 * 60 * 1000; // 5 minutes
const VALID_BOARD_THEMES = new Set(["light", "dark"]);

function normalizeBoardTheme(theme) {
  const normalizedTheme = typeof theme === "string" ? theme.trim().toLowerCase() : "light";
  return VALID_BOARD_THEMES.has(normalizedTheme) ? normalizedTheme : "light";
}

function applyHistory(history) {
  const lines = [];
  const linesToRemove = new Set();

  history.forEach((action) => {
    if (action.type === "draw") {
      lines.push(action.line);
    } else if (action.type === "erase") {
      action.lineIds.forEach((id) => linesToRemove.add(id));
    }
  });

  return lines.filter((line) => !linesToRemove.has(line.id));
}

function popLastActionGroup(history) {
  if (history.length === 0) return [];

  const lastAction = history[history.length - 1];
  if (lastAction.type !== "draw" || !lastAction.line?.strokeId) {
    return [history.pop()];
  }

  const strokeId = lastAction.line.strokeId;
  const popped = [];

  while (history.length > 0) {
    const action = history[history.length - 1];
    if (action.type === "draw" && action.line?.strokeId === strokeId) {
      popped.push(history.pop());
    } else {
      break;
    }
  }

  return popped;
}

function broadcastState(session) {
  const currentLines = applyHistory(session.history);
  const stateMessage = JSON.stringify({
    type: "state",
    lines: currentLines,
    images: session.images || [],
    theme: session.theme,
  });
  session.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(stateMessage);
    }
  });
}

function broadcastAction(session, action, senderWs) {
  const message = JSON.stringify(action);
  session.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== senderWs) {
      client.send(message);
    }
  });
}

function broadcastPresence(session) {
  const users = Array.from(session.clients).map((client) => client.username);
  const presenceMsg = JSON.stringify({ type: "presence", users });
  session.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(presenceMsg);
    }
  });
}

function getBoardSession(boardId) {
  if (!boardSessions.has(boardId)) {
    boardSessions.set(boardId, {
      history: [],
      images: [],
      redoStack: [],
      theme: "light",
      clients: new Set(),
      flushTimer: null,
      graceTimer: null,
      loaded: false,
    });
  }
  return boardSessions.get(boardId);
}

async function loadBoardState(boardId) {
  try {
    const result = await query("SELECT content, theme FROM boards WHERE id = $1", [boardId]);
    if (result.rows.length === 0) {
      return { lines: [], images: [], theme: "light" };
    }
    const content = result.rows[0].content;
    let lines = [];
    let images = [];
    if (Array.isArray(content)) {
      lines = content;
    } else if (content && typeof content === "object") {
      lines = content.lines || [];
      images = content.images || [];
    }
    return {
      lines,
      images,
      theme: normalizeBoardTheme(result.rows[0].theme),
    };
  } catch (err) {
    console.error(`Failed to load state for board ${boardId}:`, err.message);
    return { lines: [], images: [], theme: "light" };
  }
}

async function flushBoardContent(boardId, session) {
  const lines = applyHistory(session.history);
  const contentObj = {
    lines,
    images: session.images || [],
  };
  await query("UPDATE boards SET content = $1, theme = $2, updated_at = NOW() WHERE id = $3", [
    JSON.stringify(contentObj),
    normalizeBoardTheme(session.theme),
    boardId,
  ]);
}

function scheduleFlush(boardId, session) {
  if (session.flushTimer) clearTimeout(session.flushTimer);
  session.flushTimer = setTimeout(async () => {
    try {
      await flushBoardContent(boardId, session);
    } catch (err) {
      console.error(`Failed to flush board ${boardId}:`, err.message);
    }
  }, FLUSH_DELAY_MS);
}

// --- WebSocket upgrade handler (route by path) ---

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/socket/")) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// --- WebSocket connection handler ---

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const token = url.searchParams.get("token");
  const shareToken = url.searchParams.get("shareToken");
  const inviteToken = url.searchParams.get("inviteToken");

  // Parse boardId from /socket/:boardId
  const boardIdStr = pathname.replace(/^\/socket\//, "").split("/")[0];
  if (boardIdStr === "session") {
    if (!token) {
      ws.close(4001, "Authentication token required");
      return;
    }
    const payload = verifySessionToken(token, config.jwtSecret);
    const sessionId = String(payload?.sid || "").trim();
    if (!payload?.sub || !sessionId) {
      ws.close(4001, "Invalid or expired token");
      return;
    }
    const userId = toNumericId(payload.sub);
    try {
      const activeSessionResult = await query(
        `
          SELECT id
          FROM user_sessions
          WHERE id = $1
            AND user_id = $2
            AND revoked_at IS NULL
            AND expires_at > NOW()
          LIMIT 1
        `,
        [sessionId, userId],
      );
      if (activeSessionResult.rows.length === 0) {
        ws.close(4001, "Invalid or expired token");
        return;
      }
    } catch (err) {
      console.error(`Session connection check failed:`, err.message);
      ws.close(4500, "Internal error");
      return;
    }

    ws.isSessionSocket = true;
    ws.userId = userId;
    ws.sessionId = sessionId;
    registerSessionSocket(sessionId, ws);

    ws.on("close", () => {
      unregisterSessionSocket(sessionId, ws);
    });

    return;
  }

  const boardId = Number(boardIdStr);

  if (!Number.isFinite(boardId) || boardId <= 0) {
    ws.close(4000, "Invalid board ID");
    return;
  }

  let isReadOnly = true;
  let username = `Guest-${Math.floor(Math.random() * 10000)}`;
  let userId = null;
  let sessionIdForSocket = "";

  if (token) {
    const payload = verifySessionToken(token, config.jwtSecret);
    const sessionId = String(payload?.sid || "").trim();
    if (payload?.sub && sessionId) {
      userId = toNumericId(payload.sub);
      sessionIdForSocket = sessionId;
      try {
        const activeSessionResult = await query(
          `
            SELECT id
            FROM user_sessions
            WHERE id = $1
              AND user_id = $2
              AND revoked_at IS NULL
              AND expires_at > NOW()
            LIMIT 1
          `,
          [sessionId, userId],
        );
        if (activeSessionResult.rows.length === 0) {
          ws.close(4001, "Invalid or expired token");
          return;
        }

        const boardResult = await query(
          "SELECT id, share_permission FROM boards WHERE id = $1 AND user_id = $2",
          [boardId, userId],
        );
        if (boardResult.rows.length > 0) {
          isReadOnly = false;
          username = payload.username || "Owner";
        } else {
          const collaboratorResult = await query(
            "SELECT id FROM board_collaborators WHERE board_id = $1 AND user_id = $2",
            [boardId, userId],
          );
          if (collaboratorResult.rows.length > 0) {
            isReadOnly = false;
            username = payload.username || username;
          } else if (inviteToken) {
            const inviteResult = await query(
              "SELECT permission FROM board_invites WHERE board_id = $1 AND token = $2",
              [boardId, inviteToken],
            );
            if (inviteResult.rows.length === 0) {
              ws.close(4003, "Board not found or access denied");
              return;
            }
            isReadOnly = inviteResult.rows[0].permission !== "edit";
            username = payload.username || username;
          } else if (shareToken) {
            const shareResult = await query(
              "SELECT share_permission FROM boards WHERE id = $1 AND share_token = $2",
              [boardId, shareToken],
            );
            if (shareResult.rows.length === 0) {
              ws.close(4003, "Board not found or access denied");
              return;
            }
            isReadOnly = shareResult.rows[0].share_permission !== "edit";
            username = payload.username || username;
          } else {
            ws.close(4003, "Board not found or access denied");
            return;
          }
        }
      } catch (err) {
        console.error(`Board access check failed for board ${boardId}:`, err.message);
        ws.close(4500, "Internal error");
        return;
      }
    } else {
      ws.close(4001, "Invalid or expired token");
      return;
    }
  } else if (inviteToken) {
    try {
      const inviteResult = await query(
        "SELECT permission FROM board_invites WHERE board_id = $1 AND token = $2",
        [boardId, inviteToken],
      );
      if (inviteResult.rows.length === 0) {
        ws.close(4003, "Board not found or access denied");
        return;
      }
      isReadOnly = inviteResult.rows[0].permission !== "edit";
    } catch (err) {
      console.error(`Invite access check failed for board ${boardId}:`, err.message);
      ws.close(4500, "Internal error");
      return;
    }
  } else if (shareToken) {
    // Guest access via share token
    try {
      const shareResult = await query(
        "SELECT share_permission FROM boards WHERE id = $1 AND share_token = $2",
        [boardId, shareToken],
      );
      if (shareResult.rows.length === 0) {
        ws.close(4003, "Board not found or access denied");
        return;
      }
      isReadOnly = shareResult.rows[0].share_permission !== "edit";
    } catch (err) {
      console.error(`Share access check failed for board ${boardId}:`, err.message);
      ws.close(4500, "Internal error");
      return;
    }
  } else {
    ws.close(4001, "Authentication or share token required");
    return;
  }

  ws.isReadOnly = isReadOnly;
  ws.username = username;
  ws.userId = userId;
  ws.sessionId = sessionIdForSocket;
  registerSessionSocket(sessionIdForSocket, ws);

  // Get or create the in-memory session
  const session = getBoardSession(boardId);

  // Cancel grace timer if reconnecting
  if (session.graceTimer) {
    clearTimeout(session.graceTimer);
    session.graceTimer = null;
  }

  // Cold start: load resolved lines and images from database
  if (!session.loaded) {
    const boardState = await loadBoardState(boardId);
    session.history = boardState.lines.map((line) => ({ type: "draw", line }));
    session.images = boardState.images || [];
    session.redoStack = [];
    session.theme = boardState.theme;
    session.loaded = true;
  }

  session.clients.add(ws);
  broadcastPresence(session);

  // Send current resolved state to the newly connected client
  const currentLines = applyHistory(session.history);
  ws.send(
    JSON.stringify({
      type: "state",
      lines: currentLines,
      images: session.images || [],
      theme: session.theme,
    }),
  );

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (
      ws.isReadOnly &&
      [
        "draw",
        "erase",
        "undo",
        "redo",
        "clear",
        "theme",
        "add-image",
        "update-image",
        "delete-image",
      ].includes(data.type)
    ) {
      // Ignore mutation events from read-only clients
      return;
    }

    if (data.type === "draw" || data.type === "erase") {
      session.history.push(data);
      session.redoStack = [];
      broadcastAction(session, data, ws);
    } else if (data.type === "add-image") {
      if (!session.images) session.images = [];
      session.images.push(data.image);
      broadcastAction(session, data, ws);
    } else if (data.type === "update-image") {
      if (!session.images) session.images = [];
      session.images = session.images.map((img) => {
        if (img.id === data.image.id) {
          return { ...img, ...data.image };
        }
        return img;
      });
      broadcastAction(session, data, ws);
    } else if (data.type === "delete-image") {
      if (!session.images) session.images = [];
      session.images = session.images.filter((img) => img.id !== data.id);
      broadcastAction(session, data, ws);
    } else if (data.type === "theme") {
      session.theme = normalizeBoardTheme(data.theme);
      broadcastAction(session, { type: "theme", theme: session.theme }, ws);
    } else if (data.type === "cursor") {
      broadcastAction(session, { type: "cursor", x: data.x, y: data.y, user: ws.username }, ws);
    } else if (data.type === "undo") {
      const undone = popLastActionGroup(session.history);
      if (undone.length > 0) {
        session.redoStack.push(undone);
      }
      broadcastState(session);
    } else if (data.type === "redo") {
      if (session.redoStack.length > 0) {
        const actionGroup = session.redoStack.pop();
        if (Array.isArray(actionGroup)) {
          session.history.push(...actionGroup);
        } else {
          session.history.push(actionGroup);
        }
      }
      broadcastState(session);
    } else if (data.type === "clear") {
      session.history = [];
      session.redoStack = [];
      broadcastState(session);
    }

    scheduleFlush(boardId, session);
  });

  ws.on("close", () => {
    unregisterSessionSocket(sessionIdForSocket, ws);
    session.clients.delete(ws);
    broadcastPresence(session);

    if (session.clients.size === 0) {
      // Force an immediate flush before starting the grace timer
      if (session.flushTimer) clearTimeout(session.flushTimer);

      flushBoardContent(boardId, session).catch((err) => {
        console.error(`Failed to flush board ${boardId} on last disconnect:`, err.message);
      });

      // Start grace timer — keep session in memory for refreshes
      session.graceTimer = setTimeout(() => {
        boardSessions.delete(boardId);
      }, SESSION_GRACE_MS);
    }
  });
});



app.use(errorHandler);

const port = config.port;

async function startServer() {
  let dbInitialized = false;
  try {
    await initializeDatabase();
    dbInitialized = true;
    console.log("Database initialized");
  } catch (err) {
    console.warn(
      "Database initialization failed; starting in degraded mode:",
      err && err.message ? err.message : err,
    );
  }

  server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
    if (!dbInitialized) {
      console.log(
        "Warning: running without database connectivity. Some features will be degraded.",
      );
    }
  });
}

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down server...`);

  // Flush all active board sessions before exiting
  const flushPromises = [];
  for (const [boardId, session] of boardSessions.entries()) {
    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.graceTimer) clearTimeout(session.graceTimer);
    flushPromises.push(
      flushBoardContent(boardId, session).catch((err) => {
        console.warn(`Failed to flush board ${boardId} on shutdown:`, err.message);
      }),
    );
  }
  await Promise.allSettled(flushPromises);

  try {
    await closeDatabase();
  } catch (err) {
    console.warn("Error closing database connection:", err && err.message ? err.message : err);
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
