"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin-plan-reviews.module.css";

export function AdminSafetyNavigation() {
  const path = usePathname(), recipients = path.startsWith("/admin/safety/recipients");
  return <nav aria-label="Safety sections" className={styles.nav}>
    <Link href="/admin/safety" aria-current={recipients ? undefined : "page"}>Plan review</Link>
    <Link href="/admin/safety/recipients" aria-current={recipients ? "page" : undefined}>Recipient restrictions</Link>
  </nav>;
}
