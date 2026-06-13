export const settingsSections = [
	{
		slug: "preferences",
		label: "Preferences",
		icon: "sliders-horizontal",
		path: "/settings/preferences",
	},
	{ slug: "account", label: "Account", icon: "user", path: "/settings/account" },
] as const;

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionSlug = SettingsSection["slug"];

const matchesSection = (pathname: string, section: SettingsSection) =>
	pathname === section.path || pathname.startsWith(`${section.path}/`);

export const activeSettingsSection = (pathname: string): SettingsSectionSlug | null =>
	settingsSections.find((section) => matchesSection(pathname, section))?.slug ?? null;
