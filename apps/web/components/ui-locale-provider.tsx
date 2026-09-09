"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { messages, type Messages, type UiLocale } from "@/lib/i18n/messages";
import { localizePathname } from "@/lib/i18n/routing";
import { uiLocaleRegistry } from "@/lib/i18n/registry";

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
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = uiLocaleRegistry[locale].direction;
  }, [locale]);
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
