import type { ReactNode } from "react";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";

export default function SeoAdminLayout({ children }: {
  children: ReactNode;
}) {
  return <AdminRouteBoundary scope="content">{children}</AdminRouteBoundary>;
}
