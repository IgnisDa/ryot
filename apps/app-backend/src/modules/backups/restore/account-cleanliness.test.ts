import { defaultUserPreferences } from "@ryot/contract/auth-middleware";
import {
	AutomationRuleId,
	EntitySchemaSlug,
	SignalSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { type AccountCleanlinessState, classifyAccountCleanliness } from "./account-cleanliness";

const library = {
	provider: null,
	properties: {},
	name: "Library",
	externalId: null,
	populatedAt: null,
	entitySchemaSlug: EntitySchemaSlug.make("library"),
};

const systemInstallation = (
	overrides: Partial<AccountCleanlinessState["pluginState"][number]> = {},
) =>
	({
		config: {},
		sortOrder: 0,
		id: "state-id",
		health: "ready",
		isDisabled: false,
		healthReason: null,
		pluginSlug: "media",
		pluginScope: "system",
		pluginId: "media-plugin-id",
		createdAt: new Date(0),
		updatedAt: new Date(0),
		userId: UserId.make("user-id"),
		...overrides,
	}) as const;

const cleanState = (overrides: Partial<AccountCleanlinessState> = {}): AccountCleanlinessState => ({
	savedViews: [],
	pluginState: [],
	hasEvents: false,
	relationships: [],
	expectedSavedViews: [],
	hasIntegrations: false,
	hasManagedAssets: false,
	notificationSubscriptions: [],
	hasNotificationChannels: false,
	expectedBootstrapRelationships: [],
	expectedBootstrapEntities: [library],
	expectedNotificationSubscriptionSlugs: [],
	defaultPreferences: { ...defaultUserPreferences },
	profile: { name: "User", image: null, preferences: { ...defaultUserPreferences } },
	entities: [{ ...library, id: "library-id", createdAt: new Date(0), updatedAt: new Date(0) }],
	...overrides,
});

describe("classifyAccountCleanliness", () => {
	it("accepts the exact bootstrap account", () => {
		expect(classifyAccountCleanliness(cleanState())).toBeNull();
	});

	it("accepts an account holding only default system installations", () => {
		expect(
			classifyAccountCleanliness(
				cleanState({
					pluginState: [
						systemInstallation(),
						systemInstallation({ pluginSlug: "fitness", pluginId: "fitness-plugin-id" }),
						systemInstallation({
							health: "installing",
							pluginSlug: "shipped",
							pluginId: "shipped-plugin-id",
						}),
					],
				}),
			),
		).toBeNull();
	});

	it.each([
		["preferences", { profile: { name: "User", image: null, preferences: { allowNsfw: true } } }],
		["events", { hasEvents: true }],
		["managed-assets", { hasManagedAssets: true }],
		[
			"relationships",
			{
				relationships: [
					{
						properties: {},
						sourceEntityId: "source",
						targetEntityId: "target",
						relationshipSchemaSlug: "member-of",
					},
				],
			},
		],
		[
			"entities",
			{
				entities: [
					{ ...library, id: "library-id", createdAt: new Date(0), updatedAt: new Date(0) },
					{
						name: "Extra",
						id: "extra-id",
						provider: null,
						properties: {},
						externalId: null,
						populatedAt: null,
						createdAt: new Date(0),
						updatedAt: new Date(0),
						entitySchemaSlug: EntitySchemaSlug.make("collection"),
					},
				],
			},
		],
		[
			"saved-views",
			{
				savedViews: [
					{
						icon: "x",
						layouts: {},
						sortOrder: 0,
						slug: "custom",
						name: "Custom",
						pluginSlug: null,
						isBuiltin: false,
						isDisabled: false,
						entitySchemaSlug: null,
					},
				],
			},
		],
		[
			"notification-subscriptions",
			{
				notificationSubscriptions: [
					{
						metadata: null,
						isActive: false,
						userId: UserId.make("user-id"),
						createdAt: new Date(0).toISOString(),
						updatedAt: new Date(0).toISOString(),
						id: AutomationRuleId.make("rule-id"),
						signalSchemaSlug: SignalSchemaSlug.make("signal"),
					},
				],
			},
		],
		["plugin-state", { pluginState: [systemInstallation({ isDisabled: true })] }],
		["plugin-state", { pluginState: [systemInstallation({ sortOrder: 3 })] }],
		["plugin-state", { pluginState: [systemInstallation({ config: { unit: "minutes" } })] }],
		["plugin-state", { pluginState: [systemInstallation({ health: "needs-configuration" })] }],
		[
			"plugin-state",
			{ pluginState: [systemInstallation({ pluginScope: "user", pluginSlug: "private" })] },
		],
		["integrations", { hasIntegrations: true }],
		["notification-channels", { hasNotificationChannels: true }],
	] as const)("rejects %s", (category, override) => {
		expect(classifyAccountCleanliness(cleanState(override))).toBe(category);
	});
});
