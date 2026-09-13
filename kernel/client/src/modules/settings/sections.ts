export const settingsGroups = [
	{
		label: "You",
		sections: [
			{
				slug: "preferences",
				label: "Preferences",
				icon: "sliders-horizontal",
				path: "/settings/preferences",
			},
			{
				icon: "puzzle",
				slug: "plugin-preferences",
				label: "Plugin preferences",
				path: "/settings/plugin-preferences",
			},
			{ icon: "user", slug: "account", label: "Account", path: "/settings/account" },
		],
	},
	{
		label: "Connections",
		sections: [
			{
				icon: "globe",
				slug: "integrations",
				label: "Integrations",
				path: "/settings/integrations",
			},
			{
				icon: "inbox",
				slug: "notification-channels",
				label: "Notification channels",
				path: "/settings/notification-channels",
			},
		],
	},
	{
		label: "Data",
		sections: [
			{
				slug: "import-data",
				label: "Import data",
				icon: "clipboard-list",
				path: "/settings/import-data",
			},
			{ icon: "archive", slug: "backups", label: "Backups", path: "/settings/backups" },
			{
				icon: "clock",
				slug: "automation-history",
				label: "Automation history",
				path: "/settings/automation-history",
			},
		],
	},
	{
		label: "Server",
		sections: [
			{
				icon: "crown",
				slug: "administration",
				label: "Administration",
				path: "/settings/administration",
			},
			{ icon: "info", slug: "about", label: "About", path: "/settings/about" },
		],
	},
] as const;

export type SettingsSection = (typeof settingsGroups)[number]["sections"][number];

const settingsSections = settingsGroups.flatMap(
	(group): readonly SettingsSection[] => group.sections,
);
export type SettingsSectionSlug = SettingsSection["slug"];

const matchesSection = (pathname: string, section: SettingsSection) =>
	pathname === section.path || pathname.startsWith(`${section.path}/`);

export const activeSettingsSection = (pathname: string): SettingsSectionSlug | null =>
	settingsSections.find((section) => matchesSection(pathname, section))?.slug ?? null;
