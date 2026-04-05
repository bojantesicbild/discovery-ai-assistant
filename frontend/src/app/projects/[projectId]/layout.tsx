"use client";

import ProjectShell from "@/components/ProjectShell";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <ProjectShell>{children}</ProjectShell>;
}
