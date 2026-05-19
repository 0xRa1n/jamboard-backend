const { createCollaborationService } = require("../services/collaborationService");
const { ServiceError } = require("../services/serviceError");
const { toNumericId } = require("../services/sessionService");

function createNotificationsController({ query, onPermissionGranted }) {
  const collaborationService = createCollaborationService({ query });

  async function listNotifications(req, res) {
    try {
      const requests = await collaborationService.listPendingRequests(req.user.id);
      return res.json({
        requests: requests.map((request) => ({
          id: toNumericId(request.id),
          boardId: toNumericId(request.board_id),
          boardTitle: request.title,
          requesterName: request.username,
          requesterEmail: request.email,
          createdAt: request.created_at,
        })),
      });
    } catch (error) {
      console.error("Failed to load notifications:", error);
      return res.status(500).json({ message: "Failed to load notifications." });
    }
  }

  async function approveRequest(req, res) {
    const requestId = Number(req.params.requestId);
    if (!Number.isFinite(requestId)) {
      return res.status(400).json({ message: "Invalid request id." });
    }

    try {
      const result = await collaborationService.approveAccessRequest(req.user.id, requestId);
      if (onPermissionGranted) {
        onPermissionGranted(result.boardId, result.requesterUserId);
      }
      return res.json({ message: "Access granted." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to approve access request:", error);
      return res.status(500).json({ message: "Failed to approve request." });
    }
  }

  async function denyRequest(req, res) {
    const requestId = Number(req.params.requestId);
    if (!Number.isFinite(requestId)) {
      return res.status(400).json({ message: "Invalid request id." });
    }

    try {
      await collaborationService.denyAccessRequest(req.user.id, requestId);
      return res.json({ message: "Access denied." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to deny access request:", error);
      return res.status(500).json({ message: "Failed to deny request." });
    }
  }

  async function approveRequestByToken(req, res) {
    const token = String(req.params.token || "").trim();
    if (!token) {
      return res.status(400).send("Invalid token");
    }

    try {
      const result = await collaborationService.decideAccessRequestByToken(token, "approve");
      if (onPermissionGranted) {
        onPermissionGranted(result.boardId, result.requesterUserId);
      }
      return res.send(renderDecisionPage("Access approved", "This request has been approved."));
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).send(renderDecisionPage("Request error", error.message));
      }
      console.error("Failed to approve request by token:", error);
      return res.status(500).send(renderDecisionPage("Request error", "Unable to approve."));
    }
  }

  async function denyRequestByToken(req, res) {
    const token = String(req.params.token || "").trim();
    if (!token) {
      return res.status(400).send("Invalid token");
    }

    try {
      await collaborationService.decideAccessRequestByToken(token, "deny");
      return res.send(renderDecisionPage("Access denied", "This request has been denied."));
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).send(renderDecisionPage("Request error", error.message));
      }
      console.error("Failed to deny request by token:", error);
      return res.status(500).send(renderDecisionPage("Request error", "Unable to deny."));
    }
  }

  function renderDecisionPage(title, message) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin:0; padding:32px; background:#f1f5f9; color:#0f172a; font-family:Space Grotesk, Segoe UI, sans-serif;">
    <div style="max-width:520px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:28px;">
      <h1 style="margin:0 0 12px 0; font-size:20px;">${title}</h1>
      <p style="margin:0; font-size:14px; color:#475569; line-height:22px;">${message}</p>
    </div>
  </body>
</html>`;
  }

  return {
    listNotifications,
    approveRequest,
    denyRequest,
    approveRequestByToken,
    denyRequestByToken,
  };
}

module.exports = {
  createNotificationsController,
};
