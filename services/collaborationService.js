const crypto = require("crypto");
const { ServiceError } = require("./serviceError");
const { normalizeSharePermission } = require("./boardsService");

function createCollaborationService({ query, cryptoImpl = crypto }) {
  async function createAccessRequest({ boardId, requesterId, shareToken }) {
    const boardResult = await query(
      "SELECT id, user_id, title FROM boards WHERE id = $1 AND share_token = $2",
      [boardId, shareToken],
    );

    if (boardResult.rows.length === 0) {
      throw new ServiceError(404, "Share link not found.");
    }

    const board = boardResult.rows[0];
    if (Number(board.user_id) === Number(requesterId)) {
      throw new ServiceError(400, "You already own this board.");
    }

    const collaboratorCheck = await query(
      "SELECT id FROM board_collaborators WHERE board_id = $1 AND user_id = $2",
      [boardId, requesterId],
    );

    if (collaboratorCheck.rows.length > 0) {
      throw new ServiceError(400, "You already have edit access.");
    }

    const existing = await query(
      `
        SELECT id, status, token
        FROM board_access_requests
        WHERE board_id = $1 AND requester_user_id = $2 AND status = 'pending'
        LIMIT 1
      `,
      [boardId, requesterId],
    );

    if (existing.rows.length > 0) {
      return {
        requestId: existing.rows[0].id,
        ownerId: board.user_id,
        boardTitle: board.title,
        requestToken: existing.rows[0].token,
      };
    }

    const token = cryptoImpl.randomBytes(16).toString("hex");
    const created = await query(
      `
        INSERT INTO board_access_requests (board_id, requester_user_id, token)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [boardId, requesterId, token],
    );

    return {
      requestId: created.rows[0].id,
      ownerId: board.user_id,
      boardTitle: board.title,
      requestToken: token,
    };
  }

  async function listPendingRequests(ownerId) {
    const result = await query(
      `
        SELECT
          r.id,
          r.board_id,
          r.created_at,
          u.username,
          u.email,
          b.title
        FROM board_access_requests r
        JOIN boards b ON b.id = r.board_id
        JOIN users u ON u.id = r.requester_user_id
        WHERE b.user_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at DESC
      `,
      [ownerId],
    );

    return result.rows;
  }

  async function approveAccessRequest(ownerId, requestId) {
    const lookup = await query(
      `
        SELECT r.id, r.board_id, r.requester_user_id, r.status
        FROM board_access_requests r
        JOIN boards b ON b.id = r.board_id
        WHERE r.id = $1 AND b.user_id = $2
      `,
      [requestId, ownerId],
    );

    if (lookup.rows.length === 0) {
      throw new ServiceError(404, "Access request not found.");
    }

    const request = lookup.rows[0];
    if (request.status !== "pending") {
      throw new ServiceError(400, "Access request already processed.");
    }

    await query(
      "UPDATE board_access_requests SET status = 'approved', decided_at = NOW() WHERE id = $1",
      [requestId],
    );

    await query(
      `
        INSERT INTO board_collaborators (board_id, user_id, role)
        VALUES ($1, $2, 'editor')
        ON CONFLICT (board_id, user_id) DO NOTHING
      `,
      [request.board_id, request.requester_user_id],
    );

    return {
      boardId: request.board_id,
      requesterUserId: request.requester_user_id,
    };
  }

  async function denyAccessRequest(ownerId, requestId) {
    const lookup = await query(
      `
        SELECT r.id, r.status
        FROM board_access_requests r
        JOIN boards b ON b.id = r.board_id
        WHERE r.id = $1 AND b.user_id = $2
      `,
      [requestId, ownerId],
    );

    if (lookup.rows.length === 0) {
      throw new ServiceError(404, "Access request not found.");
    }

    const request = lookup.rows[0];
    if (request.status !== "pending") {
      throw new ServiceError(400, "Access request already processed.");
    }

    await query(
      "UPDATE board_access_requests SET status = 'denied', decided_at = NOW() WHERE id = $1",
      [requestId],
    );
  }

  async function decideAccessRequestByToken(token, decision) {
    const lookup = await query(
      `
        SELECT r.id, r.board_id, r.requester_user_id, r.status
        FROM board_access_requests r
        WHERE r.token = $1
      `,
      [token],
    );

    if (lookup.rows.length === 0) {
      throw new ServiceError(404, "Access request not found.");
    }

    const request = lookup.rows[0];
    if (request.status !== "pending") {
      throw new ServiceError(400, "Access request already processed.");
    }

    if (decision === "approve") {
      await query(
        "UPDATE board_access_requests SET status = 'approved', decided_at = NOW() WHERE id = $1",
        [request.id],
      );
      await query(
        `
          INSERT INTO board_collaborators (board_id, user_id, role)
          VALUES ($1, $2, 'editor')
          ON CONFLICT (board_id, user_id) DO NOTHING
        `,
        [request.board_id, request.requester_user_id],
      );
      return {
        boardId: request.board_id,
        requesterUserId: request.requester_user_id,
      };
    }

    await query(
      "UPDATE board_access_requests SET status = 'denied', decided_at = NOW() WHERE id = $1",
      [request.id],
    );

    return {
      boardId: request.board_id,
      requesterUserId: request.requester_user_id,
    };
  }

  async function createInvite({ boardId, ownerId, email, permission }) {
    const ownerCheck = await query("SELECT id, title FROM boards WHERE id = $1 AND user_id = $2", [
      boardId,
      ownerId,
    ]);

    if (ownerCheck.rows.length === 0) {
      throw new ServiceError(404, "Board not found.");
    }

    const inviteToken = cryptoImpl.randomBytes(16).toString("hex");
    const normalizedPermission = normalizeSharePermission(permission);

    const result = await query(
      `
        INSERT INTO board_invites (board_id, email, permission, token)
        VALUES ($1, $2, $3, $4)
        RETURNING id, token, permission
      `,
      [boardId, email, normalizedPermission, inviteToken],
    );

    return {
      inviteId: result.rows[0].id,
      token: result.rows[0].token,
      permission: result.rows[0].permission,
      boardTitle: ownerCheck.rows[0].title,
    };
  }

  async function acceptInvite(token) {
    const lookup = await query(
      `
        SELECT id, board_id, permission, accepted_at
        FROM board_invites
        WHERE token = $1
      `,
      [token],
    );

    if (lookup.rows.length === 0) {
      throw new ServiceError(404, "Invite not found.");
    }

    const invite = lookup.rows[0];
    if (!invite.accepted_at) {
      await query("UPDATE board_invites SET accepted_at = NOW() WHERE id = $1", [invite.id]);
    }

    return {
      boardId: invite.board_id,
      permission: normalizeSharePermission(invite.permission),
    };
  }

  async function getInviteByToken(token) {
    const lookup = await query(
      "SELECT id, board_id, permission FROM board_invites WHERE token = $1",
      [token],
    );

    if (lookup.rows.length === 0) {
      throw new ServiceError(404, "Invite not found.");
    }

    return {
      boardId: lookup.rows[0].board_id,
      permission: normalizeSharePermission(lookup.rows[0].permission),
    };
  }

  return {
    createAccessRequest,
    listPendingRequests,
    approveAccessRequest,
    denyAccessRequest,
    decideAccessRequestByToken,
    createInvite,
    acceptInvite,
    getInviteByToken,
  };
}

module.exports = {
  createCollaborationService,
};
