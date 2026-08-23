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
		icon: "clipboard-list",
		slug: "import-data",
		label: "Import data",
		path: "/settings/import-data",
	},
	{ icon: "archive", slug: "backups", label: "Backups", path: "/settings/backups" },
	{ slug: "account", label: "Account", icon: "user", path: "/settings/account" },
] as const;

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionSlug = SettingsSection["slug"];

const matchesSection = (pathname: string, section: SettingsSection) =>
	pathname === section.path || pathname.startsWith(`${section.path}/`);

export const activeSettingsSection = (pathname: string): SettingsSectionSlug | null =>
	settingsSections.find((section) => matchesSection(pathname, section))?.slug ?? null;
