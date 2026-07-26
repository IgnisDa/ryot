import type { SectionNavItem } from "@/modules/ui/sections";

export const godModeSections = [
	{ icon: "users", slug: "users", label: "Users", href: "/god-mode/users" },
	{
		icon: "clipboard-list",
		slug: "migration-report",
		label: "Migration Report",
		href: "/god-mode/migration-report",
	},
] as const satisfies readonly SectionNavItem[];
