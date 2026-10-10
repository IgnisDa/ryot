import { layer } from "@effect/vitest";
import {
	EntitySchemaSlug,
	NotificationSubscriptionId,
	PluginId,
	SavedViewId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { column, document, field, pluginId, rows, table } from "@ryot-app/ryotql";
import { Effect, Layer } from "effect";
import { assert, describe, expect, it } from "vitest";

import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { SavedViewDefinition } from "#modules/definition-registry/snapshot";
import { materializeSavedView } from "#modules/definition-registry/source";
import { seedKernelDefinitions } from "#modules/definition-registry/test-support";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import { SavedViewsRepository } from "#modules/saved-views/repository";

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
		isHidden: false,
		userSettings: {},
		healthReason: null,
		isInitialized: true,
		uninstalledAt: null,
		homeSavedView: null,
		pluginScope: "system",
		createdAt: new Date(0),
		updatedAt: new Date(0),
		incompatibilityReason: null,
		activeConfigRevisionId: null,
		pluginId: "example-plugin-id",
		userId: UserId.make("user-id"),
		packageId: testPluginPackageId(),
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
	expectedNotificationSubscriptions: [],
	defaultPreferences: { ...defaultUserPreferences },
	profile: { image: null, name: "User", preferences: { ...defaultUserPreferences } },
	...overrides,
});

const query = table("entity", "entity");
const authoredQuery = (limit = 20) =>
	document({
		entities: rows(query, {
			limit,
			fields: [field("id", column(query, "id")), field("owner", pluginId({ kind: "self" }))],
		}),
	});

const authoredView = (limit = 20) => ({
	icon: "box",
	sortOrder: 0,
	settings: {},
	name: "Catalog",
	slug: "catalog",
	dataSources: authoredQuery(limit),
	renderer: { exportName: "catalog", kind: "plugin" as const },
});

const viewClient = {
	homeView: "catalog",
	apiVersion: 1 as const,
	exports: {
		catalog: {
			kind: "page" as const,
			entry: "client/catalog.tsx",
			settingsSchema: { fields: {} },
			automaticEntityPresentations: false,
		},
	},
};

const sourceView = (owner = "example-plugin-id", limit = 20) =>
	materializeSavedView(authoredView(limit), owner, viewClient);

const builtinView = (
	definition: SavedViewDefinition,
	installationId = "state-id",
): AccountCleanlinessState["savedViews"][number] => ({
	...definition,
	isHidden: false,
	isBuiltin: true,
	createdAt: null,
	updatedAt: null,
	id: SavedViewId.make(`builtin-${definition.pluginId}-${definition.slug}`),
	pluginInstallationId: definition.pluginId === null ? null : installationId,
	reference:
		definition.pluginId === null
			? { kind: "kernel", slug: definition.slug }
			: { kind: "plugin", slug: definition.slug, pluginId: PluginId.make(definition.pluginId) },
});

layer(SavedViewsRepository.layer.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
	test.effect("compares account defaults with its persisted installation-scoped definitions", () =>
		Effect.gen(function* () {
			const userId = UserId.make("recipient");
			const definitions = yield* DefinitionRepository;
			const savedViews = yield* SavedViewsRepository;
			const installations = yield* PluginInstallationRepository;
			yield* seedKernelDefinitions();
			const packageValue = revisionPackage("late-system");
			const installed = yield* installRevisionPackage({
				...packageValue,
				manifest: { ...packageValue.manifest, client: viewClient, savedViews: [authoredView()] },
			});
			const global = yield* definitions.getGlobalSnapshot;
			const account = yield* definitions.getUserSnapshot(userId, { listed: true });
			const actual = yield* savedViews.listForBackup(userId);
			expect(
				Object.values(global.savedViews)
					.map(({ slug }) => slug)
					.sort(),
			).toEqual(["catalog", "collections"]);
			expect(actual.map(({ reference }) => reference)).toEqual([
				{ kind: "kernel", slug: "collections" },
			]);
			expect(yield* installations.listHydratedForUser(userId)).toEqual([]);
			expect(
				classifyAccountCleanliness(
					cleanState({ savedViews: actual, expectedSavedViews: Object.values(global.savedViews) }),
				),
			).toBe("saved-views");
			expect(
				classifyAccountCleanliness(
					cleanState({ savedViews: actual, expectedSavedViews: Object.values(account.savedViews) }),
				),
			).toBeNull();
			yield* installations.provisionSystemInstallationsForUser(userId);
			const provisioned = yield* savedViews.listForBackup(userId);
			expect(provisioned).toContainEqual(
				expect.objectContaining({
					reference: { kind: "plugin", slug: "catalog", pluginId: installed.pluginId },
					renderer: { kind: "plugin", exportName: "catalog", pluginId: installed.pluginId },
				}),
			);
			expect(
				classifyAccountCleanliness(
					cleanState({
						savedViews: provisioned,
						pluginState: yield* installations.listHydratedForUser(userId),
						expectedSavedViews: Object.values(
							(yield* definitions.getUserSnapshot(userId, { listed: true })).savedViews,
						),
					}),
				),
			).toBeNull();
			const kernelView = kernelDefinitionSource().savedViews[0];
			assert(kernelView);
			yield* savedViews.create(userId, {
				...kernelView,
				userId,
				slug: "sentinel",
				name: "Destination must survive preflight",
			});
			expect(
				classifyAccountCleanliness(
					cleanState({
						savedViews: yield* savedViews.listForBackup(userId),
						pluginState: yield* installations.listHydratedForUser(userId),
						expectedSavedViews: Object.values(
							(yield* definitions.getUserSnapshot(userId, { listed: true })).savedViews,
						),
					}),
				),
			).toBe("saved-views");
		}),
	);
});

const subscription = (
	owner: string | null,
): AccountCleanlinessState["notificationSubscriptions"][number] => ({
	metadata: null,
	isActive: true,
	signalSchemaPluginId: owner,
	userId: UserId.make("user-id"),
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString(),
	signalSchemaSlug: SignalSchemaSlug.make("signal"),
	id: NotificationSubscriptionId.make(`subscription-${owner}`),
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
						{ ...entity("library-id"), entitySchemaSlug: EntitySchemaSlug.make("media-library") },
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
						systemInstallation({ pluginId: "sample-plugin-id" }),
						systemInstallation({ health: "installing", pluginId: "shipped-plugin-id" }),
					],
				}),
			),
		).toBeNull();
	});

	it("accepts separate bootstrap identities with the same local schema slug", () => {
		expect(
			classifyAccountCleanliness(
				cleanState({
					entities: [
						{ ...entity("first"), entitySchemaPluginId: "first-owner" },
						{ ...entity("second"), entitySchemaPluginId: "second-owner" },
					],
				}),
			),
		).toBeNull();
	});

	it("accepts materialized self queries and ignores display labels in owner identity", () => {
		const definition = sourceView();
		expect(
			classifyAccountCleanliness(
				cleanState({
					pluginState: [systemInstallation()],
					savedViews: [builtinView(definition)],
					expectedSavedViews: [{ ...definition, dataSources: authoredQuery() }],
				}),
			),
		).toBeNull();
	});

	it("accepts independent same-named default views", () => {
		const first = sourceView();
		const second = sourceView("second-owner");
		expect(
			classifyAccountCleanliness(
				cleanState({
					expectedSavedViews: [first, second],
					savedViews: [builtinView(second, "second-state"), builtinView(first)],
					pluginState: [
						systemInstallation(),
						systemInstallation({ id: "second-state", pluginId: "second-owner" }),
					],
				}),
			),
		).toBeNull();
	});

	it.each([
		["hidden", { isHidden: true }],
		["order", { sortOrder: 2 }],
		["layout", { settings: { layout: "table" } }],
		["workspace", { pluginInstallationId: "second-state" }],
		[
			"definition owner",
			{ reference: { kind: "plugin", slug: "catalog", pluginId: PluginId.make("second-owner") } },
		],
		[
			"renderer owner",
			{ renderer: { kind: "plugin", exportName: "catalog", pluginId: "second-owner" } },
		],
		["query owner", { dataSources: sourceView("second-owner").dataSources }],
	] as const)("rejects a modified default view %s", (_field, change) => {
		const definition = sourceView();
		expect(
			classifyAccountCleanliness(
				cleanState({
					pluginState: [systemInstallation()],
					savedViews: [{ ...builtinView(definition), ...change }],
					expectedSavedViews: [{ ...definition, dataSources: authoredQuery() }],
				}),
			),
		).toBe("saved-views");
	});

	it("rejects an edited query after self materialization", () => {
		const definition = sourceView();
		expect(
			classifyAccountCleanliness(
				cleanState({
					pluginState: [systemInstallation()],
					savedViews: [builtinView(sourceView("example-plugin-id", 21))],
					expectedSavedViews: [{ ...definition, dataSources: authoredQuery() }],
				}),
			),
		).toBe("saved-views");
	});

	it("does not substitute a same-named foreign view for a kernel default", () => {
		const kernel = kernelDefinitionSource().savedViews[0];
		assert(kernel);
		expect(
			classifyAccountCleanliness(
				cleanState({
					expectedSavedViews: [kernel],
					pluginState: [systemInstallation()],
					savedViews: [builtinView({ ...kernel, pluginId: "example-plugin-id" })],
				}),
			),
		).toBe("saved-views");
	});

	it("compares structural relationships with their exact schema owner", () => {
		const kernel = {
			properties: {},
			sourceEntityId: "source",
			targetEntityId: "target",
			relationshipSchemaPluginId: null,
			relationshipSchemaSlug: "member-of",
		};
		expect(
			classifyAccountCleanliness(
				cleanState({ relationships: [kernel], expectedBootstrapRelationships: [kernel] }),
			),
		).toBeNull();
		expect(
			classifyAccountCleanliness(
				cleanState({
					expectedBootstrapRelationships: [kernel],
					relationships: [{ ...kernel, relationshipSchemaPluginId: "foreign-owner" }],
				}),
			),
		).toBe("relationships");
	});

	it("accepts owner-qualified same-named default subscriptions", () => {
		expect(
			classifyAccountCleanliness(
				cleanState({
					notificationSubscriptions: [
						subscription(null),
						subscription("first"),
						subscription("second"),
					],
					expectedNotificationSubscriptions: [
						{ owner: { kind: "kernel" }, slug: SignalSchemaSlug.make("signal") },
						{
							slug: SignalSchemaSlug.make("signal"),
							owner: { kind: "plugin", pluginId: PluginId.make("first") },
						},
						{
							slug: SignalSchemaSlug.make("signal"),
							owner: { kind: "plugin", pluginId: PluginId.make("second") },
						},
					],
				}),
			),
		).toBeNull();
	});

	it("rejects a same-named subscription belonging to a different owner", () => {
		expect(
			classifyAccountCleanliness(
				cleanState({
					notificationSubscriptions: [subscription("foreign")],
					expectedNotificationSubscriptions: [
						{ owner: { kind: "kernel" }, slug: SignalSchemaSlug.make("signal") },
					],
				}),
			),
		).toBe("notification-subscriptions");
	});

	it.each([
		[
			"preferences",
			{
				profile: {
					image: null,
					name: "User",
					preferences: { ...defaultUserPreferences, disableIntegrations: true },
				},
			},
		],
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
						relationshipSchemaPluginId: null,
						relationshipSchemaSlug: "member-of",
					},
				],
			},
		],
		["entities", { entities: [entity(), entity("duplicate-schema-id")] }],
		["entities", { entities: [{ ...entity(), externalId: "external" }] }],
		[
			"entities",
			{ entities: [{ ...entity(), provider: { pluginId: "plugin", providerSlug: "movie.tmdb" } }] },
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
						isHidden: false,
						isBuiltin: false,
						dataSources: null,
						pluginInstallationId: null,
						id: SavedViewId.make("custom-id"),
						createdAt: new Date(0).toISOString(),
						updatedAt: new Date(0).toISOString(),
						renderer: { kind: "kernel", name: "results-table" },
						reference: { kind: "custom", savedViewId: SavedViewId.make("custom-id") },
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
		["plugin-state", { pluginState: [systemInstallation({ isHidden: true })] }],
		[
			"plugin-state",
			{
				pluginState: [
					systemInstallation({ homeSavedView: { kind: "kernel", slug: "selected-home" } }),
				],
			},
		],
		["plugin-state", { pluginState: [systemInstallation({ sortOrder: 3 })] }],
		["plugin-state", { pluginState: [systemInstallation({ config: { unit: "minutes" } })] }],
		["plugin-state", { pluginState: [systemInstallation({ userSettings: { allowNsfw: true } })] }],
		["plugin-state", { pluginState: [systemInstallation({ health: "needs-configuration" })] }],
		["plugin-state", { pluginState: [systemInstallation({ pluginScope: "user" })] }],
		["integrations", { hasIntegrations: true }],
		["notification-channels", { hasNotificationChannels: true }],
	] as const)("rejects %s", (category, override) => {
		expect(classifyAccountCleanliness(cleanState(override))).toBe(category);
	});
});
