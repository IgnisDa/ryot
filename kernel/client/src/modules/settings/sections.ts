export const settingsSections = [
	{
		slug: "preferences",
		label: "Preferences",
		icon: "sliders-horizontal",
		path: "/settings/preferences",
	},
	{ icon: "globe", slug: "integrations", label: "Integrations", path: "/settings/integrations" },
	{
		icon: "inbox",
		slug: "notification-channels",
		label: "Notification channels",
		path: "/settings/notification-channels",
	},
	{
		slug: "import-data",
		label: "Import data",
		icon: "clipboard-list",
		path: "/settings/import-data",
	},
	{
		icon: "clock",
		slug: "automation-history",
		label: "Automation history",
		path: "/settings/automation-history",
	},
	{ icon: "archive", slug: "backups", label: "Backups", path: "/settings/backups" },
	{ icon: "user", slug: "account", label: "Account", path: "/settings/account" },
] as const;

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionSlug = SettingsSection["slug"];

const matchesSection = (pathname: string, section: SettingsSection) =>
	pathname === section.path || pathname.startsWith(`${section.path}/`);

export const activeSettingsSection = (pathname: string): SettingsSectionSlug | null =>
	settingsSections.find((section) => matchesSection(pathname, section))?.slug ?? null;
