import type { UserRole } from "@callassist/contracts";

export type AdminNavigationItem = {
  href: string;
  label: string;
  roles: readonly UserRole[];
};

export type AdminNavigationGroup = {
  label: string;
  items: readonly AdminNavigationItem[];
};

const operationalRoles = ["admin", "superadmin"] as const satisfies readonly UserRole[];
const contentRoles = ["content_editor", "admin", "superadmin"] as const satisfies readonly UserRole[];

export const adminNavigation: readonly AdminNavigationGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Overview", roles: operationalRoles },
      { href: "/admin/calls", label: "Calls", roles: operationalRoles },
      { href: "/admin/users", label: "Users", roles: operationalRoles },
      { href: "/admin/credits", label: "Credits", roles: operationalRoles },
      { href: "/admin/safety", label: "Safety", roles: operationalRoles },
      { href: "/admin/system", label: "System", roles: operationalRoles }
    ]
  },
  {
    label: "Content",
    items: [
      { href: "/admin/content", label: "Pages", roles: contentRoles },
      {
        href: "/admin/content/editorial",
        label: "Editorial",
        roles: contentRoles
      },
      { href: "/admin/seo", label: "SEO", roles: contentRoles }
    ]
  }
];

export function adminNavigationForRole(role: UserRole) {
  return adminNavigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.roles.includes(role))
    }))
    .filter((group) => group.items.length > 0);
}

export function isAdminNavigationItemActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

