import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calendario Entrevistas | TCi",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
