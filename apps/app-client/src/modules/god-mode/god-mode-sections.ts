import type { SectionNavItem } from "@/modules/ui/sections";

export const godModeSections = [
	{ icon: "users", slug: "users", label: "Users", href: "/god-mode/users" },
] as const satisfies readonly SectionNavItem[];
