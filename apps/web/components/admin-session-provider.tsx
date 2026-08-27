"use client";

import type { User } from "@callassist/contracts";
import { createContext, useContext, type ReactNode } from "react";

const AdminSessionContext = createContext<User | null>(null);

export function AdminSessionProvider({
  children,
  user
}: {
  children: ReactNode;
  user: User;
}) {
  return (
    <AdminSessionContext.Provider value={user}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  const user = useContext(AdminSessionContext);
  if (!user) {
    throw new Error("useAdminSession must be used inside AdminSessionProvider");
  }
  return user;
}

