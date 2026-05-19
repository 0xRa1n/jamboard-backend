const express = require("express");
const { createNotificationsController } = require("../controllers/notificationsController");
const { requireAuth } = require("../middleware/auth");

function createNotificationsRouter({ query, jwtSecret, onPermissionGranted }) {
  const router = express.Router();
  const controller = createNotificationsController({ query, onPermissionGranted });

  router.get("/requests/:token/approve", controller.approveRequestByToken);
  router.get("/requests/:token/deny", controller.denyRequestByToken);

  router.use(requireAuth(jwtSecret, query));

  router.get("/", controller.listNotifications);
  router.post("/:requestId/approve", controller.approveRequest);
  router.post("/:requestId/deny", controller.denyRequest);

  return router;
}

module.exports = createNotificationsRouter;
