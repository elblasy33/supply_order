import { cookies } from "next/headers";
import { logout } from "@/app/actions/auth";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const collapsed = (await cookies()).get("sidebar")?.value === "collapsed";
  return (
    <Shell user={{ name: user.name, roleName: user.roleName }} permissions={[...user.permissions]} logoutAction={logout} defaultCollapsed={collapsed}>
      {children}
    </Shell>
  );
}
