import type { ReactNode } from "react";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";

export default function AdminSystemLayout({ children }: {
  children: ReactNode;
}) {
  return (
    <AdminRouteBoundary scope="operations">
      {children}
    </AdminRouteBoundary>
  );
}
