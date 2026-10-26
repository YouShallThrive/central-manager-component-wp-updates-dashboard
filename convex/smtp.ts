"use node";

import { randomBytes } from "node:crypto";
import { connect, Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

/**
 * Minimal dependency-free SMTP client for the Central Manager email send path.
 * One message per connection: SMTP_HOST (default SMTP_PORT 587), STARTTLS on
 * 587, implicit TLS on 465, AUTH LOGIN when SMTP_USER is set. Ops supplies
 * SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM at deploy time.
 */

class SmtpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpError";
  }
}

type MailSocket = Socket | TLSSocket;

function readReply(socket: MailSocket): Promise<[number, string]> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      const match = /^(\d{3})[ -]/m.exec(buffer);
      if (match) {
        const code = Number.parseInt(match[1], 10);
        const lineStart = buffer.indexOf(match[0]);
        const newline = buffer.indexOf("\n", lineStart);
        const text = newline === -1 ? buffer.slice(lineStart) : buffer.slice(lineStart, newline);
        cleanup();
        resolve([code, text.trim()]);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new SmtpError("SMTP connection closed unexpectedly"));
    };
    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

async function sendCommand(socket: MailSocket, line: string): Promise<[number, string]> {
  await new Promise<void>((resolve, reject) => {
    socket.write(line + "\r\n", err => (err ? reject(err) : resolve()));
  });
  return readReply(socket);
}

async function sendRaw(socket: MailSocket, data: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(data, err => (err ? reject(err) : resolve()));
  });
}

async function expect(socket: MailSocket, code: number, line: string): Promise<void> {
  const [got, text] = await sendCommand(socket, line);
  if (got !== code) {
    throw new SmtpError(`SMTP command ${line.split(" ")[0]} failed: ${got} ${text}`);
  }
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function dotStuff(value: string): string {
  return value
    .split(/\r\n|\n/)
    .map(line => (line.startsWith(".") ? "." + line : line))
    .join("\r\n");
}

function buildMessage(env: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const id = `${Date.now()}.${randomBytes(6).toString("hex")}@central-manager`;
  const headers = [
    `From: ${env.from}`,
    `To: ${env.to}`,
    `Subject: ${env.subject}`,
    "MIME-Version: 1.0",
    `Message-ID: <${id}>`,
    'Content-Type: multipart/alternative; boundary="cm-boundary"',
  ].join("\r\n");

  const body = [
    "--cm-boundary",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    env.text,
    "--cm-boundary",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    env.html,
    "--cm-boundary--",
  ].join("\r\n");

  return `${headers}\r\n\r\n${body}`;
}

export async function sendMail({
  to,
  from,
  subject,
  html,
  text,
}: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    throw new SmtpError("SMTP email not configured: SMTP_HOST is required.");
  }
  const portRaw = process.env.SMTP_PORT;
  const port = portRaw ? Number.parseInt(portRaw, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const implicitTls = port === 465;

  let socket: MailSocket;
  if (implicitTls) {
    socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false });
  } else {
    socket = connect({ host, port });
  }

  try {
    const [greeting] = await readReply(socket);
    if (greeting !== 220) {
      throw new SmtpError(`SMTP greeting was ${greeting}`);
    }

    const [, ehloText] = await sendCommand(socket, `EHLO ${host}`);
    const supportsStartTls = !implicitTls && /250[- ]STARTTLS/i.test(ehloText);

    if (supportsStartTls && socket instanceof Socket) {
      await expect(socket, 220, "STARTTLS");
      const raw = socket;
      raw.pause();
      socket = tlsConnect({ socket: raw, servername: host, rejectUnauthorized: false });
      await new Promise<void>((resolve, reject) => {
        (socket as TLSSocket).once("secureConnect", resolve);
        (socket as TLSSocket).once("error", reject);
      });
    }

    // Re-EHLO after STARTTLS (auth capabilities are only valid once encrypted).
    await expect(socket, 250, `EHLO ${host}`);

    if (user && pass) {
      await expect(socket, 334, "AUTH LOGIN");
      await expect(socket, 334, base64(user));
      await expect(socket, 235, base64(pass));
    }

    await expect(socket, 250, `MAIL FROM:<${from}>`);
    await expect(socket, 250, `RCPT TO:<${to}>`);
    const [dataCode, dataReply] = await sendCommand(socket, "DATA");
    if (dataCode !== 354) {
      throw new SmtpError(`SMTP DATA rejected: ${dataCode} ${dataReply}`);
    }
    await sendRaw(socket, dotStuff(buildMessage({ from, to, subject, html, text })) + "\r\n.\r\n");
    await expect(socket, 250, ".");

    await sendRaw(socket, "QUIT\r\n");
  } finally {
    socket.destroy();
  }
}

/**
 * Node-runtime action wrapper for `sendMail`. The SMTP client uses node:net /
 * node:tls / node:crypto, which are only available in the Node.js runtime, so
 * email sending is an action (never inlined into the isolate auth bundle).
 */
export const sendSmtpMail = internalAction({
  args: {
    to: v.string(),
    from: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.string(),
  },
  handler: async (_ctx, args) => {
    await sendMail(args);
  },
});