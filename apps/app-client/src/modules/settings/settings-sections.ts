export const settingsSections = [
	{ slug: "general", label: "General", href: "/settings/general", icon: "sliders-horizontal" },
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
	{ icon: "user", slug: "account", label: "Account", href: "/settings/account" },
] as const;

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionSlug = SettingsSection["slug"];

const matchesSettingsSection = (pathname: string, href: string) =>
	pathname.endsWith(href) || pathname.includes(`${href}/`);

export function getActiveSettingsSection(pathname: string): SettingsSectionSlug {
	const section = settingsSections.find((item) => matchesSettingsSection(pathname, item.href));
	return section?.slug ?? "general";
}
