/** Regenerate the complete editorial handoff after changing Romansh resources. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ui from "../apps/web/lib/i18n/resources/rm.json";
import pages from "../apps/api/src/content/locales/rm.json";
import { emailMessages } from "../apps/api/src/auth/email-templates";
import { notificationMessages } from "../apps/api/src/notifications/notification-messages";
import { notificationDetailMessages } from "../apps/api/src/notifications/notification-details";
import { privacyMessages } from "../apps/web/lib/i18n/privacy-messages";

const lines = ["# Rumantsch Grischun: полный список для редакторской проверки", "",
  "Все приведённые ниже новые тексты RM требуют проверки носителем Rumantsch Grischun. Это список мест, где естественность не подтверждена редактором, а не утверждение, что каждая строка ошибочна. Особое внимание: юридические формулировки, согласие на запись, безопасность аккаунта, склонение и терминология звонков. Утверждённый слоган `Ins na sto betg discurrer.` исключён: он сохранён без изменений.", "",
  "Исходная фраза или путь указаны перед полным текстом RM. Дубликаты между UI, CMS и email оставлены, чтобы редактор мог проверить каждое место использования.", ""];
function section(title: string, values: unknown, prefix = "") {
  if (!prefix) lines.push(`## ${title}`, "");
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") lines.push(`- **${path.replaceAll("\n", " ")}**`, `  ${value.replaceAll("\n", " / ")}`, "");
    else if (value && typeof value === "object") section(title, value, path);
  }
}
section("UI, authentication, validation, demo и экспорт", ui);
section("Landing, FAQ, About, Support и юридические страницы", pages);
section("Account emails", emailMessages.rm);
section("Автоматические административные письма", notificationMessages.rm);
section("Состояния и расходы в письмах", notificationDetailMessages.rm);
section("Уведомление о cookies и статистике", privacyMessages.rm);
writeFileSync(fileURLToPath(new URL("../docs/rumantsch-review.md", import.meta.url)), lines.join("\n").trimEnd() + "\n", "utf8");
console.log(`Wrote ${Object.keys(ui).length} UI entries, ${Object.keys(pages).length} public entries and email/notice namespaces.`);
