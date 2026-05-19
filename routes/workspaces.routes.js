const express = require("express");
const { createWorkspacesController } = require("../controllers/workspacesController");
const { requireAuth } = require("../middleware/auth");

function createWorkspacesRouter({ query, jwtSecret }) {
  const router = express.Router();
  const controller = createWorkspacesController({ query });

  router.use(requireAuth(jwtSecret, query));

  router.get("/", controller.listWorkspaces);
  router.post("/", controller.createWorkspace);
  router.patch("/:workspaceId", controller.renameWorkspace);
  router.delete("/:workspaceId", controller.deleteWorkspace);

  return router;
}

module.exports = createWorkspacesRouter;
