const { createAuthService } = require("../services/authService");
const { getAuthenticatedUser, toNumericId } = require("../services/sessionService");
const { ServiceError } = require("../services/serviceError");
const { createEmailService } = require("../services/emailService");
const {
  authRegisterSchema,
  authLoginSchema,
  authProfileUpdateSchema,
  authThemeUpdateSchema,
  authNotificationsUpdateSchema,
  authPasswordUpdateSchema,
} = require("../shared/schemas");

function createAuthController({
  query,
  jwtSecret,
  avatarUploadDir,
  onSessionRevoked,
  onOtherSessionsRevoked,
  emailConfig,
}) {
  const authService = createAuthService({
    query,
    jwtSecret,
    avatarUploadDir,
    emailService: createEmailService(emailConfig || {}),
  });

  async function getMe(req, res) {
    const user = getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    try {
      const profile = await authService.getProfileById(user.id);
      return res.json({
        user: {
          id: toNumericId(profile.id),
          username: profile.username,
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatarUrl: profile.avatarUrl,
          themePreference: profile.themePreference,
          notificationPreferences: profile.notificationPreferences,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Get profile error:", error);
      return res.status(500).json({ message: "Unable to load profile." });
    }
  }

  async function register(req, res) {
    const parsed = authRegisterSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Username and password are required." });
    }

    try {
      const user = await authService.registerUser(parsed.data);
      return res.status(201).json({
        message: "User registered successfully.",
        user: {
          id: toNumericId(user.id),
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          themePreference: user.themePreference,
          notificationPreferences: user.notificationPreferences,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Registration error:", error);
      return res.status(500).json({ message: "Registration failed." });
    }
  }

  async function login(req, res) {
    const parsed = authLoginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Username and password are required." });
    }

    try {
      const { token, user } = await authService.loginUser({
        ...parsed.data,
        userAgent: req.headers["user-agent"] || "",
      });
      return res.json({
        message: "Login successful.",
        token,
        user: {
          id: toNumericId(user.id),
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          themePreference: user.themePreference,
          notificationPreferences: user.notificationPreferences,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Login error:", error);
      return res.status(500).json({ message: "Login failed." });
    }
  }

  async function updateMe(req, res) {
    const user = getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const parsed = authProfileUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Username, first name, last name, and email are required." });
    }

    try {
      const updatedProfile = await authService.updateProfileById(user.id, parsed.data);
      return res.json({
        message: "Profile updated successfully.",
        user: {
          id: toNumericId(updatedProfile.id),
          username: updatedProfile.username,
          email: updatedProfile.email,
          firstName: updatedProfile.firstName,
          lastName: updatedProfile.lastName,
          avatarUrl: updatedProfile.avatarUrl,
          themePreference: updatedProfile.themePreference,
          notificationPreferences: updatedProfile.notificationPreferences,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Update profile error:", error);
      return res.status(500).json({ message: "Unable to update profile." });
    }
  }

  async function uploadAvatar(req, res) {
    const user = getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Please upload an avatar image." });
    }

    try {
      const updatedProfile = await authService.uploadAvatarById(user.id, {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
      });

      return res.json({
        message: "Avatar updated successfully.",
        user: {
          id: toNumericId(updatedProfile.id),
          username: updatedProfile.username,
          email: updatedProfile.email,
          firstName: updatedProfile.firstName,
          lastName: updatedProfile.lastName,
          avatarUrl: updatedProfile.avatarUrl,
          themePreference: updatedProfile.themePreference,
          notificationPreferences: updatedProfile.notificationPreferences,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Upload avatar error:", error);
      return res.status(500).json({ message: "Unable to upload avatar." });
    }
  }

  async function updateThemePreference(req, res) {
    const user = getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const parsed = authThemeUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Theme preference must be light, dark, or system." });
    }

    try {
      const updatedProfile = await authService.updateThemePreferenceById(
        user.id,
        parsed.data.themePreference,
      );

      return res.json({
        message: "Theme preference updated successfully.",
        user: {
          id: toNumericId(updatedProfile.id),
          username: updatedProfile.username,
          email: updatedProfile.email,
          firstName: updatedProfile.firstName,
          lastName: updatedProfile.lastName,
          avatarUrl: updatedProfile.avatarUrl,
          themePreference: updatedProfile.themePreference,
          notificationPreferences: updatedProfile.notificationPreferences,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Update theme preference error:", error);
      return res.status(500).json({ message: "Unable to update theme preference." });
    }
  }

  async function updateNotificationPreferences(req, res) {
    const user = getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const parsed = authNotificationsUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Notification preferences are invalid." });
    }

    try {
      const updatedProfile = await authService.updateNotificationPreferencesById(
        user.id,
        parsed.data,
      );
      return res.json({
        message: "Notification preferences updated successfully.",
        user: {
          id: toNumericId(updatedProfile.id),
          username: updatedProfile.username,
          email: updatedProfile.email,
          firstName: updatedProfile.firstName,
          lastName: updatedProfile.lastName,
          avatarUrl: updatedProfile.avatarUrl,
          themePreference: updatedProfile.themePreference,
          notificationPreferences: updatedProfile.notificationPreferences,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Update notification preferences error:", error);
      return res.status(500).json({ message: "Unable to update notification preferences." });
    }
  }

  async function updatePassword(req, res) {
    const user = getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const parsed = authPasswordUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Current password, new password, and confirmation are required." });
    }

    try {
      await authService.changePasswordById(user.id, parsed.data);
      return res.json({ message: "Password updated successfully." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Update password error:", error);
      return res.status(500).json({ message: "Unable to update password." });
    }
  }

  async function listSessions(req, res) {
    const user = req.user || getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    try {
      const sessions = await authService.listSessionsByUserId(user.id, user.sessionId);
      return res.json({ sessions });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("List sessions error:", error);
      return res.status(500).json({ message: "Unable to load sessions." });
    }
  }

  async function revokeSession(req, res) {
    const user = req.user || getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    try {
      const revokedSessionId = await authService.revokeSessionById(
        user.id,
        req.params.sessionId,
        user.sessionId,
      );
      if (onSessionRevoked) {
        onSessionRevoked(revokedSessionId, user.id);
      }
      return res.json({ message: "Session revoked." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Revoke session error:", error);
      return res.status(500).json({ message: "Unable to revoke session." });
    }
  }

  async function revokeOtherSessions(req, res) {
    const user = req.user || getAuthenticatedUser(req, jwtSecret);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    try {
      const revokedSessionIds = await authService.revokeOtherSessionsByUserId(
        user.id,
        user.sessionId,
      );
      if (onOtherSessionsRevoked && revokedSessionIds.length > 0) {
        onOtherSessionsRevoked(revokedSessionIds, user.id, user.sessionId);
      }
      return res.json({
        message:
          revokedSessionIds.length > 0
            ? "Signed out of other sessions."
            : "No other active sessions. You're currently signed in on this device.",
        revokedCount: revokedSessionIds.length,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Revoke other sessions error:", error);
      return res.status(500).json({ message: "Unable to sign out other sessions." });
    }
  }

  async function initiatePasswordReset(req, res) {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "Email is required." });
    }

    try {
      await authService.initiatePasswordReset(email.trim());
      return res.json({ message: "Verification code sent to email." });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Initiate password reset error:", error);
      return res.status(500).json({ message: "Unable to initiate password reset." });
    }
  }

  async function verifyPasswordResetCode(req, res) {
    const { email, code } = req.body || {};
    if (!email || !code || typeof email !== "string" || typeof code !== "string") {
      return res.status(400).json({ message: "Email and verification code are required." });
    }

    try {
      const token = await authService.verifyPasswordResetCode(email.trim(), code.trim());
      return res.json({ message: "Code verified.", resetToken: token });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Verify password reset code error:", error);
      return res.status(500).json({ message: "Unable to verify code." });
    }
  }

  async function resetPassword(req, res) {
    const { resetToken, newPassword } = req.body || {};
    if (
      !resetToken ||
      !newPassword ||
      typeof resetToken !== "string" ||
      typeof newPassword !== "string"
    ) {
      return res.status(400).json({ message: "Reset token and new password are required." });
    }

    try {
      const user = await authService.resetPassword(resetToken, newPassword);
      return res.json({
        message: "Password reset successfully.",
        user: {
          id: toNumericId(user.id),
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          themePreference: user.themePreference,
          notificationPreferences: user.notificationPreferences,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Reset password error:", error);
      return res.status(500).json({ message: "Unable to reset password." });
    }
  }

  return {
    getMe,
    updateMe,
    uploadAvatar,
    updateThemePreference,
    updateNotificationPreferences,
    updatePassword,
    listSessions,
    revokeSession,
    revokeOtherSessions,
    register,
    login,
    initiatePasswordReset,
    verifyPasswordResetCode,
    resetPassword,
  };
}

module.exports = {
  createAuthController,
};
