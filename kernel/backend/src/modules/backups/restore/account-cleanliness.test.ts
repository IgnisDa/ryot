import { defaultUserPreferences } from "@ryot-app/contract/auth-middleware";
import {
	AutomationRuleId,
	EntitySchemaSlug,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { type AccountCleanlinessState, classifyAccountCleanliness } from "./account-cleanliness";

const bootstrapEntity = (id = "bootstrap-id") => ({
	id,
	provider: null,
	properties: {},
	externalId: null,
	populatedAt: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	name: "Bootstrap entity",
	entitySchemaPluginId: null,
	origin: { kind: "bootstrap" as const },
	entitySchemaSlug: EntitySchemaSlug.make("bootstrap-entity"),
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
		homeSavedViewId: null,
		pluginSlug: "example",
		pluginScope: "system",
		createdAt: new Date(0),
		updatedAt: new Date(0),
		pluginId: "example-plugin-id",
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
	entities: [bootstrapEntity()],
	notificationSubscriptions: [],
	hasNotificationChannels: false,
	expectedBootstrapRelationships: [],
	expectedNotificationSubscriptionSlugs: [],
	defaultPreferences: { ...defaultUserPreferences },
	profile: { image: null, name: "User", preferences: { ...defaultUserPreferences } },
	...overrides,
});

describe("classifyAccountCleanliness", () => {
	it("accepts an account with bootstrap-origin entities", () => {
		expect(classifyAccountCleanliness(cleanState())).toBeNull();
	});

	it.each([
		["zero", []],
		["one", [bootstrapEntity("one")]],
		["multiple", [bootstrapEntity("one"), bootstrapEntity("two")]],
	] as const)("accepts zero, one, or multiple bootstrap-origin entities", (_name, entities) => {
		expect(classifyAccountCleanliness(cleanState({ entities }))).toBeNull();
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
		[
			"entities",
			{
				entities: [
					{ ...bootstrapEntity() },
					{
						name: "Extra",
						id: "extra-id",
						provider: null,
						properties: {},
						externalId: null,
						populatedAt: null,
						createdAt: new Date(0),
						updatedAt: new Date(0),
						origin: { kind: "api" },
						entitySchemaPluginId: null,
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

	it.each([
		["null", null],
		["non-bootstrap", { kind: "api" as const }],
	] as const)("rejects %s entity origins", (_name, origin) => {
		expect(
			classifyAccountCleanliness(cleanState({ entities: [{ ...bootstrapEntity(), origin }] })),
		).toBe("entities");
	});
});
