import type {
	ListedIntegration,
	ListedIntegrationProvider,
} from "@ryot/contract/modules/integrations/schemas";
import { IntegrationId, PluginSlug } from "@ryot/contract/schema/brands";
import { integrationsRecipe, type IntegrationSummary } from "@ryot/ryotql-recipes/integrations";
import { rowsResult } from "@ryot/ryotql-recipes/test-utils";
import { Result } from "effect";

const described = (label: string) => ({ label, description: label });

export const commonSchema = {
	fields: {
		name: { ...described("Name"), type: "string" },
		isDisabled: { ...described("Disabled"), type: "boolean", defaultValue: false },
		syncOwnership: { ...described("Sync ownership"), type: "boolean", defaultValue: false },
		disableOnContinuousErrors: {
			...described("Disable on continuous errors"),
			type: "boolean",
			defaultValue: false,
		},
		minimumProgress: {
			...described("Minimum progress"),
			type: "number",
			defaultValue: 2,
			validation: { minimum: 0, maximum: 100 },
		},
		maximumProgress: {
			...described("Maximum progress"),
			type: "number",
			defaultValue: 95,
			validation: { minimum: 0, maximum: 100 },
		},
	},
} satisfies ListedIntegrationProvider["commonSchema"];

export const yankProvider: ListedIntegrationProvider = {
	lot: "yank",
	commonSchema,
	slug: "komga",
	name: "Komga",
	pluginSlug: "media",
	isCreatable: true,
	description: "Import progress and ownership from Komga",
	settingsSchema: {
		fields: {
			baseUrl: { ...described("Base URL"), type: "string", validation: { required: true } },
			tagIds: {
				...described("Tag IDs"),
				type: "array",
				items: { ...described("Tag ID"), type: "string" },
			},
			apiKey: {
				...described("API key"),
				type: "string",
				secret: true,
				validation: { required: true },
			},
			kind: {
				...described("Provider kind"),
				type: "enum",
				defaultValue: "komga",
				validation: { required: true },
				choices: { kind: "static", values: [{ value: "komga" }] },
			},
		},
	},
};

export const sinkProvider: ListedIntegrationProvider = {
	lot: "sink",
	slug: "kodi",
	name: "Kodi",
	isCreatable: true,
	pluginSlug: "media",
	settingsSchema: { fields: {} },
	description: "Receive Kodi playback webhooks",
	commonSchema: {
		fields: Object.fromEntries(
			Object.entries(commonSchema.fields).filter(([key]) => key !== "syncOwnership"),
		),
	},
};

export const unavailableProvider: ListedIntegrationProvider = {
	...sinkProvider,
	slug: "emby",
	name: "Emby",
	isCreatable: false,
	description: "Receive Emby playback webhooks",
};

export const makeIntegrationSummary = (
	overrides: Partial<IntegrationSummary> = {},
): IntegrationSummary => ({
	name: null,
	lot: "yank",
	provider: "komga",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	lastFinishedAt: null,
	syncOwnership: false,
	id: IntegrationId.make("int_1"),
	createdAt: "2026-08-20T10:00:00.000Z",
	updatedAt: "2026-08-20T10:00:00.000Z",
	pluginSlug: PluginSlug.make("media"),
	extraSettings: { disableOnContinuousErrors: false },
	...overrides,
});

export const makeListedIntegration = (
	overrides: Partial<ListedIntegration> = {},
): ListedIntegration => ({
	...makeIntegrationSummary(),
	providerSpecifics: { kind: "komga", baseUrl: "https://komga.example" },
	...overrides,
});

const INTEGRATIONS_LIMIT = 20;

/** Decoded through the real recipe so the fixture cannot drift from the wire shape. */
export const decodeIntegrationList = (
	input: {
		readonly hasMore?: boolean;
		readonly integrations?: readonly unknown[];
	} = {},
) =>
	Result.getOrThrow(
		integrationsRecipe({ limit: INTEGRATIONS_LIMIT }).decode({
			data: {
				integrations: rowsResult(input.integrations ?? [makeIntegrationSummary()], {
					limit: INTEGRATIONS_LIMIT,
					hasMore: input.hasMore ?? false,
					nextCursor: input.hasMore === true ? "next" : null,
				}),
			},
		}),
	);
