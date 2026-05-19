const { createBoardsService, normalizeSharePermission } = require("../services/boardsService");
const { createCollaborationService } = require("../services/collaborationService");
const { createEmailService } = require("../services/emailService");
const { ServiceError } = require("../services/serviceError");
const { getAuthenticatedUser, toNumericId } = require("../services/sessionService");
const {
  boardCreateSchema,
  boardRenameSchema,
  boardThumbnailSchema,
  boardShareTokenSchema,
  boardSharePermissionSchema,
  boardInviteSchema,
  boardAccessRequestSchema,
} = require("../../shared/schemas");

function createBoardsController({ query, onShareRevoked, jwtSecret, emailConfig }) {
  const boardsService = createBoardsService({ query });
  const collaborationService = createCollaborationService({ query });
  const emailService = createEmailService(emailConfig || {});

  async function getSharedBoard(req, res) {
    const parsed = boardShareTokenSchema.safeParse({ shareToken: req.params.shareToken });
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid share token." });
    }

    try {
      const board = await boardsService.getSharedBoard(parsed.data.shareToken);
      const user = getAuthenticatedUser(req, jwtSecret);
      const sharePermission = normalizeSharePermission(board.share_permission);

      let isReadOnly = true;
      if (user) {
        const isOwner = await boardsService.isBoardOwner(user.id, board.id);
        const isCollaborator = !isOwner
          ? await boardsService.isBoardCollaborator(user.id, board.id)
          : false;
        if (isOwner || isCollaborator) {
          isReadOnly = false;
        } else if (sharePermission === "edit") {
          isReadOnly = false;
        }
      } else if (sharePermission === "edit") {
        isReadOnly = false;
      }

      return res.json({
        board: {
          id: toNumericId(board.id),
          title: board.title,
          thumbnail: board.thumbnail || null,
          theme: board.theme || "light",
          createdAt: board.created_at,
          updatedAt: board.updated_at,
          shareToken: parsed.data.shareToken,
          sharePermission,
          isReadOnly,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to load shared board:", error);
      return res.status(500).json({ message: "Failed to load shared board." });
    }
  }

  async function listBoards(req, res) {
    const workspaceId = Number(req.query.workspaceId);
    if (!Number.isFinite(workspaceId)) {
      return res.status(400).json({ message: "Workspace ID is required." });
    }

    try {
      const boards = await boardsService.listBoards(req.user.id, workspaceId);
      return res.json({
        boards: boards.map((board) => ({
          id: toNumericId(board.id),
          title: board.title,
          thumbnail: board.thumbnail || null,
          theme: board.theme || "light",
          createdAt: board.created_at,
          updatedAt: board.updated_at,
        })),
      });
    } catch (error) {
      console.error("Failed to load boards:", error);
      return res.status(500).json({ message: "Failed to load boards." });
    }
  }

  async function createBoard(req, res) {
    const payload = typeof req.body === "object" && req.body !== null ? req.body : {};
    const parsed = boardCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ message: "Workspace ID is required." });
    }

    try {
      const board = await boardsService.createBoard(
        req.user.id,
        Number(parsed.data.workspaceId),
        parsed.data.title,
      );
      return res.status(201).json({
        board: {
          id: toNumericId(board.id),
          title: board.title,
          theme: board.theme || "light",
          createdAt: board.created_at,
          updatedAt: board.updated_at,
        },
      });
    } catch (error) {
      console.error("Failed to create board:", error);
      return res.status(500).json({ message: "Failed to create board: " + error.message });
    }
  }

  async function renameBoard(req, res) {
    const boardId = Number(req.params.boardId);
    if (!Number.isFinite(boardId)) {
      return res.status(400).json({ message: "Invalid board id." });
    }

    const payload = typeof req.body === "object" && req.body !== null ? req.body : {};
    const parsed = boardRenameSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid board title." });
    }

    try {
      const board = await boardsService.renameBoard(req.user.id, boardId, parsed.data.title);
      return res.json({
        board: {
          id: toNumericId(board.id),
          title: board.title,
          thumbnail: board.thumbnail || null,
          theme: board.theme || "light",
          createdAt: board.created_at,
          updatedAt: board.updated_at,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to rename board:", error);
      return res.status(500).json({ message: "Failed to rename board." });
    }
  }

  async function updateThumbnail(req, res) {
    const boardId = Number(req.params.boardId);
    if (!Number.isFinite(boardId)) {
      return res.status(400).json({ message: "Invalid board id." });
    }

    const payload = typeof req.body === "object" && req.body !== null ? req.body : {};
    const parsed = boardThumbnailSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ message: "Thumbnail must be a string." });
    }

    try {
      await boardsService.updateThumbnail(req.user.id, boardId, parsed.data.thumbnail);
      return res.json({ message: "Thumbnail updated." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to update thumbnail:", error);
      return res.status(500).json({ message: "Failed to update thumbnail." });
    }
  }

  async function duplicateBoard(req, res) {
    const boardId = Number(req.params.boardId);
    if (!Number.isFinite(boardId)) {
      return res.status(400).json({ message: "Invalid board id." });
    }

    try {
      const board = await boardsService.duplicateBoard(req.user.id, boardId);
      return res.status(201).json({
        board: {
          id: toNumericId(board.id),
          title: board.title,
          thumbnail: board.thumbnail || null,
          theme: board.theme || "light",
          createdAt: board.created_at,
          updatedAt: board.updated_at,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to duplicate board:", error);
      return res.status(500).json({ message: "Failed to duplicate board." });
    }
  }

  async function deleteBoard(req, res) {
    const boardId = Number(req.params.boardId);
    if (!Number.isFinite(boardId)) {
      return res.status(400).json({ message: "Invalid board id." });
    }

    try {
      await boardsService.deleteBoard(req.user.id, boardId);
      return res.status(204).send();
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to delete board:", error);
      return res.status(500).json({ message: "Failed to delete board." });
    }
  }

  async function createShareLink(req, res) {
    const boardId = Number(req.params.boardId);
    if (!Number.isFinite(boardId)) {
      return res.status(400).json({ message: "Invalid board id." });
    }

    const parsed = boardSharePermissionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid share permission." });
    }

    try {
      const result = await boardsService.createShareToken(
        req.user.id,
        boardId,
        parsed.data.permission,
      );
      return res.json({ shareToken: result.shareToken, permission: result.sharePermission });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to generate share token:", error);
      return res.status(500).json({ message: "Failed to generate share token." });
    }
  }

  async function getInviteBoard(req, res) {
    const inviteToken = String(req.params.inviteToken || "").trim();
    if (!inviteToken) {
      return res.status(400).json({ message: "Invalid invite token." });
    }

    try {
      const invite = await collaborationService.acceptInvite(inviteToken);
      const share = await boardsService.ensureShareToken(invite.boardId);
      const board = await boardsService.getBoardById(invite.boardId);

      const isReadOnly = invite.permission !== "edit";

      return res.json({
        board: {
          id: toNumericId(board.id),
          title: board.title,
          thumbnail: board.thumbnail || null,
          theme: board.theme || "light",
          createdAt: board.created_at,
          updatedAt: board.updated_at,
          shareToken: share.shareToken,
          sharePermission: invite.permission,
          inviteToken,
          isReadOnly,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to load invite:", error);
      return res.status(500).json({ message: "Failed to load invite." });
    }
  }

  async function createInvite(req, res) {
    const boardId = Number(req.params.boardId);
    if (!Number.isFinite(boardId)) {
      return res.status(400).json({ message: "Invalid board id." });
    }

    const parsed = boardInviteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid invite payload." });
    }

    try {
      const invite = await collaborationService.createInvite({
        boardId,
        ownerId: req.user.id,
        email: parsed.data.email,
        permission: parsed.data.permission,
      });

      const share = await boardsService.ensureShareToken(boardId);
      const workspaceResult = await query(
        `
          SELECT w.name
          FROM boards b
          JOIN workspaces w ON w.id = b.workspace_id
          WHERE b.id = $1
        `,
        [boardId],
      );
      const workspaceName = workspaceResult.rows[0]?.name || "Personal Workspace";
      const inviterName = req.user.username || "Jamboard User";

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const inviteLink = `${baseUrl}/?shareToken=${share.shareToken}&inviteToken=${invite.token}`;

      await emailService.sendInviteEmail({
        to: parsed.data.email,
        inviterName,
        boardTitle: invite.boardTitle,
        accessLevel: invite.permission === "edit" ? "Can edit" : "Can view",
        workspaceName,
        inviteLink,
      });

      return res.status(201).json({ message: "Invite sent." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to send invite:", error);
      return res.status(500).json({ message: "Failed to send invite." });
    }
  }

  async function createAccessRequest(req, res) {
    const boardId = Number(req.params.boardId);
    if (!Number.isFinite(boardId)) {
      return res.status(400).json({ message: "Invalid board id." });
    }

    const parsed = boardAccessRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid access request." });
    }

    try {
      const result = await collaborationService.createAccessRequest({
        boardId,
        requesterId: req.user.id,
        shareToken: parsed.data.shareToken,
      });

      const ownerResult = await query("SELECT email FROM users WHERE id = $1", [result.ownerId]);
      const ownerEmail = ownerResult.rows[0]?.email;
      if (!ownerEmail || !result.requestToken) {
        return res.status(200).json({ message: "Request sent." });
      }

      const requesterResult = await query("SELECT username FROM users WHERE id = $1", [
        req.user.id,
      ]);
      const requesterName = requesterResult.rows[0]?.username || "A user";

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const approveLink = `${baseUrl}/api/notifications/requests/${result.requestToken}/approve`;
      const denyLink = `${baseUrl}/api/notifications/requests/${result.requestToken}/deny`;

      await emailService.sendAccessRequestEmail({
        to: ownerEmail,
        requesterName,
        boardTitle: result.boardTitle,
        approveLink,
        denyLink,
      });

      return res.status(201).json({ message: "Request sent." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to create access request:", error);
      return res.status(500).json({ message: "Failed to create access request." });
    }
  }

  async function revokeShareLink(req, res) {
    const boardId = Number(req.params.boardId);
    if (!Number.isFinite(boardId)) {
      return res.status(400).json({ message: "Invalid board id." });
    }

    try {
      await boardsService.revokeShareToken(req.user.id, boardId);
      if (onShareRevoked) {
        onShareRevoked(boardId);
      }
      return res.json({ message: "Share link revoked." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to revoke share link:", error);
      return res.status(500).json({ message: "Failed to revoke share link." });
    }
  }

  return {
    getSharedBoard,
    listBoards,
    createBoard,
    renameBoard,
    updateThumbnail,
    duplicateBoard,
    deleteBoard,
    createShareLink,
    revokeShareLink,
    getInviteBoard,
    createInvite,
    createAccessRequest,
  };
}

module.exports = {
  createBoardsController,
};
