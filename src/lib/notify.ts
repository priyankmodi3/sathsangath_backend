// Delivery layer for SMS / email. Replace the bodies with a real provider
// (MSG91 / Twilio for SMS, SES / SendGrid / SMTP for email). Callers never change.
export async function sendSms(to: string, text: string) {
  console.log(`[SMS -> ${to}] ${text}`);
}
export async function sendEmail(to: string | null | undefined, subject: string, text: string) {
  if (!to) return;
  console.log(`[EMAIL -> ${to}] ${subject}\n${text}`);
}
export async function notifyMember(m: { phone: string; email?: string | null }, subject: string, text: string) {
  await Promise.all([sendSms(m.phone, text), sendEmail(m.email, subject, text)]);
}
