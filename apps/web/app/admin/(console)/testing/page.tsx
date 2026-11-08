import { redirect } from "next/navigation";
import { AdminTestingConsole } from "@/components/admin-testing-console";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";
import { getServerCurrentUser } from "@/lib/server-auth";
export const metadata={title:"SHPROHLI test scenarios",robots:{index:false,follow:false}};
export default async function TestingPage(){
  if((await getServerCurrentUser())?.role!=="superadmin") redirect("/admin");
  return <AdminRouteBoundary scope="operations"><AdminTestingConsole/></AdminRouteBoundary>;
}
