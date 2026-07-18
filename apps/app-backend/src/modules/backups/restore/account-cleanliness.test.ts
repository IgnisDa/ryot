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
		[
			"plugin-state",
			{
				pluginState: [
					{
						config: {},
						sortOrder: 0,
						id: "state-id",
						isDisabled: false,
						pluginSlug: "media",
						createdAt: new Date(0),
						updatedAt: new Date(0),
						userId: UserId.make("user-id"),
					},
				],
			},
		],
		["integrations", { hasIntegrations: true }],
		["notification-channels", { hasNotificationChannels: true }],
	] as const)("rejects %s", (category, override) => {
		expect(classifyAccountCleanliness(cleanState(override))).toBe(category);
	});
});
