const { EmailClient } = require("@azure/communication-email");
const { ServiceError } = require("./serviceError");

const INVITE_SUBJECT = "You are invited to collaborate on a Jamboard!";
const ACCESS_REQUEST_SUBJECT = "Edit access requested for your Jamboard";
const PASSWORD_RESET_SUBJECT = "Reset your Jamboard password";

function passwordResetEmailHtml({ code }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Password Reset</title>
  </head>
  <body style="margin:0; padding:0; background:#f1f5f9; color:#0f172a; font-family:Space Grotesk, Segoe UI, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; overflow:hidden;">
            <tr>
              <td style="padding:24px 28px; border-bottom:1px solid #e2e8f0;">
                <div style="font-size:18px; font-weight:700; letter-spacing:0.2px;">Jamboard</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="font-size:20px; font-weight:700; margin-bottom:8px;">Reset your Jamboard password</div>
                <div style="font-size:14px; line-height:22px; color:#475569; margin-bottom:20px;">
                  We received a password reset request for your account. Enter this verification code in Jamboard:
                </div>
                <div style="font-size:14px; line-height:22px; color:#0f172a; margin-bottom:20px;">
                  Verification code:
                </div>
                <div style="display:inline-block; background:#0f172a; color:#ffffff; text-decoration:none; font-weight:700; font-size:22px; letter-spacing:4px; padding:12px 18px; border-radius:10px; font-family:monospace; margin-bottom:20px;">
                  ${code}
                </div>
                <div style="font-size:14px; line-height:22px; color:#475569; margin-bottom:20px;">
                  This code will expire in 15 minutes. If you didn't request a password reset, please ignore this email.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px; background:#f8fafc; font-size:12px; color:#94a3b8;">
                Jamboard Collaboration
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function requireEmailConfig(connectionString, senderAddress) {
  if (!connectionString || !senderAddress) {
    throw new ServiceError(500, "Email configuration is missing.");
  }
}

function inviteEmailHtml({ inviterName, boardTitle, accessLevel, workspaceName, inviteLink }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jamboard Invite</title>
  </head>
  <body style="margin:0; padding:0; background:#f1f5f9; color:#0f172a; font-family:Space Grotesk, Segoe UI, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; overflow:hidden;">
            <tr>
              <td style="padding:24px 28px; border-bottom:1px solid #e2e8f0;">
                <div style="font-size:18px; font-weight:700; letter-spacing:0.2px;">Jamboard</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="font-size:20px; font-weight:700; margin-bottom:8px;">You have been invited</div>
                <div style="font-size:14px; line-height:22px; color:#475569; margin-bottom:20px;">
                  ${inviterName} invited you to collaborate on <strong>${boardTitle}</strong>.
                </div>
                <div style="font-size:14px; line-height:22px; color:#0f172a; margin-bottom:20px;">
                  Access level: <strong>${accessLevel}</strong><br />
                  Workspace: <strong>${workspaceName}</strong>
                </div>
                <a href="${inviteLink}" style="display:inline-block; background:#0f172a; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:12px 18px; border-radius:10px;">Open Board</a>
                <div style="margin-top:20px; font-size:12px; color:#64748b;">
                  If you do not have an account, you can still open the board with this link.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px; background:#f8fafc; font-size:12px; color:#94a3b8;">
                Jamboard Collaboration
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function accessRequestEmailHtml({ requesterName, boardTitle, approveLink, denyLink }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Access Request</title>
  </head>
  <body style="margin:0; padding:0; background:#f1f5f9; color:#0f172a; font-family:Space Grotesk, Segoe UI, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; overflow:hidden;">
            <tr>
              <td style="padding:24px 28px; border-bottom:1px solid #e2e8f0;">
                <div style="font-size:18px; font-weight:700; letter-spacing:0.2px;">Jamboard</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="font-size:20px; font-weight:700; margin-bottom:8px;">Edit access requested</div>
                <div style="font-size:14px; line-height:22px; color:#475569; margin-bottom:20px;">
                  ${requesterName} requested edit access for <strong>${boardTitle}</strong>.
                </div>
                <div style="display:flex; gap:12px;">
                  <a href="${approveLink}" style="display:inline-block; background:#0f172a; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:12px 18px; border-radius:10px;">Approve</a>
                  <a href="${denyLink}" style="display:inline-block; background:#ffffff; color:#0f172a; text-decoration:none; font-weight:600; font-size:14px; padding:12px 18px; border-radius:10px; border:1px solid #e2e8f0;">Deny</a>
                </div>
                <div style="margin-top:20px; font-size:12px; color:#64748b;">
                  You can also review this request in your Jamboard notifications.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px; background:#f8fafc; font-size:12px; color:#94a3b8;">
                Jamboard Collaboration
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function createEmailService({ connectionString, senderAddress }) {
  const client = connectionString ? new EmailClient(connectionString) : null;

  async function sendInviteEmail({
    to,
    inviterName,
    boardTitle,
    accessLevel,
    workspaceName,
    inviteLink,
  }) {
    requireEmailConfig(connectionString, senderAddress);
    const html = inviteEmailHtml({
      inviterName,
      boardTitle,
      accessLevel,
      workspaceName,
      inviteLink,
    });

    const poller = await client.beginSend({
      senderAddress,
      content: {
        subject: INVITE_SUBJECT,
        html,
      },
      recipients: {
        to: [{ address: to }],
      },
    });
    await poller.pollUntilDone();
  }

  async function sendAccessRequestEmail({ to, requesterName, boardTitle, approveLink, denyLink }) {
    requireEmailConfig(connectionString, senderAddress);
    const html = accessRequestEmailHtml({
      requesterName,
      boardTitle,
      approveLink,
      denyLink,
    });

    const poller = await client.beginSend({
      senderAddress,
      content: {
        subject: ACCESS_REQUEST_SUBJECT,
        html,
      },
      recipients: {
        to: [{ address: to }],
      },
    });
    await poller.pollUntilDone();
  }

  async function sendPasswordResetEmail({ to, code }) {
    requireEmailConfig(connectionString, senderAddress);
    const html = passwordResetEmailHtml({ code });

    const poller = await client.beginSend({
      senderAddress,
      content: {
        subject: PASSWORD_RESET_SUBJECT,
        html,
      },
      recipients: {
        to: [{ address: to }],
      },
    });
    await poller.pollUntilDone();
  }

  return {
    sendInviteEmail,
    sendAccessRequestEmail,
    sendPasswordResetEmail,
  };
}

module.exports = {
  createEmailService,
};
