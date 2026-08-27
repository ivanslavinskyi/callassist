import type { ReactNode } from "react";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";

export default function ContentAdminLayout({ children }: {
  children: ReactNode;
}) {
  return (
    <AdminRouteBoundary scope="content">
      {children}
    </AdminRouteBoundary>
  );
}
