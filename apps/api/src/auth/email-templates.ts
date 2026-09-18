import type { EmailLocale } from "./communication-locales";
import { emailIdentity, type EmailBranding } from "./email-branding";
import { emailLogo } from "./email-logo";

export type SecurityNoticeKind = "email_changed" | "phone_changed" | "password_reset";
type EmailCopy = {
  verification: string; code: string; expires: string; ignore: string;
  requested: string; requestedBody: string; security: string;
  notices: Record<SecurityNoticeKind, string>; noticeBody: string;
  footer: { support: string; imprint: string; imprintEnglish: string };
};

export const emailMessages: Record<EmailLocale, EmailCopy> = {
  en: {
    verification: "Confirm your SHPROHLI email address", code: "Your verification code",
    expires: "This code expires in {minutes} minutes. Never share it with anyone.",
    ignore: "If you did not request this email, you can ignore it.",
    requested: "A change to your SHPROHLI email was requested",
    requestedBody: "A change to your sign-in email was requested. Your current address remains active until the new one is confirmed.",
    security: "If this was not you, recover your account from the sign-in page, sign out all sessions and contact support.",
    notices: { email_changed: "Your SHPROHLI email address was changed", phone_changed: "Your SHPROHLI phone number was changed", password_reset: "Your SHPROHLI password was reset" },
    noticeBody: "The change is complete. Other active sessions have been signed out.",
    footer: { support: "Support", imprint: "Imprint", imprintEnglish: "Imprint (English)" }
  },
  de: {
    verification: "E-Mail-Adresse für SHPROHLI bestätigen", code: "Ihr Bestätigungscode",
    expires: "Dieser Code ist {minutes} Minuten gültig. Geben Sie ihn niemals weiter.",
    ignore: "Wenn Sie diese E-Mail nicht angefordert haben, können Sie sie ignorieren.",
    requested: "Änderung Ihrer SHPROHLI-E-Mail angefordert",
    requestedBody: "Eine Änderung Ihrer Anmelde-E-Mail wurde angefordert. Ihre aktuelle Adresse bleibt aktiv, bis die neue bestätigt ist.",
    security: "Wenn Sie dies nicht waren, stellen Sie den Kontozugriff über die Anmeldeseite wieder her, melden Sie alle Sitzungen ab und kontaktieren Sie den Support.",
    notices: { email_changed: "Ihre SHPROHLI-E-Mail-Adresse wurde geändert", phone_changed: "Ihre SHPROHLI-Telefonnummer wurde geändert", password_reset: "Ihr SHPROHLI-Passwort wurde zurückgesetzt" },
    noticeBody: "Die Änderung ist abgeschlossen. Andere aktive Sitzungen wurden abgemeldet.",
    footer: { support: "Support", imprint: "Impressum", imprintEnglish: "Impressum (Englisch)" }
  },
  fr: {
    verification: "Confirmez votre adresse e-mail SHPROHLI", code: "Votre code de vérification",
    expires: "Ce code expire dans {minutes} minutes. Ne le communiquez à personne.",
    ignore: "Si vous n’avez pas demandé cet e-mail, vous pouvez l’ignorer.",
    requested: "Une modification de votre e-mail SHPROHLI a été demandée",
    requestedBody: "Une modification de votre adresse de connexion a été demandée. L’adresse actuelle reste active jusqu’à la confirmation de la nouvelle.",
    security: "Si vous n’êtes pas à l’origine de cette demande, récupérez votre compte depuis la page de connexion, déconnectez toutes les sessions et contactez l’assistance.",
    notices: { email_changed: "Votre adresse e-mail SHPROHLI a été modifiée", phone_changed: "Votre numéro de téléphone SHPROHLI a été modifié", password_reset: "Votre mot de passe SHPROHLI a été réinitialisé" },
    noticeBody: "La modification est terminée. Les autres sessions actives ont été déconnectées.",
    footer: { support: "Assistance", imprint: "Mentions légales", imprintEnglish: "Mentions légales (en anglais)" }
  },
  it: {
    verification: "Conferma il tuo indirizzo e-mail SHPROHLI", code: "Il tuo codice di verifica",
    expires: "Questo codice scade tra {minutes} minuti. Non condividerlo con nessuno.",
    ignore: "Se non hai richiesto questa e-mail, puoi ignorarla.",
    requested: "È stata richiesta una modifica dell’e-mail SHPROHLI",
    requestedBody: "È stata richiesta una modifica dell’indirizzo di accesso. L’indirizzo attuale rimane attivo fino alla conferma di quello nuovo.",
    security: "Se non sei stato tu, recupera l’account dalla pagina di accesso, disconnetti tutte le sessioni e contatta l’assistenza.",
    notices: { email_changed: "Il tuo indirizzo e-mail SHPROHLI è stato modificato", phone_changed: "Il tuo numero di telefono SHPROHLI è stato modificato", password_reset: "La tua password SHPROHLI è stata reimpostata" },
    noticeBody: "La modifica è completata. Le altre sessioni attive sono state disconnesse.",
    footer: { support: "Assistenza", imprint: "Note legali", imprintEnglish: "Note legali (in inglese)" }
  },
  uk: {
    verification: "Підтвердьте свою електронну адресу SHPROHLI", code: "Ваш код підтвердження",
    expires: "Код дійсний протягом {minutes} хвилин. Нікому його не повідомляйте.",
    ignore: "Якщо ви не запитували цей лист, можете його проігнорувати.",
    requested: "Запит на зміну електронної адреси SHPROHLI",
    requestedBody: "Надійшов запит на зміну адреси для входу. Поточна адреса діятиме до підтвердження нової.",
    security: "Якщо це були не ви, відновіть доступ зі сторінки входу, завершіть усі сеанси та зверніться до підтримки.",
    notices: { email_changed: "Вашу електронну адресу SHPROHLI змінено", phone_changed: "Ваш номер телефону SHPROHLI змінено", password_reset: "Ваш пароль SHPROHLI скинуто" },
    noticeBody: "Зміну завершено. Інші активні сеанси завершено.",
    footer: { support: "Підтримка", imprint: "Правова інформація", imprintEnglish: "Правова інформація (англійською)" }
  },
  ru: {
    verification: "Подтвердите свой email в SHPROHLI", code: "Ваш код подтверждения",
    expires: "Код действует {minutes} минут. Никому его не сообщайте.",
    ignore: "Если вы не запрашивали это письмо, можете его проигнорировать.",
    requested: "Запрошена смена email в SHPROHLI",
    requestedBody: "Поступил запрос на смену адреса для входа. Текущий адрес действует до подтверждения нового.",
    security: "Если это были не вы, восстановите доступ со страницы входа, завершите все сеансы и обратитесь в поддержку.",
    notices: { email_changed: "Ваш email в SHPROHLI изменён", phone_changed: "Ваш номер телефона в SHPROHLI изменён", password_reset: "Ваш пароль SHPROHLI сброшен" },
    noticeBody: "Изменение завершено. Остальные активные сеансы завершены.",
    footer: { support: "Поддержка", imprint: "Правовая информация", imprintEnglish: "Правовая информация (на английском)" }
  }
};

export type EmailContent = { subject: string; text: string; html: string; attachments: Array<typeof emailLogo> };
const defaultBranding: EmailBranding = { siteUrl: "https://shprohli.ch" };
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}
export function renderEmail(locale: EmailLocale, subject: string, paragraphs: string[], branding: EmailBranding, code?: string): EmailContent {
  const footer = emailMessages[locale].footer;
  // Only EN/DE legal pages are published. Future email languages use an explicit
  // EN fallback until their legal routes are published as well.
  const imprintUrl = new URL(locale === "de" ? "/de/impressum" : "/en/imprint", branding.siteUrl).href;
  const imprintLabel = locale !== "en" && locale !== "de" ? footer.imprintEnglish : footer.imprint;
  const text = ["SHPROHLI", subject, ...paragraphs, "---",
    `${imprintLabel}: ${imprintUrl}`, `${footer.support}: ${emailIdentity.supportAddress}`].join("\n\n");
  const body = paragraphs.map((value) => `<p style="margin:0 0 20px;${value === code ? 'font-family:Consolas,Menlo,monospace;font-size:36px;line-height:48px;letter-spacing:5px;font-weight:700;white-space:nowrap' : 'font-size:16px;line-height:25px'}">${escapeHtml(value)}</p>`).join("");
  const link = (url: string, label: string) => `<a href="${escapeHtml(url)}" style="color:#35614b;text-decoration:underline">${escapeHtml(label)}</a>`;
  // Mail clients strip semantic wrappers such as <main>. Tables and inline styles
  // preserve spacing; transparent surfaces avoid a second card/background in Gmail.
  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;color:#222b25;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;word-wrap:break-word">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse"><tr><td align="center">
<!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;border-collapse:collapse"><tr><td style="padding:28px 24px 12px">
<img src="cid:${emailLogo.content_id}" width="184" height="31" alt="SHPROHLI" style="display:block;width:184px;height:31px;max-width:100%;border:0;color:#222b25;font-size:22px;font-weight:bold">
<h1 style="margin:28px 0 20px;font-size:24px;line-height:32px;font-weight:700">${escapeHtml(subject)}</h1>
${body}
</td></tr><tr><td style="padding:0 24px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid #dce2dd"><tr><td style="padding-top:20px;color:#5f6b63;font-size:12px;line-height:19px">
<p style="margin:0">${link(imprintUrl, imprintLabel)} &nbsp;·&nbsp; ${link(`mailto:${emailIdentity.supportAddress}`, footer.support)}</p>
</td></tr></table></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { subject, text, html, attachments: [emailLogo] };
}
export function verificationEmail(input: { locale: EmailLocale; code: string; expiresInMinutes: number }, branding = defaultBranding) {
  const copy = emailMessages[input.locale];
  return renderEmail(input.locale, copy.verification, [copy.code, input.code, copy.expires.replace("{minutes}", String(input.expiresInMinutes)), copy.ignore], branding, input.code);
}
export function emailChangeRequestNotice(locale: EmailLocale, branding = defaultBranding) {
  const copy = emailMessages[locale];
  return renderEmail(locale, copy.requested, [copy.requestedBody, copy.security], branding);
}
export function securityNoticeEmail(locale: EmailLocale, kind: SecurityNoticeKind, branding = defaultBranding) {
  const copy = emailMessages[locale];
  return renderEmail(locale, copy.notices[kind], [copy.noticeBody, copy.security], branding);
}
