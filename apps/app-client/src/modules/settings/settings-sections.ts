import { activeSectionSlug, type SectionNavItem } from "@/modules/ui/sections";

export const settingsSections = [
	{
		slug: "preferences",
		label: "Preferences",
		icon: "sliders-horizontal",
		href: "/settings/preferences",
	},
	{ icon: "globe", slug: "integrations", label: "Integrations", href: "/settings/integrations" },
	{
		icon: "inbox",
		slug: "notification-channels",
		label: "Notification channels",
		href: "/settings/notification-channels",
	},
	{
		slug: "import-data",
		label: "Import data",
		icon: "clipboard-list",
		href: "/settings/import-data",
	},
	{ icon: "archive", slug: "backups", label: "Backups", href: "/settings/backups" },
	{ icon: "user", slug: "account", label: "Account", href: "/settings/account" },
] as const satisfies readonly SectionNavItem[];

export type SettingsSectionSlug = (typeof settingsSections)[number]["slug"];

export const getActiveSettingsSection = (pathname: string): SettingsSectionSlug =>
	activeSectionSlug(pathname, settingsSections, "preferences");
