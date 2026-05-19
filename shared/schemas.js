const { z } = require("zod");

const requiredString = z.preprocess((value) => String(value ?? ""), z.string());
const optionalString = z.preprocess(
  (value) => (value === undefined || value === null ? undefined : String(value)),
  z.string().optional(),
);
const requiredNumber = z.preprocess((value) => Number(value), z.number());

const authRegisterSchema = z.object({
  firstName: requiredString,
  lastName: requiredString,
  username: requiredString,
  password: requiredString,
  email: optionalString,
});

const authLoginSchema = z.object({
  username: requiredString,
  password: requiredString,
});

const authProfileUpdateSchema = z.object({
  username: requiredString,
  firstName: requiredString,
  lastName: requiredString,
  email: requiredString,
});

const authThemeUpdateSchema = z.object({
  themePreference: z.enum(["light", "dark", "system"]),
});

const authNotificationsUpdateSchema = z.object({
  collaboratorInvites: z.boolean(),
  askPermission: z.boolean(),
});

const authPasswordUpdateSchema = z.object({
  currentPassword: requiredString,
  newPassword: requiredString,
  confirmNewPassword: requiredString,
});

const boardCreateSchema = z.object({
  title: optionalString,
  workspaceId: requiredNumber,
});

const boardRenameSchema = z.object({
  title: optionalString,
});

const boardThumbnailSchema = z.object({
  thumbnail: z.string(),
});

const sharePermissionSchema = z.enum(["view", "edit"]);

const boardShareTokenSchema = z.object({
  shareToken: z.string().min(1),
});

const boardSharePermissionSchema = z.object({
  permission: sharePermissionSchema.optional(),
});

const boardInviteSchema = z.object({
  email: requiredString,
  permission: sharePermissionSchema.optional(),
});

const boardAccessRequestSchema = z.object({
  shareToken: requiredString,
});

const workspaceCreateSchema = z.object({
  name: optionalString,
});

const workspaceRenameSchema = z.object({
  name: optionalString,
});

module.exports = {
  authRegisterSchema,
  authLoginSchema,
  authProfileUpdateSchema,
  authThemeUpdateSchema,
  authNotificationsUpdateSchema,
  authPasswordUpdateSchema,
  boardCreateSchema,
  boardRenameSchema,
  boardThumbnailSchema,
  boardShareTokenSchema,
  boardSharePermissionSchema,
  boardInviteSchema,
  boardAccessRequestSchema,
  workspaceCreateSchema,
  workspaceRenameSchema,
  sharePermissionSchema,
};
