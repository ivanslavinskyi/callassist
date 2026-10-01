import type { ReactNode } from "react";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";
import { AdminSafetyNavigation } from "@/components/admin-safety-navigation";

export default function SafetyAdminLayout({ children }: {
  children: ReactNode;
}) {
  return <AdminRouteBoundary scope="operations"><AdminSafetyNavigation/>{children}</AdminRouteBoundary>;
}
