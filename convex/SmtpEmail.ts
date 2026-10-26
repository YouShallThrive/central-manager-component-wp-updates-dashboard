import { Email } from "@convex-dev/auth/providers/Email";
import { APP_NAME } from "./constants";
import { sendMail } from "./smtp";

declare const process: { env: Record<string, string | undefined> };

function generateOTP() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

async function sendEmail({
  email,
  token,
  subject,
  heading,
  description,
}: {
  email: string;
  token: string;
  subject: string;
  heading: string;
  description: string;
}) {
  const from = process.env.SMTP_FROM;
  if (!from) {
    throw new Error("SMTP email not configured: SMTP_FROM is required.");
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333;">${heading}</h2>
      <p style="color: #666;">${description}</p>
      <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
        <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #333;">${token}</span>
      </div>
      <p style="color: #999; font-size: 12px;">This code expires in 15 minutes.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">This email was sent by ${APP_NAME}</p>
    </div>
  `;
  const text =
    `${heading}\n\n${description}\n\nYour code is: ${token}\n\n` +
    `This code expires in 15 minutes.\n\n---\nThis email was sent by ${APP_NAME}`;

  await sendMail({
    to: email,
    from,
    subject: `${subject} - ${APP_NAME}`,
    html,
    text,
  });
}

/**
 * Email verification provider for sign-up flow. Sends the same 6-digit OTP
 * code and template as before, now through a plain SMTP server configured via
 * SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM (ops fills the
 * credentials at deploy time).
 */
export const SmtpEmail = Email({
  id: "smtp-email",
  maxAge: 60 * 15, // 15 minutes

  async generateVerificationToken() {
    return generateOTP();
  },

  async sendVerificationRequest({ identifier: email, token }) {
    await sendEmail({
      email,
      token,
      subject: "Verify your email",
      heading: "Verify your email",
      description: "Your verification code is:",
    });
  },
});

/**
 * Password reset email provider. Same OTP length/lifetime as verification,
 * just a different template, as before.
 */
export const SmtpPasswordReset = Email({
  id: "smtp-password-reset",
  maxAge: 60 * 15, // 15 minutes

  async generateVerificationToken() {
    return generateOTP();
  },

  async sendVerificationRequest({ identifier: email, token }) {
    await sendEmail({
      email,
      token,
      subject: "Reset your password",
      heading: "Reset your password",
      description: "Your password reset code is:",
    });
  },
});