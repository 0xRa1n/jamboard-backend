const crypto = require("crypto");
const { ServiceError } = require("./serviceError");

const BOARD_NAME_STRIP_RE = /[^a-zA-Z0-9 _()-]/g;
const MAX_BOARD_NAME_LENGTH = 80;
const VALID_SHARE_PERMISSIONS = new Set(["view", "edit"]);

function normalizeBoardTitle(title, fallbackTitle = "Untitled board") {
  const normalizedTitle = String(title || "")
    .replace(BOARD_NAME_STRIP_RE, "")
    .trim()
    .slice(0, MAX_BOARD_NAME_LENGTH);
  return normalizedTitle || fallbackTitle;
}

function normalizeSharePermission(permission) {
  if (typeof permission !== "string") {
    return "view";
  }
  const normalized = permission.trim().toLowerCase();
  return VALID_SHARE_PERMISSIONS.has(normalized) ? normalized : "view";
}

function createBoardsService({ query, cryptoImpl = crypto }) {
  async function getSharedBoard(shareToken) {
    const result = await query(
      `
        SELECT id, title, thumbnail, theme, share_permission, created_at, updated_at
        FROM boards
        WHERE share_token = $1
      `,
      [shareToken],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Shared board not found.");
    }

    return result.rows[0];
  }

  async function getBoardById(boardId) {
    const result = await query(
      `
        SELECT id, title, thumbnail, theme, share_permission, share_token, created_at, updated_at
        FROM boards
        WHERE id = $1
      `,
      [boardId],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }

    return result.rows[0];
  }

  async function isBoardOwner(userId, boardId) {
    const result = await query("SELECT id FROM boards WHERE id = $1 AND user_id = $2", [
      boardId,
      userId,
    ]);
    return result.rows.length > 0;
  }

  async function isBoardCollaborator(userId, boardId) {
    const result = await query(
      "SELECT id FROM board_collaborators WHERE board_id = $1 AND user_id = $2",
      [boardId, userId],
    );
    return result.rows.length > 0;
  }

  async function listBoards(userId, workspaceId) {
    const boardResult = await query(
      `
        SELECT id, title, thumbnail, theme, created_at, updated_at
        FROM boards
        WHERE user_id = $1 AND workspace_id = $2
        ORDER BY updated_at DESC, id DESC
      `,
      [userId, workspaceId],
    );

    return boardResult.rows;
  }

  async function createBoard(userId, workspaceId, title) {
    const normalizedTitle = normalizeBoardTitle(title);
    const result = await query(
      `
        INSERT INTO boards (user_id, workspace_id, title)
        VALUES ($1, $2, $3)
        RETURNING id, title, theme, created_at, updated_at
      `,
      [userId, workspaceId, normalizedTitle],
    );

    return result.rows[0];
  }

  async function renameBoard(userId, boardId, title) {
    const normalizedTitle = normalizeBoardTitle(title, "Untitled board");
    const result = await query(
      `
        UPDATE boards
        SET title = $1,
            updated_at = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING id, title, thumbnail, theme, created_at, updated_at
      `,
      [normalizedTitle, boardId, userId],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }

    return result.rows[0];
  }

  async function updateThumbnail(userId, boardId, thumbnail) {
    const result = await query(
      `
        UPDATE boards
        SET thumbnail = $1,
            updated_at = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING id
      `,
      [thumbnail, boardId, userId],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }
  }

  async function duplicateBoard(userId, boardId) {
    const original = await query(
      `
        SELECT title, thumbnail, theme
        FROM boards
        WHERE id = $1 AND user_id = $2
      `,
      [boardId, userId],
    );

    if (original.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }

    const duplicatedTitle = normalizeBoardTitle(`${original.rows[0].title} (copy)`);

    const result = await query(
      `
        INSERT INTO boards (user_id, workspace_id, title, thumbnail, theme)
        SELECT $1, workspace_id, $2, $3, theme
        FROM boards
        WHERE id = $4 AND user_id = $1
        RETURNING id, title, thumbnail, theme, created_at, updated_at
      `,
      [userId, duplicatedTitle, original.rows[0].thumbnail || null, boardId],
    );

    return result.rows[0];
  }

  async function deleteBoard(userId, boardId) {
    const result = await query(
      `
        DELETE FROM boards
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `,
      [boardId, userId],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }
  }

  async function createShareToken(userId, boardId, permission) {
    const result = await query(
      "SELECT share_token, share_permission FROM boards WHERE id = $1 AND user_id = $2",
      [boardId, userId],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }

    let shareToken = result.rows[0].share_token;
    const nextPermission = normalizeSharePermission(
      permission ?? result.rows[0].share_permission ?? "view",
    );
    if (!shareToken) {
      shareToken = cryptoImpl.randomBytes(16).toString("hex");
      await query("UPDATE boards SET share_token = $1, share_permission = $2 WHERE id = $3", [
        shareToken,
        nextPermission,
        boardId,
      ]);
    } else {
      await query("UPDATE boards SET share_permission = $1 WHERE id = $2", [
        nextPermission,
        boardId,
      ]);
    }

    return { shareToken, sharePermission: nextPermission };
  }

  async function ensureShareToken(boardId) {
    const result = await query("SELECT share_token, share_permission FROM boards WHERE id = $1", [
      boardId,
    ]);

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }

    let shareToken = result.rows[0].share_token;
    if (!shareToken) {
      shareToken = cryptoImpl.randomBytes(16).toString("hex");
      await query("UPDATE boards SET share_token = $1 WHERE id = $2", [shareToken, boardId]);
    }

    return {
      shareToken,
      sharePermission: normalizeSharePermission(result.rows[0].share_permission),
    };
  }

  async function revokeShareToken(userId, boardId) {
    const result = await query(
      "UPDATE boards SET share_token = NULL WHERE id = $1 AND user_id = $2 RETURNING id",
      [boardId, userId],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }
  }

  return {
    getSharedBoard,
    getBoardById,
    listBoards,
    createBoard,
    renameBoard,
    updateThumbnail,
    duplicateBoard,
    deleteBoard,
    createShareToken,
    ensureShareToken,
    revokeShareToken,
    isBoardOwner,
    isBoardCollaborator,
  };
}

module.exports = {
  createBoardsService,
  normalizeBoardTitle,
  normalizeSharePermission,
};
