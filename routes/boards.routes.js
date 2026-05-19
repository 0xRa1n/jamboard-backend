const express = require("express");
const multer = require("multer");
const { createBoardsController } = require("../controllers/boardsController");
const { requireAuth } = require("../middleware/auth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

function createBoardsRouter({ query, jwtSecret, onShareRevoked, emailConfig }) {
  const router = express.Router();
  const controller = createBoardsController({
    query,
    onShareRevoked,
    jwtSecret,
    emailConfig,
  });

  router.get("/shared/:shareToken", controller.getSharedBoard);
  router.get("/invites/:inviteToken", controller.getInviteBoard);

  router.get("/images/check-hash", async (req, res) => {
    const { hash } = req.query;
    if (!hash) {
      return res.status(400).json({ message: "Hash parameter is required." });
    }
    try {
      const result = await query("SELECT file_path FROM uploaded_images WHERE hash = $1 LIMIT 1", [
        hash,
      ]);
      if (result.rows.length > 0) {
        return res.json({ exists: true, url: result.rows[0].file_path });
      }
      return res.json({ exists: false });
    } catch (err) {
      console.error("Check hash error:", err);
      return res.status(500).json({ message: "Internal server error." });
    }
  });

  router.post("/images/upload", upload.single("image"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "Please upload an image file." });
    }
    const { hash } = req.body;
    if (!hash) {
      return res.status(400).json({ message: "Hash is required." });
    }

    try {
      const existing = await query(
        "SELECT file_path FROM uploaded_images WHERE hash = $1 LIMIT 1",
        [hash],
      );
      if (existing.rows.length > 0) {
        return res.json({ url: existing.rows[0].file_path });
      }

      const mimeType = req.file.mimetype;
      const extensionMap = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
      };
      const ext = extensionMap[mimeType] || ".png";
      const filename = `${hash}${ext}`;

      const path = require("path");
      const fs = require("fs/promises");
      const boardImagesDir = path.join(__dirname, "..", "..", "uploads", "board_images");
      await fs.mkdir(boardImagesDir, { recursive: true });

      const absoluteFilePath = path.join(boardImagesDir, filename);
      const publicFilePath = `/uploads/board_images/${filename}`;

      await fs.writeFile(absoluteFilePath, req.file.buffer);

      await query(
        "INSERT INTO uploaded_images (hash, file_path) VALUES ($1, $2) ON CONFLICT (hash) DO NOTHING",
        [hash, publicFilePath],
      );

      return res.json({ url: publicFilePath });
    } catch (err) {
      console.error("Upload board image error:", err);
      return res.status(500).json({ message: "Internal server error." });
    }
  });

  router.use(requireAuth(jwtSecret, query));

  router.get("/", controller.listBoards);
  router.post("/", controller.createBoard);
  router.patch("/:boardId", controller.renameBoard);
  router.patch("/:boardId/thumbnail", controller.updateThumbnail);
  router.post("/:boardId/duplicate", controller.duplicateBoard);
  router.delete("/:boardId", controller.deleteBoard);
  router.post("/:boardId/share", controller.createShareLink);
  router.delete("/:boardId/share", controller.revokeShareLink);
  router.post("/:boardId/invite", controller.createInvite);
  router.post("/:boardId/access-requests", controller.createAccessRequest);

  return router;
}

module.exports = createBoardsRouter;
