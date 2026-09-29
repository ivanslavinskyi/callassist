import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { CreateCallForm } from "../components/create-call-form";
import { CallDraftProvider } from "../components/call-draft-provider";
import { messages } from "./i18n/messages";

afterEach(() => vi.unstubAllGlobals());
it.each(["user", "admin", "superadmin"] as const)("renders only authorized settings for %s", userRole => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<CallDraftProvider><CreateCallForm userRole={userRole} onCreated={() => {}} /></CallDraftProvider>);
  expect(html).not.toContain('value="request_external_delivery"');
  expect(html).not.toContain('value="message_only"');
  expect(html.includes('value="friendly"')).toBe(userRole === "superadmin");
  expect(html.includes('value="informal"')).toBe(userRole === "superadmin");
  if (userRole === "superadmin") expect(html).toContain('value="neutral" selected');
  expect(html).not.toContain(`<span>${messages.en.form.copy.deliveryInstruction}</span>`);
});
