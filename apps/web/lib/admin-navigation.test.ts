import { describe, expect, it } from "vitest";
import {
  adminNavigationForRole,
  isAdminNavigationItemActive
} from "./admin-navigation";

describe("admin navigation", () => {
  it("shows content-only navigation to content editors", () => {
    expect(adminNavigationForRole("content_editor").flatMap(({ items }) =>
      items.map(({ href }) => href)
    )).toEqual([
      "/admin/content",
      "/admin/content/editorial",
      "/admin/seo"
    ]);
  });

  it("shows operational and content navigation to administrators", () => {
    const hrefs = adminNavigationForRole("admin").flatMap(({ items }) =>
      items.map(({ href }) => href)
    );
    expect(hrefs).toContain("/admin");
    expect(hrefs).toContain("/admin/system");
    expect(hrefs).toContain("/admin/content");
  });

  it("does not expose an admin navigation group to customer roles", () => {
    expect(adminNavigationForRole("user")).toEqual([]);
    expect(adminNavigationForRole("support")).toEqual([]);
  });

  it("matches only the overview exactly and nested section routes by prefix", () => {
    expect(isAdminNavigationItemActive("/admin/calls/abc", "/admin")).toBe(false);
    expect(isAdminNavigationItemActive("/admin/calls/abc", "/admin/calls")).toBe(true);
  });
});
