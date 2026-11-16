import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export async function sendLink(email, link) {
  if (process.env.MAIL_MODE === 'local') {
    const dir = resolve(process.env.DATA_DIR || './data', 'mail');
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, `${randomUUID()}.txt`), `To: ${email}\nSubject: Your Engine Atlas edit link\n\n${link}\n\nExpires in 20 minutes.\n`, { mode: 0o600 });
    return;
  }
  if (process.env.MAIL_MODE !== 'ses' || !process.env.SES_REGION || !process.env.SES_FROM) throw new Error('SES not configured');
  const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
  const client = new SESv2Client({ region: process.env.SES_REGION });
  await client.send(new SendEmailCommand({ FromEmailAddress: process.env.SES_FROM, Destination: { ToAddresses: [email] }, Content: { Simple: {
    Subject: { Data: 'Your Engine Atlas edit link' }, Body: { Text: { Data: `Open this link to edit your profile (expires in 20 minutes):\n${link}\n\nIf you did not request it, ignore this email.` } }
  } } }));
}
