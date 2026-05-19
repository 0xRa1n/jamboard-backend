const express = require("express");
const multer = require("multer");
const { createAuthController } = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024,
  },
});

function createAuthRouter({
  query,
  jwtSecret,
  avatarUploadDir,
  onSessionRevoked,
  onOtherSessionsRevoked,
  emailConfig,
}) {
  const router = express.Router();
  const controller = createAuthController({
    query,
    jwtSecret,
    avatarUploadDir,
    onSessionRevoked,
    onOtherSessionsRevoked,
    emailConfig,
  });

  router.use("/me", requireAuth(jwtSecret, query));
  router.use("/avatar", requireAuth(jwtSecret, query));

  router.get("/me", controller.getMe);
  router.patch("/me", controller.updateMe);
  router.patch("/me/theme", controller.updateThemePreference);
  router.patch("/me/notifications", controller.updateNotificationPreferences);
  router.patch("/me/password", controller.updatePassword);
  router.get("/me/sessions", controller.listSessions);
  router.delete("/me/sessions/:sessionId", controller.revokeSession);
  router.post("/me/sessions/revoke-others", controller.revokeOtherSessions);
  router.post(
    "/avatar",
    (req, res, next) => {
      upload.single("avatar")(req, res, (error) => {
        if (!error) {
          next();
          return;
        }

        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ message: "Avatar must be 1MB or smaller." });
          return;
        }

        res.status(400).json({ message: "Unable to process avatar upload." });
      });
    },
    controller.uploadAvatar,
  );
  router.post("/register", controller.register);
  router.post("/login", controller.login);
  router.post("/password-reset/initiate", controller.initiatePasswordReset);
  router.post("/password-reset/verify-code", controller.verifyPasswordResetCode);
  router.post("/password-reset/reset", controller.resetPassword);

  return router;
}

module.exports = createAuthRouter;
