import type { ReactNode } from "react";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";
import { UiLocaleProvider } from "@/components/ui-locale-provider";

export default function AdminPreviewLayout({ children }: { children: ReactNode }) {
  return (
    <AdminRouteBoundary scope="content">
      <UiLocaleProvider locale="en">{children}</UiLocaleProvider>
    </AdminRouteBoundary>
  );
}
