import nodemailer from 'nodemailer';
import type { SmtpSettings } from './settings';

export async function sendMail(smtp: SmtpSettings, msg: { to: string; subject: string; text: string; html?: string; messageId?: string }): Promise<string> {
  if (!smtp.host) throw new Error('SMTP not configured');
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port || (smtp.secure ? 465 : 587), secure: !!smtp.secure,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
  });
  const info = await transport.sendMail({ from: smtp.from || smtp.user, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, messageId: msg.messageId });
  return info.messageId ?? 'sent';
}
