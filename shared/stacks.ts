// The stack picker's list: tools a project can use, their docs sites (allowed for web fetches) and
// the official agent skills each vendor publishes on GitHub. Only vendors' own repos; a tool with
// no official skill just gets its docs sites. Checked 2026-11-21.

export interface SkillSource {
  repo: string; // "owner/name" on GitHub, published by the tool's own team
  paths: string[]; // skill folders inside the repo (each has a SKILL.md)
}

export interface StackTool {
  id: string;
  label: string;
  docs: string[]; // domains agents may fetch without asking
  skills?: SkillSource;
}

export const STACK: StackTool[] = [
  { id: "nextjs", label: "Next.js", docs: ["nextjs.org", "vercel.com"], skills: { repo: "vercel-labs/agent-skills", paths: ["skills/react-best-practices"] } },
  { id: "react", label: "React", docs: ["react.dev"], skills: { repo: "vercel-labs/agent-skills", paths: ["skills/react-best-practices", "skills/composition-patterns"] } },
  { id: "tailwind", label: "Tailwind CSS", docs: ["tailwindcss.com"] },
  { id: "node", label: "Node.js", docs: ["nodejs.org"] },
  { id: "fastapi", label: "Python + FastAPI", docs: ["fastapi.tiangolo.com", "docs.python.org"] },
  { id: "postgres", label: "Postgres", docs: ["www.postgresql.org"] },
  { id: "prisma", label: "Prisma", docs: ["www.prisma.io"], skills: { repo: "prisma/skills", paths: ["prisma-client-api", "prisma-cli", "prisma-database-setup"] } },
  { id: "clerk", label: "Clerk", docs: ["clerk.com"], skills: { repo: "clerk/skills", paths: ["skills/clerk", "skills/clerk-setup", "skills/clerk-nextjs-patterns"] } },
  { id: "stripe", label: "Stripe", docs: ["docs.stripe.com", "stripe.com"], skills: { repo: "stripe/ai", paths: ["skills/stripe-best-practices"] } },
  { id: "supabase", label: "Supabase", docs: ["supabase.com"], skills: { repo: "supabase/agent-skills", paths: ["skills/supabase", "skills/supabase-postgres-best-practices"] } },
  { id: "docker", label: "Docker", docs: ["docs.docker.com"], skills: { repo: "docker/skills", paths: ["skills/docker-build-strategies", "skills/docker-compose-patterns"] } },
];

export const stackTool = (id: string) => STACK.find((t) => t.id === id);

export interface StackPlan {
  /** Each skill once, even when two tools share it. `name` is the folder it is installed as. */
  skills: { repo: string; path: string; name: string }[];
  domains: string[];
}

/** What a set of ticked tools installs: their skills (no duplicates) and docs domains (sorted). */
export function stackPlan(ids: string[]): StackPlan {
  const skills: StackPlan["skills"] = [];
  const domains = new Set<string>();
  for (const id of ids) {
    const t = stackTool(id);
    if (!t) continue;
    for (const d of t.docs) domains.add(d);
    for (const path of t.skills?.paths ?? []) {
      const name = path.split("/").pop()!;
      if (!skills.some((s) => s.name === name)) skills.push({ repo: t.skills!.repo, path, name });
    }
  }
  return { skills, domains: [...domains].sort() };
}
