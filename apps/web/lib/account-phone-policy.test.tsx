import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { uiLocales } from "@callassist/contracts";
import { PhoneInput } from "../components/phone-input";
import { UiLocaleProvider } from "../components/ui-locale-provider";
import { accountPhoneMessages } from "./i18n/account-phone-messages";
import { getAuthErrorMessage } from "./i18n/auth-messages";
import { getAccountContactChangeErrorMessage } from "./i18n/account-messages";
import { ApiError } from "./api";

describe("account phone policy UI",()=>{
  it.each(uiLocales)("hides country selection and explains the Swiss restriction in %s",locale=>{
    for(const value of ["0790000001","+41790000001","0041790000001"]) {
      const html=renderToStaticMarkup(<UiLocaleProvider locale={locale} contentOnly><PhoneInput name="phoneE164" countries={["CH"]} swissOnly defaultValue={value}/></UiLocaleProvider>);
      expect(html).not.toContain('<select');
      expect(html).toContain('name="phoneE164" value="+41790000001"');
      const copy=renderToStaticMarkup(<span>{accountPhoneMessages[locale].swissPhoneHelp}</span>).slice(6,-7);
      expect(html).toContain(copy);
    }
    const foreign=renderToStaticMarkup(<UiLocaleProvider locale={locale} contentOnly><PhoneInput countries={["CH"]} swissOnly defaultValue="+380671234567"/></UiLocaleProvider>);
    expect(foreign).toContain('aria-invalid="true"'); expect(foreign).not.toContain('<select');
    const error=new ApiError("SWISS_PHONE_REQUIRED",403);
    expect(getAuthErrorMessage(error,locale)).toBe(accountPhoneMessages[locale].swissPhoneRequired);
    expect(getAccountContactChangeErrorMessage(error,locale,"phone")).toBe(accountPhoneMessages[locale].swissPhoneRequired);
  });
  it("restores country selection with the restriction disabled",()=>{
    const html=renderToStaticMarkup(<PhoneInput countries={["CH","UA"]} swissOnly={false} defaultValue="+380671234567"/>);
    expect(html).toContain('<select'); expect(html).toContain('value="UA" selected=""');
    expect(html).not.toContain('aria-invalid="true"');
  });
});
