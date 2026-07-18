import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard Candidatos | TCi",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
