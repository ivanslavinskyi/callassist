"use client";

import { createContext, useContext, type ReactNode } from "react";
import { messages, type Messages, type UiLocale } from "@/lib/i18n/messages";
import { localizePathname } from "@/lib/i18n/routing";

const UiLocaleContext = createContext<{
  locale: UiLocale;
  messages: Messages;
}>({ locale: "en", messages: messages.en });

export function UiLocaleProvider({
  children,
  locale
}: {
  children: ReactNode;
  locale: UiLocale;
}) {
  return (
    <UiLocaleContext.Provider value={{ locale, messages: messages[locale] }}>
      {children}
    </UiLocaleContext.Provider>
  );
}

export function useUiLocale() {
  const context = useContext(UiLocaleContext);
  return { ...context, localizeHref: (pathname: string) =>
    localizePathname(pathname, context.locale) };
}
