const { getBearerToken, validateAuthenticatedSession } = require("../services/sessionService");

function requireAuth(jwtSecret, query) {
  return async (req, res, next) => {
    try {
      const token = getBearerToken(req);
      if (!token) {
        return res.status(401).json({ message: "Authentication required." });
      }

      const user = await validateAuthenticatedSession({
        token,
        jwtSecret,
        query,
        touchLastActiveAt: true,
      });
      if (!user) {
        return res.status(401).json({ message: "Authentication required." });
      }

      req.user = user;
      return next();
    } catch (error) {
      console.error("Auth middleware error:", error);
      return res.status(500).json({ message: "Authentication check failed." });
    }
  };
}

module.exports = {
  requireAuth,
};
