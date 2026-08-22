import { defaultUserPreferences } from "@ryot-app/contract/auth-middleware";
import {
	EntitySchemaSlug,
	NotificationSubscriptionId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { type AccountCleanlinessState, classifyAccountCleanliness } from "./account-cleanliness";

const entity = (id = "entity-id") => ({
	id,
	provider: null,
	properties: {},
	name: "Entity",
	externalId: null,
	populatedAt: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	entitySchemaPluginId: null,
	entitySchemaSlug: EntitySchemaSlug.make("entity"),
});

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
		uninstalledAt: null,
		homeSavedViewId: null,
		pluginSlug: "example",
		pluginScope: "system",
		createdAt: new Date(0),
		updatedAt: new Date(0),
		activeConfigRevisionId: null,
		pluginId: "example-plugin-id",
		userId: UserId.make("user-id"),
		...overrides,
	}) as const;

const cleanState = (overrides: Partial<AccountCleanlinessState> = {}): AccountCleanlinessState => ({
	entities: [],
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
	expectedNotificationSubscriptionSlugs: [],
	defaultPreferences: { ...defaultUserPreferences },
	profile: { image: null, name: "User", preferences: { ...defaultUserPreferences } },
	...overrides,
});

describe("classifyAccountCleanliness", () => {
	it("accepts an account without entities", () => {
		expect(classifyAccountCleanliness(cleanState())).toBeNull();
	});

	it("accepts one bootstrap-shaped entity per entity schema", () => {
		expect(
			classifyAccountCleanliness(
				cleanState({
					entities: [
						entity(),
						{ ...entity("library-id"), entitySchemaSlug: EntitySchemaSlug.make("library") },
					],
				}),
			),
		).toBeNull();
	});

	it("accepts an account holding only default system installations", () => {
		expect(
			classifyAccountCleanliness(
				cleanState({
					pluginState: [
						systemInstallation(),
						systemInstallation({ pluginSlug: "sample", pluginId: "sample-plugin-id" }),
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
		["preferences", { profile: { image: null, name: "User", preferences: { allowNsfw: true } } }],
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
		["entities", { entities: [entity(), entity("duplicate-schema-id")] }],
		["entities", { entities: [{ ...entity(), externalId: "external" }] }],
		[
			"entities",
			{
				entities: [
					{
						...entity(),
						provider: { pluginId: "plugin", pluginSlug: "media", providerSlug: "movie.tmdb" },
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
						settings: {},
						sortOrder: 0,
						slug: "custom",
						name: "Custom",
						pluginSlug: null,
						isBuiltin: false,
						dataSources: null,
						isDisabled: false,
						pluginInstallationId: null,
						entitySchemaPluginId: null,
						renderer: { kind: "kernel", name: "results-table" },
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
						signalSchemaPluginId: null,
						userId: UserId.make("user-id"),
						createdAt: new Date(0).toISOString(),
						updatedAt: new Date(0).toISOString(),
						id: NotificationSubscriptionId.make("rule-id"),
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
