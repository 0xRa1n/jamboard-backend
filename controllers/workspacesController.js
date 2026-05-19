const { createWorkspacesService } = require("../services/workspacesService");
const { ServiceError } = require("../services/serviceError");
const { toNumericId } = require("../services/sessionService");
const { workspaceCreateSchema, workspaceRenameSchema } = require("../shared/schemas");

function createWorkspacesController({ query }) {
  const workspacesService = createWorkspacesService({ query });

  async function listWorkspaces(req, res) {
    try {
      const workspaces = await workspacesService.listWorkspaces(req.user.id);
      return res.json({
        workspaces: workspaces.map((ws) => ({
          id: toNumericId(ws.id),
          name: ws.name,
          createdAt: ws.created_at,
          updatedAt: ws.updated_at,
        })),
      });
    } catch (error) {
      console.error("Failed to load workspaces:", error);
      return res.status(500).json({ message: "Failed to load workspaces." });
    }
  }

  async function createWorkspace(req, res) {
    const payload = typeof req.body === "object" && req.body !== null ? req.body : {};
    const parsed = workspaceCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid workspace payload." });
    }

    try {
      const ws = await workspacesService.createWorkspace(req.user.id, parsed.data.name);
      return res.status(201).json({
        workspace: {
          id: toNumericId(ws.id),
          name: ws.name,
          createdAt: ws.created_at,
          updatedAt: ws.updated_at,
        },
      });
    } catch (error) {
      console.error("Failed to create workspace:", error);
      return res.status(500).json({ message: "Failed to create workspace." });
    }
  }

  async function renameWorkspace(req, res) {
    const workspaceId = Number(req.params.workspaceId);
    if (!Number.isFinite(workspaceId)) {
      return res.status(400).json({ message: "Invalid workspace id." });
    }

    const payload = typeof req.body === "object" && req.body !== null ? req.body : {};
    const parsed = workspaceRenameSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid workspace name." });
    }

    try {
      const ws = await workspacesService.renameWorkspace(
        req.user.id,
        workspaceId,
        parsed.data.name,
      );
      return res.json({
        workspace: {
          id: toNumericId(ws.id),
          name: ws.name,
          createdAt: ws.created_at,
          updatedAt: ws.updated_at,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to update workspace:", error);
      return res.status(500).json({ message: "Failed to update workspace." });
    }
  }

  async function deleteWorkspace(req, res) {
    const workspaceId = Number(req.params.workspaceId);
    if (!Number.isFinite(workspaceId)) {
      return res.status(400).json({ message: "Invalid workspace id." });
    }

    try {
      await workspacesService.deleteWorkspace(req.user.id, workspaceId);
      return res.status(204).send();
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Failed to delete workspace:", error);
      return res.status(500).json({ message: "Failed to delete workspace." });
    }
  }

  return {
    listWorkspaces,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  };
}

module.exports = {
  createWorkspacesController,
};
