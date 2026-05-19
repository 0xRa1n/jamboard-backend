const { ServiceError } = require("./serviceError");

function normalizeWorkspaceName(name, fallbackName = "Untitled Workspace") {
  const normalizedName = String(name || "")
    .trim()
    .slice(0, 128);
  return normalizedName || fallbackName;
}

function createWorkspacesService({ query }) {
  async function listWorkspaces(userId) {
    const result = await query(
      `
        SELECT id, name, created_at, updated_at
        FROM workspaces
        WHERE user_id = $1
        ORDER BY id ASC
      `,
      [userId],
    );

    return result.rows;
  }

  async function createWorkspace(userId, name) {
    const normalizedName = normalizeWorkspaceName(name, "New Workspace");
    const result = await query(
      `
        INSERT INTO workspaces (user_id, name)
        VALUES ($1, $2)
        RETURNING id, name, created_at, updated_at
      `,
      [userId, normalizedName],
    );

    return result.rows[0];
  }

  async function renameWorkspace(userId, workspaceId, name) {
    const normalizedName = normalizeWorkspaceName(name, "Untitled Workspace");
    const result = await query(
      `
        UPDATE workspaces
        SET name = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING id, name, created_at, updated_at
      `,
      [normalizedName, workspaceId, userId],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Workspace not found.");
    }

    return result.rows[0];
  }

  async function deleteWorkspace(userId, workspaceId) {
    const result = await query(
      `
        DELETE FROM workspaces
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `,
      [workspaceId, userId],
    );

    if (result.rows.length === 0) {
      throw new ServiceError(404, "Workspace not found.");
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
  createWorkspacesService,
  normalizeWorkspaceName,
};
