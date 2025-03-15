import type { AuthClient } from "#/lib/auth";

type SidebarApiKeyListResponse = Awaited<
	ReturnType<AuthClient["apiKey"]["list"]>
>;
type SidebarApiKeyCreateResponse = Awaited<
	ReturnType<AuthClient["apiKey"]["create"]>
>;

export type SidebarApiKey = SidebarApiKeyList["apiKeys"][number];
export type SidebarApiKeyList = NonNullable<SidebarApiKeyListResponse["data"]>;
export type SidebarCreatedApiKey = NonNullable<
	SidebarApiKeyCreateResponse["data"]
>;

export function getSidebarApiKeyDisplayName(key: Pick<SidebarApiKey, "name">) {
	const name = key.name?.trim();
	return name ? name : "Untitled key";
}

export function getSidebarApiKeyHint(
	key: Pick<SidebarApiKey, "id" | "start" | "prefix">,
) {
	const start = key.start?.trim();
	if (start) {
		return start;
	}

	const prefix = key.prefix?.trim();
	if (prefix) {
		return `${prefix}...`;
	}

	return key.id;
}

export function getSidebarApiKeyDetails(
	key: Pick<
		SidebarApiKey,
		"createdAt" | "lastRequest" | "id" | "start" | "prefix"
	>,
) {
	return [
		{ label: null, value: getSidebarApiKeyHint(key) },
		{ label: "Created", value: formatSidebarApiKeyDate(key.createdAt) },
		{
			label: "Last used",
			value: formatSidebarApiKeyDate(key.lastRequest, "Unused"),
		},
	];
}

export function formatSidebarApiKeyDate(
	value?: Date | string | null,
	fallback = "--",
) {
	if (!value) {
		return fallback;
	}

	const parsed = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return fallback;
	}

	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(parsed);
}
