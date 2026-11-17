import { kernelMessage } from "@ryot-app/kernel-messages/message";

import { ASSISTANT_NAME } from "#/modules/assistant/presentation";

export const settingsGroups = [
	{
		label: kernelMessage("client.settings.group.you"),
		sections: [
			{
				slug: "preferences",
				icon: "sliders-horizontal",
				path: "/settings/preferences",
				label: kernelMessage("client.settings.section.preferences"),
			},
			{
				icon: "puzzle",
				slug: "plugin-preferences",
				path: "/settings/plugin-preferences",
				label: kernelMessage("client.settings.section.plugin-preferences"),
			},
			{
				icon: "box",
				slug: "plugins",
				path: "/settings/plugins",
				label: kernelMessage("client.settings.section.plugins"),
			},
			{
				icon: "user",
				slug: "account",
				path: "/settings/account",
				label: kernelMessage("client.settings.section.account"),
			},
			{
				icon: "clock",
				slug: "reminders",
				path: "/settings/reminders",
				label: kernelMessage("client.settings.section.reminders"),
			},
		],
	},
	{
		label: kernelMessage("client.settings.group.connections"),
		sections: [
			{
				slug: "assistant",
				icon: "message-circle",
				path: "/settings/assistant",
				label: kernelMessage("client.settings.section.assistant", { name: ASSISTANT_NAME }),
			},
			{
				icon: "globe",
				slug: "integrations",
				path: "/settings/integrations",
				label: kernelMessage("client.settings.section.integrations"),
			},
			{
				icon: "inbox",
				slug: "notification-channels",
				path: "/settings/notification-channels",
				label: kernelMessage("client.settings.section.notification-channels"),
			},
			{
				slug: "access",
				icon: "key-round",
				path: "/settings/access",
				label: kernelMessage("client.settings.section.access"),
			},
		],
	},
	{
		label: kernelMessage("client.settings.group.data"),
		sections: [
			{
				slug: "import-data",
				icon: "clipboard-list",
				path: "/settings/import-data",
				label: kernelMessage("client.settings.section.import-data"),
			},
			{
				icon: "archive",
				slug: "backups",
				path: "/settings/backups",
				label: kernelMessage("client.settings.section.backups"),
			},
			{
				slug: "pages",
				icon: "file-text",
				path: "/settings/pages",
				label: kernelMessage("client.settings.section.pages"),
			},
			{
				icon: "link",
				slug: "publications",
				path: "/settings/publications",
				label: kernelMessage("client.settings.section.publications"),
			},
		],
	},
	{
		label: kernelMessage("client.settings.group.server"),
		sections: [
			{
				icon: "crown",
				slug: "administration",
				path: "/settings/administration",
				label: kernelMessage("client.settings.section.administration"),
			},
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

export const activeSettingsSection = (pathname: string): null | SettingsSectionSlug =>
	settingsSections.find((section) => matchesSection(pathname, section))?.slug ?? null;
