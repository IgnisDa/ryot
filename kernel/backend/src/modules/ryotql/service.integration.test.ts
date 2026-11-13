import { expect } from "bun:test";

import {
	CLIENT_API_VERSION,
	type PluginConfigSchema,
	type PluginManifest,
} from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { builtinSavedViewId, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type {
	Predicate,
	RyotQLDocument,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/authored";
import type { RowItem, RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	NotificationSubscriptionId,
	PluginPackageId,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { fixtureManifest, testPluginPackageId } from "@ryot-app/contract/testing";
import {
	aggregate,
	and,
	ascending,
	castDate,
	castNumber,
	column,
	conditional,
	contains,
	dateBucket,
	descending,
	eq as queryEq,
	field,
	groupAscending,
	gte,
	inArray,
	join,
	jsonElementsJoin,
	jsonPath,
	literal,
	localDate,
	localHour,
	lt,
	measure,
	measureDescending,
	not,
	or,
	rows,
	star,
	startsWith,
	sum,
	table,
} from "@ryot-app/ryotql";
import { entityDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { importSourcesRecipe } from "@ryot-app/ryotql-recipes/import-sources";
import {
	instanceAdminUsersRecipe,
	migrationReportRecipe,
} from "@ryot-app/ryotql-recipes/instance-admin";
import { oauthConnectionStatusRecipe } from "@ryot-app/ryotql-recipes/oauth-connections";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { twoFactorStatusRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import type { RyotQLAudience } from "@ryot-app/ryotql/catalog";
import { assert } from "@ryot-app/testing/assert";
import { anyOf } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Option, Result } from "effect";

import { redactPluginConfig } from "#modules/plugins/configuration/redaction";
import { insertPluginRevision } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import { account, user } from "#schema/tables/auth";
import { notificationSubscription } from "#schema/tables/automations";
import { backupRun } from "#schema/tables/backups";
import {
	plugin,
	pluginConfigRevision,
	pluginInstallation,
	sandboxScript,
} from "#schema/tables/core";
import {
	definitionEntitySchema,
	definitionEventSchema,
	definitionImportSource,
	definitionIntegrationProvider,
	definitionRelationshipSchema,
	definitionSavedView,
	definitionSignalSchema,
} from "#schema/tables/definitions";
import { derivedValue } from "#schema/tables/derived-values";
import { entity, relationship } from "#schema/tables/entities";
import { event } from "#schema/tables/events";
import { migrationReport } from "#schema/tables/migration-reports";
import { oauthConnection } from "#schema/tables/oauth-connections";
import { entityTranslation } from "#schema/tables/translations";
import { savedView, savedViewOverride } from "#schema/tables/views";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { RyotQLService } from "./service";

const occurredAt = new Date(0);
const futureExpiry = new Date("2100-01-01T00:00:00Z");
const systemPluginName = "media-hub";
const systemPackageId = PluginPackageId.make("ryot/fixture-hub");

const manifest = (
	slug: string,
	homeView: null | string,
	packageId: PluginPackageId,
): PluginManifest => ({
	...fixtureManifest(),
	workflows: [
		{ slug: "import", scriptSlug: slug === systemPluginName ? "sys.import" : "private.import" },
	],
	metadata: {
		...fixtureManifest().metadata,
		packageId,
		name: `${slug} name`,
		description: `${slug} description`,
	},
	integrationProviders:
		slug === systemPluginName
			? [
					{
						lot: "yank",
						name: "Yank",
						description: "Yank",
						slug: "provider-yank",
						scriptSlug: "sys.yank",
						settingsSchema: { fields: {} },
						plan: { selections: { collector: { value: "remote" } } },
					},
				]
			: [],
	client: {
		homeView,
		apiVersion: CLIENT_API_VERSION,
		exports: {
			widget: {
				kind: "component",
				entry: "client/widget.tsx",
				automaticEntityPresentations: false,
			},
			page: {
				kind: "page",
				entry: "client/page.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
		},
	},
	scripts: [
		...fixtureManifest().scripts,
		{
			name: "Import",
			capabilities: [],
			kind: "workflow",
			runtimeImports: [],
			oauthConnectionFields: [],
			executableDependencies: [],
			optionalPluginConfigKeys: [],
			entry: "backend/import.sandbox.ts",
			slug: slug === systemPluginName ? "sys.import" : "private.import",
			requiredPluginConfigKeys: slug === systemPluginName ? ["apiKey"] : ["token"],
		},
	],
});

const insertPlugin = Effect.fn(function* (input: {
	readonly id: string;
	readonly slug: string;
	readonly ownerId: null | string;
	readonly homeView: null | string;
	readonly configSchema?: PluginConfigSchema;
	readonly client?: PluginManifest["client"];
}) {
	const revisionId = `${input.id}-revision`;
	const packageId =
		input.slug === systemPluginName ? systemPackageId : PluginPackageId.make(`test/${input.slug}`);
	const revisionManifest = {
		...manifest(input.slug, input.homeView, packageId),
		...(input.client ? { client: input.client } : {}),
		...(input.configSchema ? { configSchema: input.configSchema } : {}),
	};
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(plugin)
				.values({ packageId, id: input.id, status: "disabled", ownerId: input.ownerId });
			yield* insertPluginRevision(db, {
				id: revisionId,
				pluginId: input.id,
				manifest: revisionManifest,
				contentHash: `${input.id}-hash`,
				clientConfigSchema: input.configSchema
					? redactPluginConfig(input.configSchema, {}).configSchema
					: { fields: {}, unknownKeys: "strict" },
			});
			yield* db
				.update(plugin)
				.set({ status: "active", activeRevisionId: revisionId })
				.where(eq(plugin.id, input.id));
		}),
	);
});

const configRevision = (
	id: string,
	pluginRevisionId: string,
	configuredKeys: string[],
	installation: null | { readonly ownerUserId: string; readonly pluginInstallationId: string },
) => ({
	id,
	configuredKeys,
	pluginRevisionId,
	payloadFingerprint: id,
	encryptionKeyId: "key",
	nonce: Buffer.alloc(12),
	encryptedPayload: Buffer.alloc(16),
	ownerUserId: installation?.ownerUserId ?? null,
	pluginInstallationId: installation?.pluginInstallationId ?? null,
});

const script = (id: string, slug: string, pluginRevisionId: null | string) => ({
	id,
	slug,
	name: slug,
	pluginRevisionId,
	contentHash: "hash",
	compiledCode: "private-code",
	metadata: { runtimeImports: [] },
	source: pluginRevisionId === null ? "private-source" : null,
});

const definition = (id: string, pluginId: null | string, position = 0) => ({
	id,
	position,
	pluginId,
	slug: id,
	name: `${id} name`,
	pluginRevisionId: pluginId === null ? null : `${pluginId}-revision`,
});

const pluginDefinition = (id: string, pluginId: string, position = 0) => ({
	...definition(id, pluginId, position),
	pluginId,
	pluginRevisionId: `${pluginId}-revision`,
});

const entitySchemaDefinition = (id: string, pluginId: null | string) => ({
	...definition(id, pluginId),
	icon: "box",
	propertiesSchema: { fields: {} },
	mergeIdentityProperties: ["name"],
});

const importSourceDefinition = (
	id: string,
	pluginId: string,
	requiredPluginConfigKeys: string[],
	workflowScriptSlug: string,
	position = 0,
) => ({
	...pluginDefinition(id, pluginId, position),
	workflowScriptSlug,
	description: "Import",
	workflowSlug: "import",
	requiredPluginConfigKeys,
	inputSchema: { fields: {}, unknownKeys: "strict" as const },
});

const view = (
	id: string,
	userId: string,
	slug: string,
	renderer: SavedViewRenderer,
	input: Partial<typeof savedView.$inferInsert> = {},
): typeof savedView.$inferInsert => ({
	id,
	slug,
	userId,
	renderer,
	name: slug,
	icon: "box",
	settings: {},
	...input,
});

const seedCatalog = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(user).values([
				{ id: "owner", name: "Owner", email: "owner@example.test" },
				{ id: "other", name: "Other", email: "other@example.test" },
				{ id: "mixed", name: "Mixed", email: "mixed@example.test" },
				{ id: "plain", name: "Plain", email: "plain@example.test" },
			]);
			yield* db.insert(account).values(
				[
					{ userId: "owner", providerId: "credential" },
					{ userId: "other", providerId: "oidc" },
					{ userId: "mixed", providerId: "credential" },
					{ userId: "mixed", providerId: "oidc" },
				].map(({ userId, providerId }) => ({
					userId,
					providerId,
					updatedAt: occurredAt,
					id: `${userId}-${providerId}`,
					accountId: `${userId}-${providerId}`,
				})),
			);
			yield* db.insert(entity).values([
				{
					userId: "owner",
					name: "Owner record",
					id: "stream-entity-owner",
					entitySchemaSlug: "record",
				},
				{
					userId: "other",
					name: "Other record",
					id: "stream-entity-other",
					entitySchemaSlug: "record",
				},
			]);
			yield* db.insert(plugin).values([
				{ status: "disabled", id: "installed-plugin", packageId: testPluginPackageId() },
				{ status: "disabled", id: "removed-plugin", packageId: testPluginPackageId() },
			]);
			yield* insertPlugin({
				ownerId: null,
				id: "system-plugin",
				slug: systemPluginName,
				homeView: "system-home",
			});
			yield* insertPlugin({
				slug: "private",
				ownerId: "owner",
				id: "private-plugin",
				homeView: "private-home",
			});
			yield* insertPlugin({
				slug: "disabled",
				ownerId: "owner",
				id: "disabled-plugin",
				homeView: "disabled-home",
			});
			yield* insertPlugin({ slug: "other", homeView: null, ownerId: "other", id: "other-plugin" });
			yield* db
				.insert(pluginConfigRevision)
				.values(configRevision("system-env", "system-plugin-revision", ["apiKey"], null));
			yield* db
				.update(plugin)
				.set({ environmentConfigRevisionId: "system-env" })
				.where(eq(plugin.id, "system-plugin"));
			yield* db.insert(pluginInstallation).values([
				{ id: "installed", userId: "owner", pluginId: "installed-plugin" },
				{
					userId: "owner",
					id: "uninstalled",
					uninstalledAt: occurredAt,
					pluginId: "removed-plugin",
				},
				{
					userId: "owner",
					id: "owner-system",
					pluginId: "system-plugin",
					homeSavedView: { kind: "custom", savedViewId: SavedViewId.make("view-kernel") },
				},
				{
					userId: "owner",
					id: "owner-private",
					pluginId: "private-plugin",
					healthReason: "configured",
					configuredSecretPaths: ["token"],
					clientConfig: { visible: "yes" },
					homeSavedView: { kind: "custom", savedViewId: SavedViewId.make("view-component") },
				},
				{
					isHidden: true,
					userId: "owner",
					id: "owner-disabled",
					pluginId: "disabled-plugin",
					homeSavedView: { kind: "custom", savedViewId: SavedViewId.make("view-plugin-component") },
				},
				{
					userId: "other",
					id: "other-system",
					pluginId: "system-plugin",
					homeSavedView: { kind: "custom", savedViewId: SavedViewId.make("view-kernel") },
				},
				{ userId: "other", id: "other-private", pluginId: "other-plugin" },
			]);
			yield* db
				.insert(pluginConfigRevision)
				.values(
					configRevision("private-config", "private-plugin-revision", ["token"], {
						ownerUserId: "owner",
						pluginInstallationId: "owner-private",
					}),
				);
			yield* db
				.update(pluginInstallation)
				.set({ activeConfigRevisionId: "private-config" })
				.where(eq(pluginInstallation.id, "owner-private"));
			yield* db
				.insert(sandboxScript)
				.values([
					script("kernel-script", "kernel.notify", null),
					script("sys-yank-script", "sys.yank", "system-plugin-revision"),
					script("sys-import-script", "sys.import", "system-plugin-revision"),
					script("private-import-script", "private.import", "private-plugin-revision"),
				]);
			yield* db
				.insert(definitionEntitySchema)
				.values([
					entitySchemaDefinition("kernel-entity", null),
					entitySchemaDefinition("system-entity", "system-plugin"),
					entitySchemaDefinition("private-entity", "private-plugin"),
					entitySchemaDefinition("disabled-entity", "disabled-plugin"),
					entitySchemaDefinition("other-entity", "other-plugin"),
				]);
			yield* db.insert(definitionEventSchema).values([
				{
					position: 0,
					id: "kernel-event",
					slug: "kernel-event",
					name: "Kernel event",
					entitySchemaId: "kernel-entity",
					propertiesSchema: { fields: {} },
				},
				{
					position: 0,
					id: "system-event",
					slug: "system-event",
					name: "System event",
					entitySchemaId: "system-entity",
					propertiesSchema: { fields: {} },
				},
			]);
			yield* db.insert(definitionRelationshipSchema).values([
				{ ...definition("kernel-link", null), propertiesSchema: { fields: {} } },
				{ ...definition("private-link", "private-plugin"), propertiesSchema: { fields: {} } },
			]);
			yield* db
				.insert(definitionSignalSchema)
				.values({
					...definition("system.signal", "system-plugin"),
					catalogState: "active",
					propertiesSchema: { fields: {} },
					audiencePolicy: { kind: "actor" },
					notificationHookSlug: "fixture.automation",
				});
			yield* db
				.insert(definitionImportSource)
				.values([
					importSourceDefinition("import-sys-ready", "system-plugin", ["apiKey"], "sys.import"),
					importSourceDefinition(
						"import-sys-missing",
						"system-plugin",
						["apiKey", "clientSecret"],
						"sys.import",
						1,
					),
					importSourceDefinition("import-sys-no-script", "system-plugin", [], "absent.import", 2),
					importSourceDefinition("import-private", "private-plugin", ["token"], "private.import"),
				]);
			yield* db.insert(definitionIntegrationProvider).values([
				{
					...pluginDefinition("provider-push", "system-plugin"),
					lot: "push",
					scriptSlug: null,
					description: "Push",
					requiresProKey: false,
					settingsSchema: { fields: {} },
				},
				{
					...pluginDefinition("provider-yank", "system-plugin", 1),
					lot: "yank",
					description: "Yank",
					requiresProKey: true,
					scriptSlug: "sys.yank",
					settingsSchema: { fields: {} },
					plan: { selections: { collector: { value: "remote" } } },
				},
				{
					...pluginDefinition("provider-missing", "system-plugin", 2),
					lot: "yank",
					requiresProKey: false,
					description: "Missing",
					scriptSlug: "absent.yank",
					settingsSchema: { fields: {} },
				},
			]);
			yield* db
				.insert(savedView)
				.values([
					view("view-kernel", "owner", "kernel-view", { kind: "kernel", name: "entity-browser" }),
					view("view-component", "owner", "component-view", {
						kind: "plugin",
						exportName: "widget",
						pluginId: "system-plugin",
					}),
					view("view-plugin-component", "owner", "plugin-component", {
						kind: "plugin",
						exportName: "widget",
						pluginId: "system-plugin",
					}),
				]);
			yield* db.insert(definitionSavedView).values([
				{
					...definition("private-home", "private-plugin"),
					icon: "box",
					sortOrder: 0,
					settings: {},
					dataSources: null,
					renderer: { kind: "plugin", exportName: "page", pluginId: "system-plugin" },
				},
				{
					...definition("disabled-home", "disabled-plugin"),
					icon: "box",
					sortOrder: 0,
					settings: {},
					dataSources: null,
					renderer: { kind: "kernel", name: "entity-browser" },
				},
				{
					...definition("system-home", "system-plugin"),
					icon: "box",
					sortOrder: 0,
					settings: {},
					dataSources: null,
					renderer: { kind: "plugin", exportName: "page", pluginId: "system-plugin" },
				},
			]);
			yield* db
				.insert(savedViewOverride)
				.values({
					sortOrder: 0,
					isHidden: true,
					userId: "owner",
					slug: "disabled-home",
					pluginId: "disabled-plugin",
				});
			yield* db.insert(backupRun).values([
				{
					kind: "export",
					userId: "owner",
					id: "backup-owner",
					status: "completed",
					expiresAt: futureExpiry,
					artifactKey: "secret-key",
					artifactProvider: "local",
				},
				{ userId: "other", kind: "restore", status: "pending", id: "backup-other" },
			]);
			yield* db
				.insert(migrationReport)
				.values([
					...["first", "second", "third"].map((message) => ({
						message,
						phase: "import",
						level: "info" as const,
					})),
					{
						phase: "import",
						message: "uncounted",
						code: "record-skipped",
						level: "warning" as const,
					},
					{
						count: 5,
						phase: "import",
						message: "counted",
						code: "record-skipped",
						level: "warning" as const,
					},
				]);
			yield* db
				.insert(notificationSubscription)
				.values({
					userId: "owner",
					signalSchemaSlug: "fixture.signal",
					id: NotificationSubscriptionId.make("subscription"),
				});
		}),
	);
});

const catalogDatabaseLayer = Layer.merge(
	RyotQLService.layer,
	Layer.effectDiscard(seedCatalog),
).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ryotql_test")),
	Layer.provide(makeConfigProviderLayer()),
);

const rowsOf = (response: RyotQLResponse) => {
	const result = response.data["rows"];
	assert(result?.type === "rows");
	return result;
};

type Reader = "admin" | { readonly userId: string; readonly audience: RyotQLAudience };

const owner = { userId: "owner", audience: "kernel" } as const;

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"groups repeated local hours and calendar years in PostgreSQL",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const timeZone = "America/New_York";
					const response = yield* service.executeForUser("owner", null, "kernel", {
						source: {
							kind: "inline",
							document: {
								queries: {
									rows: rows(table("user", "account"), {
										fields: [
											field(
												"beforeGap",
												localHour(castDate(literal("2024-03-10T06:30:00Z")), { timeZone }),
											),
											field(
												"afterGap",
												localHour(castDate(literal("2024-03-10T07:30:00Z")), { timeZone }),
											),
											field(
												"firstHour",
												localHour(castDate(literal("2024-11-03T05:30:00Z")), { timeZone }),
											),
											field(
												"secondHour",
												localHour(castDate(literal("2024-11-03T06:30:00Z")), { timeZone }),
											),
											field(
												"year",
												dateBucket(castDate(literal("2024-01-01T02:00:00Z")), {
													timeZone,
													bucket: "year",
												}),
											),
										],
									}),
								},
							},
						},
					});
					expect(rowsOf(response).items).toEqual([
						{
							afterGap: 3,
							beforeGap: 1,
							firstHour: 1,
							secondHour: 1,
							year: "2023-01-01T05:00:00.000Z",
						},
					]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"returns local calendar dates across zones and supports RyotQL operations",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const users = table("user", "account");
					const timeZone = "America/New_York";
					const sameInstant = castDate(literal("2024-03-01T00:30:00Z"));
					const response = yield* service.executeForAdmin({
						source: {
							kind: "inline",
							document: {
								queries: {
									rows: rows(users, {
										limit: 1,
										fields: [
											field("utc", localDate(sameInstant, { timeZone: "UTC" })),
											field("pacific", localDate(sameInstant, { timeZone: "America/Los_Angeles" })),
											field(
												"beforeGap",
												localDate(castDate(literal("2024-03-10T06:30:00Z")), { timeZone }),
											),
											field(
												"afterGap",
												localDate(castDate(literal("2024-03-10T07:30:00Z")), { timeZone }),
											),
											field(
												"firstRepeatedHour",
												localDate(castDate(literal("2024-11-03T05:30:00Z")), { timeZone }),
											),
											field(
												"secondRepeatedHour",
												localDate(castDate(literal("2024-11-03T06:30:00Z")), { timeZone }),
											),
											field(
												"leapDay",
												localDate(castDate(literal("2024-02-29T23:30:00Z")), { timeZone: "UTC" }),
											),
											field("missing", localDate(castDate(literal(null)), { timeZone: "UTC" })),
										],
									}),
								},
							},
						},
					});
					expect(rowsOf(response).items).toEqual([
						{
							missing: null,
							utc: "2024-03-01",
							pacific: "2024-02-29",
							leapDay: "2024-02-29",
							afterGap: "2024-03-10",
							beforeGap: "2024-03-10",
							firstRepeatedHour: "2024-11-03",
							secondRepeatedHour: "2024-11-03",
						},
					]);

					const filterDate = localDate(sameInstant, { timeZone: "America/Los_Angeles" });
					const filtered = yield* service.executeForAdmin({
						source: {
							kind: "inline",
							document: {
								queries: {
									rows: rows(users, {
										orderBy: [ascending(column(users, "id"))],
										fields: [field("id", column(users, "id"))],
										where: queryEq(filterDate, literal("2024-02-29")),
									}),
								},
							},
						},
					});
					expect(rowsOf(filtered).items).toEqual([
						{ id: "mixed" },
						{ id: "other" },
						{ id: "owner" },
						{ id: "plain" },
					]);

					const createdDay = localDate(column(users, "createdAt"), { timeZone: "UTC" });
					const pages = yield* collectPages(
						rows(users, {
							orderBy: [ascending(createdDay)],
							fields: [field("id", column(users, "id")), field("day", createdDay)],
						}),
					);
					expect(pages.map((row) => row["id"])).toEqual(["mixed", "other", "owner", "plain"]);

					const grouped = yield* service.executeForAdmin({
						source: {
							kind: "inline",
							document: {
								queries: {
									groups: aggregate(users, {
										limit: 10,
										orderBy: [groupAscending("day")],
										groupBy: [field("day", createdDay)],
										measures: [measure("count", { function: "count" })],
									}),
								},
							},
						},
					});
					expect(grouped.data["groups"]).toMatchObject({
						type: "aggregate",
						items: [{ count: 4, day: pages[0]?.["day"] }],
					});

					const groupPage = (after: null | string) =>
						service
							.executeForAdmin({
								pages: { groups: { after: after ?? undefined } },
								source: {
									kind: "inline",
									document: {
										queries: {
											groups: aggregate(users, {
												limit: 3,

												orderBy: [measureDescending("count")],
												groupBy: [field("id", column(users, "id"))],
												measures: [measure("count", { function: "count" })],
											}),
										},
									},
								},
							})
							.pipe(
								Effect.map(({ data }) => {
									const result = data["groups"];
									assert(result?.type === "aggregate" && result.pageInfo);
									return {
										after: result.pageInfo.nextCursor,
										ids: result.items.map((item) => item["id"]),
									};
								}),
							);
					const first = yield* groupPage(null);
					const second = yield* groupPage(first.after);
					const groupPages = [first.ids, second.ids];
					expect(second.after).toBeNull();
					expect(groupPages).toEqual([["mixed", "other", "owner"], ["plain"]]);

					const choices = jsonElementsJoin("inner", "choice", literal(["date-only", "instant"]));
					const sameDay = conditional(
						queryEq(column(choices, "ordinal"), literal(1)),
						literal("2024-02-29"),
						localDate(castDate(literal("2024-02-29T12:00:00Z")), { timeZone: "UTC" }),
					);
					const distinct = yield* service.executeForAdmin({
						source: {
							kind: "inline",
							document: {
								queries: {
									days: aggregate(users, {
										joins: [choices],
										measures: [measure("count", { expr: sameDay, function: "countDistinct" })],
									}),
								},
							},
						},
					});
					expect(distinct.data["days"]).toEqual({ type: "aggregate", items: [{ count: 1 }] });
				}),
			testTimeout,
		);
	},
);

const derived = (input: {
	targetId: string;
	value?: JsonValue;
	subjectEntityId: string;
	kind: "event" | "subject" | "relationship";
	status?: "ready" | "failed" | "pending" | undefined;
}) => ({
	userId: "owner",
	value: sql`'null'::jsonb`,
	pluginId: "private-plugin",
	pluginRevisionId: "private-plugin-revision",
	...input,
});

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"reads fold outputs and their status across metrics and ranked cursor pages",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const service = yield* RyotQLService;
					const ids = ["rank-a", "rank-b", "rank-c", "rank-d", "rank-empty"];
					const projection = {
						propertiesSchema: {
							fields: { score: { label: "Score", description: "Score", type: "number" as const } },
						},
					};
					yield* session.run((db) =>
						db
							.update(pluginInstallation)
							.set({ health: "ready" })
							.where(eq(pluginInstallation.id, "owner-private")),
					);
					yield* session.run((db) =>
						db
							.insert(definitionEventSchema)
							.values({
								projection,
								position: 1,
								slug: "projected",
								name: "Projected",
								id: "private-projected",
								entitySchemaId: "private-entity",
								propertiesSchema: { fields: {} },
							}),
					);
					yield* session.run((db) =>
						db
							.insert(definitionRelationshipSchema)
							.values({
								...definition("projected-link", "private-plugin", 1),
								projection,
								propertiesSchema: { fields: {} },
							}),
					);
					yield* session.run((db) =>
						db
							.insert(entity)
							.values(
								ids.map((id) => ({
									id,
									name: id,
									userId: "owner",
									entitySchemaSlug: "private-entity",
									entitySchemaPluginId: "private-plugin",
								})),
							),
					);
					for (const [index, id] of ids.slice(0, 4).entries()) {
						yield* session.run((db) =>
							db
								.insert(event)
								.values({
									occurredAt,
									entityId: id,
									userId: "owner",
									id: `${id}-event`,
									eventSchemaSlug: "projected",
									eventSchemaPluginId: "private-plugin",
								}),
						);
						yield* session.run((db) =>
							db
								.insert(derivedValue)
								.values([
									derived({
										targetId: id,
										kind: "subject",
										subjectEntityId: id,
										status: (["ready", "ready", "pending", "failed"] as const)[index],
									}),
									...(index < 2
										? [
												derived({
													kind: "event",
													subjectEntityId: id,
													value: { score: 8 },
													targetId: `${id}-event`,
												}),
											]
										: []),
								]),
						);
					}
					const source = table("event", "source");
					const subjects = table("entity", "subjects");
					const score = castNumber(jsonPath(column(source, "projection"), "score"));
					const rankingQuery = (baseline: boolean) => {
						const range = and(
							gte(column(source, "occurredAt"), castDate(literal("1969-01-01"))),
							lt(column(source, "occurredAt"), castDate(literal("1971-01-01"))),
						);
						const total = sum(source, score, {
							where: and(
								baseline ? or(range) : range,
								queryEq(column(source, "entityId"), column(subjects, "id")),
							),
						});
						return rows(subjects, {
							orderBy: [descending(total)],
							where: inArray(column(subjects, "id"), ids.map(literal)),
							fields: [field("id", column(subjects, "id")), field("total", total)],
						});
					};
					const ranking = rankingQuery(false);
					expect(yield* collectPages(ranking, owner)).toEqual(
						yield* collectPages(rankingQuery(true), owner),
					);
					expect(yield* collectPages(ranking, owner)).toEqual([
						{ total: 8, id: "rank-a" },
						{ total: 8, id: "rank-b" },
						{ total: null, id: "rank-c" },
						{ total: null, id: "rank-d" },
						{ total: null, id: "rank-empty" },
					]);
					expect(yield* collectPages(ranking, other)).toEqual([]);
					expect(
						(yield* service.executeForUser("owner", null, "plugin", {
							source: {
								kind: "inline",
								document: {
									queries: {
										totals: aggregate(source, {
											measures: [
												measure("sum", { expr: score, function: "sum" }),
												measure("max", { expr: score, function: "maximum" }),
											],
										}),
									},
								},
							},
						})).data["totals"],
					).toEqual({ type: "aggregate", items: [{ max: 8, sum: 16 }] });
					expect(yield* readRows(owner, "event", ["id", "projectionStatus"])).toEqual([
						{ id: "rank-a-event", projectionStatus: "ready" },
						{ id: "rank-b-event", projectionStatus: "ready" },
						{ id: "rank-c-event", projectionStatus: "pending" },
						{ id: "rank-d-event", projectionStatus: "failed" },
					]);
					expect(
						rowsOf(
							yield* service.executeForUser("owner", null, "kernel", {
								source: {
									kind: "inline",
									document: {
										queries: {
											rows: rows(subjects, {
												orderBy: [ascending(column(subjects, "id"))],
												where: queryEq(column(subjects, "id"), literal("rank-empty")),
												fields: [
													field("status", column(source, "projectionStatus")),
													field("value", column(source, "projection")),
												],
												joins: [
													join(
														"left",
														source,
														queryEq(column(source, "entityId"), column(subjects, "id")),
													),
												],
											}),
										},
									},
								},
							}),
						).items,
					).toEqual([{ value: null, status: "none" }]);
					yield* session.run((db) =>
						db
							.insert(relationship)
							.values(
								["projected-link", "private-link"].map((slug) => ({
									userId: "owner",
									id: `${slug}-row`,
									sourceEntityId: "rank-a",
									targetEntityId: "rank-b",
									relationshipSchemaSlug: slug,
									relationshipSchemaPluginId: "private-plugin",
								})),
							),
					);
					const links = () =>
						readRows(owner, "relationship", ["id", "projection", "projectionStatus"]);
					expect(yield* links()).toEqual([
						{ projection: null, id: "private-link-row", projectionStatus: "none" },
						{ projection: null, id: "projected-link-row", projectionStatus: "pending" },
					]);
					yield* session.run((db) =>
						db
							.insert(derivedValue)
							.values(
								derived({
									value: { score: 4 },
									kind: "relationship",
									subjectEntityId: "rank-a",
									targetId: "projected-link-row",
								}),
							),
					);
					expect((yield* links())[1]).toEqual({
						id: "projected-link-row",
						projection: { score: 4 },
						projectionStatus: "ready",
					});
					yield* session.run((db) =>
						db
							.update(derivedValue)
							.set({ status: "failed" })
							.where(sql`${derivedValue.kind} = 'subject' and ${derivedValue.targetId} = 'rank-a'`),
					);
					expect((yield* links())[1]).toEqual({
						id: "projected-link-row",
						projection: { score: 4 },
						projectionStatus: "failed",
					});
					expect(
						(yield* readRows(owner, "event", ["id", "projection", "projectionStatus"]))[0],
					).toEqual({ id: "rank-a-event", projection: { score: 8 }, projectionStatus: "failed" });
					yield* session.run((db) =>
						db.delete(derivedValue).where(eq(derivedValue.targetId, "rank-a-event")),
					);
					const ranked = yield* collectPages(ranking, owner);
					expect(ranked).toEqual(yield* collectPages(rankingQuery(true), owner));
					expect(ranked.find((row) => row["id"] === "rank-a")).toEqual({
						total: null,
						id: "rank-a",
					});
				}),
			testTimeout,
		);
	},
);
const other = { userId: "other", audience: "kernel" } as const;

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"reads a write's own changes read-only and leaves that write's transaction usable",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const session = yield* DatabaseSession;
					const recipe = twoFactorStatusRecipe;
					const settings = sql`select current_setting('statement_timeout') as timeout,
					current_setting('jit') as jit, current_setting('transaction_read_only') as "readOnly"`;
					const seen = yield* session.transaction(
						Effect.gen(function* () {
							const before = yield* session.run((db) => db.execute(settings, "objects"));
							yield* session.run((db) =>
								db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, "owner")),
							);
							const read = yield* service.executeForUser("owner", null, "kernel", {
								source: { kind: "inline", document: recipe.document },
							});
							expect(yield* session.run((db) => db.execute(settings, "objects"))).toEqual(before);
							yield* session.run((db) =>
								db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, "owner")),
							);
							return Result.getOrThrow(recipe.decode(read));
						}),
					);
					expect(seen).toEqual({ enabled: true, available: true });
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"projects password availability and nullable two-factor state for the current user",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const recipe = twoFactorStatusRecipe;
					for (const [userId, available] of [
						["owner", true],
						["mixed", true],
						["other", false],
						["plain", false],
					] as const) {
						const response = yield* service.executeForUser(userId, null, "kernel", {
							source: { kind: "inline", document: recipe.document },
						});
						expect(Result.getOrThrow(recipe.decode(response))).toEqual({
							available,
							enabled: false,
						});
					}
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, "owner")),
					);
					expect(
						Result.getOrThrow(
							recipe.decode(
								yield* service.executeForUser("owner", null, "kernel", {
									source: { kind: "inline", document: recipe.document },
								}),
							),
						),
					).toEqual({ enabled: true, available: true });
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"reads owned OAuth status with query-time expiry and no credential fields",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db.insert(oauthConnection).values(
							(
								[
									{ id: "pending", status: "pending", expiresAt: futureExpiry },
									{ id: "authorized", status: "authorized", expiresAt: futureExpiry },
									{ id: "connected", expiresAt: null, status: "connected" },
									{ id: "lapsed", status: "pending", expiresAt: occurredAt },
									{ status: "authorized", expiresAt: occurredAt, id: "lapsed-authorized" },
									{ status: "connected", expiresAt: occurredAt, id: "lapsed-connected" },
									{ id: "failed", status: "failed", expiresAt: occurredAt },
									{ id: "expired", status: "expired", expiresAt: futureExpiry },
								] satisfies ReadonlyArray<
									Pick<typeof oauthConnection.$inferInsert, "id" | "status" | "expiresAt">
								>
							).map((row) => ({
								id: row.id,
								userId: "owner",
								field: "account",
								stateHash: row.id,
								status: row.status,
								expiresAt: row.expiresAt,
								oauthProviderSlug: "test-oauth",
								client: { kind: "web" as const },
								pluginInstallationId: "owner-private",
								tokenUrlOrigin: "https://example.test",
								integrationProviderSlug: "test-integration",
							})),
						),
					);
					const service = yield* RyotQLService;
					for (const [id, status] of [
						["pending", "pending"],
						["authorized", "authorized"],
						["connected", "connected"],
						["lapsed", "expired"],
						["lapsed-authorized", "expired"],
						["lapsed-connected", "expired"],
						["failed", "failed"],
						["expired", "expired"],
					] as const) {
						const recipe = oauthConnectionStatusRecipe;
						expect(
							Result.getOrThrow(
								recipe.decode(
									yield* service.executeForUser("owner", null, "kernel", {
										arguments: { id },
										source: { kind: "inline", document: recipe.document },
									}),
								),
							),
						).toEqual(Option.some(status));
						expect(
							Result.getOrThrow(
								recipe.decode(
									yield* service.executeForUser("other", null, "kernel", {
										arguments: { id },
										source: { kind: "inline", document: recipe.document },
									}),
								),
							),
						).toEqual(Option.none());
					}
					const missing = oauthConnectionStatusRecipe;
					const missingRequest = {
						arguments: { id: "missing" },
						source: { kind: "inline", document: missing.document } as const,
					};
					expect(
						Result.getOrThrow(
							missing.decode(
								yield* service.executeForUser("owner", null, "kernel", missingRequest),
							),
						),
					).toEqual(Option.none());
					const connection = table("oauthConnection", "connection");
					const response = yield* service.executeForUser("owner", null, "kernel", {
						source: {
							kind: "inline",
							document: { queries: { rows: rows(connection, { fields: [star(connection)] }) } },
						},
					});
					expect(rowsOf(response).items.find(({ id }) => id === "failed")).toEqual({
						id: "failed",
						status: "failed",
					});
				}),
			testTimeout,
		);
	},
);

const readRows = Effect.fn(function* (
	reader: Reader,
	tableName: string,
	fieldNames: readonly string[],
	primaryKey?: string,
) {
	const service = yield* RyotQLService;
	const source = table(tableName, "source");
	const document = {
		queries: {
			rows: rows(source, {
				orderBy: [ascending(column(source, primaryKey ?? "id"))],
				fields: fieldNames.map((name) => field(name, column(source, name))),
			}),
		},
	};
	return rowsOf(
		yield* reader === "admin"
			? service.executeForAdmin({ source: { kind: "inline", document: document } })
			: service.executeForUser(reader.userId, null, reader.audience, {
					source: { kind: "inline", document: document },
				}),
	).items;
});

const collectPages = (query: ReturnType<typeof rows>, reader: Reader = "admin") =>
	Effect.gen(function* () {
		const service = yield* RyotQLService;
		const items: RowItem[] = [];
		let after: string | undefined;
		do {
			const document = {
				queries: {
					rows: { ...query, output: { ...query.output, pagination: { limit: 1, maxLimit: 1 } } },
				},
			};
			const page = rowsOf(
				yield* reader === "admin"
					? service.executeForAdmin({
							pages: { rows: { after } },
							source: { kind: "inline", document: document },
						})
					: service.executeForUser(reader.userId, null, reader.audience, {
							pages: { rows: { after } },
							source: { kind: "inline", document: document },
						}),
			);
			items.push(...page.items);
			after = page.pageInfo.nextCursor ?? undefined;
		} while (after);
		return items;
	});

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"reports no projection for source events without a projection declaration",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db
							.insert(event)
							.values({
								properties: {},
								userId: "owner",
								occurredAt: new Date(),
								eventSchemaSlug: "source",
								id: "projection-source-owner",
								entityId: "stream-entity-owner",
							}),
					);
					expect(yield* readRows(owner, "event", ["id", "projection", "projectionStatus"])).toEqual(
						[{ projection: null, projectionStatus: "none", id: "projection-source-owner" }],
					);
					expect(yield* readRows(other, "event", ["id", "projection", "projectionStatus"])).toEqual(
						[],
					);
				}),
			testTimeout,
		);

		test.effect(
			"executes recipe documents and decodes correlated includes and admin totals",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const userRecipe = entityDefinitionsRecipe;
					const userRecipeRequest = {
						arguments: {},
						source: { kind: "inline", document: userRecipe.document } as const,
						pages: Object.fromEntries(
							Object.entries(userRecipe.document.queries).flatMap(([key, query]) =>
								query.output.type === "rows" || query.output.groupBy?.length
									? [[key, { limit: 20 }]]
									: [],
							),
						),
					};
					const entities = Result.getOrThrow(
						userRecipe.decode(
							yield* service.executeForUser("owner", null, "kernel", userRecipeRequest),
						),
					);
					expect(
						entities.items.find(({ slug }) => slug === "kernel-entity")?.eventSchemas.items,
					).toMatchObject([{ slug: "kernel-event" }]);

					const sourcesRecipe = importSourcesRecipe;
					const sourcesRecipeRequest = {
						arguments: {},
						source: { kind: "inline", document: sourcesRecipe.document } as const,
						pages: Object.fromEntries(
							Object.entries(sourcesRecipe.document.queries).flatMap(([key, query]) =>
								query.output.type === "rows" || query.output.groupBy?.length
									? [[key, { limit: 20 }]]
									: [],
							),
						),
					};
					const sources = Result.getOrThrow(
						sourcesRecipe.decode(
							yield* service.executeForUser("owner", null, "kernel", sourcesRecipeRequest),
						),
					);
					expect(sources.items.find(({ slug }) => slug === "import-sys-ready")).toMatchObject({
						isStartable: true,
						workflowSlug: "import",
					});

					const installationsRecipe = pluginInstallationsRecipe;
					const installationsRecipeRequest = {
						arguments: {},
						source: { kind: "inline", document: installationsRecipe.document } as const,
						pages: Object.fromEntries(
							Object.entries(installationsRecipe.document.queries).flatMap(([key, query]) =>
								query.output.type === "rows" || query.output.groupBy?.length
									? [[key, { limit: 20 }]]
									: [],
							),
						),
					};
					const installations = Result.getOrThrow(
						installationsRecipe.decode(
							yield* service.executeForUser("owner", null, "kernel", installationsRecipeRequest),
						),
					);
					expect(
						installations.items.find(({ packageId }) => packageId === "test/private")
							?.configuredSecrets,
					).toEqual(["token"]);

					const usersRecipe = instanceAdminUsersRecipe;
					const usersRecipeRequest = {
						arguments: { search: "example.test" },
						source: { kind: "inline", document: usersRecipe.document } as const,
						pages: Object.fromEntries(
							Object.entries(usersRecipe.document.queries).flatMap(([key, query]) =>
								query.output.type === "rows" || query.output.groupBy?.length
									? [[key, { limit: 2 }]]
									: [],
							),
						),
					};
					const users = Result.getOrThrow(
						usersRecipe.decode(yield* service.executeForAdmin(usersRecipeRequest)),
					);
					expect(users.total).toBe(4);
					expect(users.pageInfo.hasMore).toBe(true);

					const reportRecipe = migrationReportRecipe;
					const reportRecipeRequest = {
						arguments: {},
						source: { kind: "inline", document: reportRecipe.document } as const,
						pages: Object.fromEntries(
							Object.entries(reportRecipe.document.queries).flatMap(([key, query]) =>
								query.output.type === "rows" || query.output.groupBy?.length
									? [[key, { limit: 3 }]]
									: [],
							),
						),
					};
					const report = Result.getOrThrow(
						reportRecipe.decode(yield* service.executeForAdmin(reportRecipeRequest)),
					);
					expect(report.items.map(({ level }) => level)).toEqual(["warning", "warning", "info"]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"pages numeric primary keys with admin cursors and derives detail totals",
			() =>
				Effect.gen(function* () {
					const report = table("migrationReport", "report");
					const items = yield* collectPages(
						rows(report, {
							orderBy: [],
							fields: [
								field("seq", column(report, "seq")),
								field("message", column(report, "message")),
								field("totalDetails", column(report, "totalDetails")),
							],
						}),
					);

					expect(items).toEqual([
						{ seq: 1, message: "first", totalDetails: null },
						{ seq: 2, message: "second", totalDetails: null },
						{ seq: 3, message: "third", totalDetails: null },
						{ seq: 4, totalDetails: 0, message: "uncounted" },
						{ seq: 5, totalDetails: 5, message: "counted" },
					]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"pages timestamp cursors at full database precision",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db.insert(backupRun).values([
							{
								kind: "export",
								userId: "owner",
								id: "precision-a",
								status: "completed",
								createdAt: sql`'2026-01-01T00:00:00.100Z'::timestamptz`,
							},
							{
								kind: "export",
								userId: "owner",
								id: "precision-b",
								status: "completed",
								createdAt: sql`'2026-01-01T00:00:00.200Z'::timestamptz`,
							},
							{
								kind: "export",
								userId: "owner",
								id: "precision-c",
								status: "completed",
								createdAt: sql`'2026-01-01T00:00:00.300Z'::timestamptz`,
							},
						]),
					);
					const runs = table("backupRun", "runs");
					const ids = ["precision-a", "precision-b", "precision-c"].map(literal);
					const fields = [field("id", column(runs, "id"))];
					const where = inArray(column(runs, "id"), ids);

					expect(
						yield* collectPages(
							rows(runs, { where, fields, orderBy: [ascending(column(runs, "createdAt"))] }),
							owner,
						),
					).toEqual([{ id: "precision-a" }, { id: "precision-b" }, { id: "precision-c" }]);
					expect(
						yield* collectPages(
							rows(runs, { where, fields, orderBy: [descending(column(runs, "createdAt"))] }),
							owner,
						),
					).toEqual([{ id: "precision-c" }, { id: "precision-b" }, { id: "precision-a" }]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"pages composite primary keys with every key column as a tie breaker",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db.insert(entityTranslation).values([
							{ language: "en", sourceContentGeneration: 1, entityId: "stream-entity-other" },
							{ language: "en", sourceContentGeneration: 1, entityId: "stream-entity-owner" },
							{ language: "de", sourceContentGeneration: 1, entityId: "stream-entity-owner" },
						]),
					);
					const translations = table("entityTranslation", "translations");
					const entityIds = ["stream-entity-other", "stream-entity-owner"].map(literal);
					const where = inArray(column(translations, "entityId"), entityIds);
					const fields = [
						field("entityId", column(translations, "entityId")),
						field("language", column(translations, "language")),
					];

					expect(yield* collectPages(rows(translations, { where, fields, orderBy: [] }))).toEqual([
						{ language: "en", entityId: "stream-entity-other" },
						{ language: "de", entityId: "stream-entity-owner" },
						{ language: "en", entityId: "stream-entity-owner" },
					]);
					expect(
						yield* collectPages(
							rows(translations, {
								where,
								fields,
								orderBy: [descending(column(translations, "language"))],
							}),
						),
					).toEqual([
						{ language: "en", entityId: "stream-entity-other" },
						{ language: "en", entityId: "stream-entity-owner" },
						{ language: "de", entityId: "stream-entity-owner" },
					]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"exposes the private installation configuration pin to admin readers",
			() =>
				Effect.gen(function* () {
					const installations = yield* readRows("admin", "pluginInstallation", [
						"id",
						"activeConfigRevisionId",
					]);
					expect(installations.find(({ id }) => id === "owner-private")).toEqual({
						id: "owner-private",
						activeConfigRevisionId: "private-config",
					});
				}),
			testTimeout,
		);
		test.effect(
			"hides uninstalled installations from users but not from admins",
			() =>
				Effect.gen(function* () {
					for (const audience of ["kernel", "plugin"] as const) {
						expect(
							yield* readRows({ audience, userId: "owner" }, "pluginInstallation", ["id"]),
						).toEqual([
							{ id: "installed" },
							{ id: "owner-disabled" },
							{ id: "owner-private" },
							{ id: "owner-system" },
						]);
					}
					expect(yield* readRows("admin", "pluginInstallation", ["id"])).toEqual([
						{ id: "installed" },
						{ id: "other-private" },
						{ id: "other-system" },
						{ id: "owner-disabled" },
						{ id: "owner-private" },
						{ id: "owner-system" },
						{ id: "uninstalled" },
					]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"expands admin-only fields only for admin wildcards",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const subscription = table("notificationSubscription", "subscription");
					const document = {
						queries: { rows: rows(subscription, { fields: [star(subscription)] }) },
					};

					const [userItem] = rowsOf(
						yield* service.executeForUser("owner", null, "kernel", {
							source: { kind: "inline", document: document },
						}),
					).items;
					const [adminItem] = rowsOf(
						yield* service.executeForAdmin({ source: { kind: "inline", document: document } }),
					).items;

					expect(userItem).not.toHaveProperty("userId");
					expect(adminItem).toMatchObject({ userId: "owner", id: "subscription" });
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"shows users only themselves and classifies auth state for admins",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const users = table("user", "users");
					const document = { queries: { rows: rows(users, { fields: [star(users)] }) } };

					expect(
						rowsOf(
							yield* service.executeForUser("owner", null, "kernel", {
								source: { kind: "inline", document: document },
							}),
						).items,
					).toEqual([
						{
							id: "owner",
							image: null,
							name: "Owner",
							createdAt: anyOf(String),
							email: "owner@example.test",
							twoFactorStatus: { enabled: false, available: true },
							preferences: {
								language: null,
								reportingTimeZone: UTC,
								ratingScale: "hundred",
								disableIntegrations: false,
							},
						},
					]);
					expect(yield* readRows("admin", "user", ["id", "authState"])).toEqual([
						{ id: "mixed", authState: "mixed" },
						{ id: "other", authState: "oidc" },
						{ id: "owner", authState: "credential" },
						{ id: "plain", authState: "none" },
					]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"scopes backups and saved views to their owner without artifact keys",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const backups = table("backupRun", "backups");
					const [backup, ...rest] = rowsOf(
						yield* service.executeForUser("owner", null, "kernel", {
							source: {
								kind: "inline",
								document: { queries: { rows: rows(backups, { fields: [star(backups)] }) } },
							},
						}),
					).items;

					expect(rest).toEqual([]);
					expect(backup).toMatchObject({ id: "backup-owner", artifactProvider: "local" });
					expect(Object.values(backup ?? {})).not.toContain("secret-key");
					expect(yield* readRows(other, "backupRun", ["id"])).toEqual([{ id: "backup-other" }]);
					expect(yield* readRows(owner, "savedView", ["id"])).toEqual([
						{ id: builtinSavedViewId("owner", definitionOwner("system-plugin"), "system-home") },
						{ id: builtinSavedViewId("owner", definitionOwner("private-plugin"), "private-home") },
						{
							id: builtinSavedViewId("owner", definitionOwner("disabled-plugin"), "disabled-home"),
						},
						{ id: "view-component" },
						{ id: "view-kernel" },
						{ id: "view-plugin-component" },
					]);
					expect(yield* readRows(other, "savedView", ["id"])).toEqual([
						{ id: builtinSavedViewId("other", definitionOwner("system-plugin"), "system-home") },
					]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"withholds results above the byte budget across named queries",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const views = table("savedView", "views");
					const viewRows = rows(views, {
						orderBy: [descending(column(views, "id"))],
						fields: [field("id", column(views, "id"))],
					});
					const execute = (queries: RyotQLDocument["queries"], resultBytes: number) =>
						service.executeForUser(
							"owner",
							null,
							"kernel",
							{ source: { kind: "inline", document: { queries } } },
							"standard",
							resultBytes,
						);

					let fitting = 1;
					while (Result.isFailure(yield* Effect.result(execute({ rows: viewRows }, fitting)))) {
						fitting *= 2;
					}
					expect(rowsOf(yield* execute({ rows: viewRows }, fitting)).items).toEqual([
						{ id: "view-plugin-component" },
						{ id: "view-kernel" },
						{ id: "view-component" },
						{
							id: builtinSavedViewId("owner", definitionOwner("disabled-plugin"), "disabled-home"),
						},
						{ id: builtinSavedViewId("owner", definitionOwner("private-plugin"), "private-home") },
						{ id: builtinSavedViewId("owner", definitionOwner("system-plugin"), "system-home") },
					]);
					expect(yield* Effect.flip(execute({ rows: viewRows }, fitting / 2))).toMatchObject({
						reason: { limitBytes: fitting / 2, code: "result-too-large" },
					});
					expect(
						yield* Effect.flip(execute({ rows: viewRows, again: viewRows }, fitting)),
					).toMatchObject({ reason: { limitBytes: fitting, code: "result-too-large" } });
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"reads plugin revision metadata and redacted installation projections",
			() =>
				Effect.gen(function* () {
					expect(
						(yield* readRows(owner, "plugin", [
							"id",
							"description",
							"configSchema",
							"activeRevisionId",
						])).find((row) => row["id"] === "system-plugin"),
					).toEqual({
						id: "system-plugin",
						activeRevisionId: "system-plugin-revision",
						description: `${systemPluginName} description`,
						configSchema: { fields: {}, unknownKeys: "strict" },
					});
					expect(
						(yield* readRows("admin", "plugin", ["id", "environmentConfigRevisionId"])).find(
							(row) => row["id"] === "system-plugin",
						),
					).toEqual({ id: "system-plugin", environmentConfigRevisionId: "system-env" });
					expect(
						(yield* readRows(owner, "pluginInstallation", [
							"id",
							"config",
							"healthReason",
							"configuredSecrets",
						])).find((row) => row["id"] === "owner-private"),
					).toEqual({
						id: "owner-private",
						healthReason: "configured",
						config: { visible: "yes" },
						configuredSecrets: ["token"],
					});
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"never exposes secret config defaults through plugin or readiness reads",
			() =>
				Effect.gen(function* () {
					const secretDefault = "default-secret-value";
					yield* insertPlugin({
						slug: "secret",
						homeView: null,
						ownerId: "owner",
						id: "secret-plugin",
						configSchema: {
							unknownKeys: "strict",
							fields: {
								apiToken: {
									secret: true,
									type: "string",
									label: "API token",
									description: "API token",
									defaultValue: secretDefault,
								},
							},
						},
					});
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						Effect.gen(function* () {
							yield* db
								.insert(pluginInstallation)
								.values({ userId: "owner", id: "owner-secret", pluginId: "secret-plugin" });
							yield* db
								.insert(pluginConfigRevision)
								.values(
									configRevision("secret-config", "secret-plugin-revision", ["apiToken"], {
										ownerUserId: "owner",
										pluginInstallationId: "owner-secret",
									}),
								);
							yield* db
								.update(pluginInstallation)
								.set({ health: "ready", activeConfigRevisionId: "secret-config" })
								.where(eq(pluginInstallation.id, "owner-secret"));
							yield* db
								.insert(definitionImportSource)
								.values(
									importSourceDefinition("import-secret", "secret-plugin", [], "private.import"),
								);
						}),
					);
					for (const audience of ["kernel", "plugin"] as const) {
						const row = (yield* readRows({ audience, userId: "owner" }, "plugin", [
							"id",
							"configSchema",
						])).find((item) => item["id"] === "secret-plugin");
						expect(row).toEqual({
							id: "secret-plugin",
							configSchema: {
								unknownKeys: "strict",
								fields: {
									apiToken: {
										secret: true,
										type: "string",
										label: "API token",
										description: "API token",
									},
								},
							},
						});
					}
					const source = (yield* readRows(owner, "importSource", ["id", "readinessMetadata"])).find(
						(item) => item["id"] === "import-secret",
					);
					expect(source?.["readinessMetadata"]).toMatchObject({
						availableConfigKeys: ["apiToken"],
					});
					expect(stableStringify(source)).not.toContain(secretDefault);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"derives the effective home view from usable selections and manifest defaults",
			() =>
				Effect.gen(function* () {
					const expected = [
						{ id: "installed", homeSavedView: null },
						{ id: "other-private", homeSavedView: null },
						{
							id: "other-system",
							homeSavedView: { kind: "plugin", slug: "system-home", pluginId: "system-plugin" },
						},
						{ homeSavedView: null, id: "owner-disabled" },
						{
							id: "owner-private",
							homeSavedView: { kind: "plugin", slug: "private-home", pluginId: "private-plugin" },
						},
						{ id: "owner-system", homeSavedView: { kind: "custom", savedViewId: "view-kernel" } },
						{ id: "uninstalled", homeSavedView: null },
					];

					expect(yield* readRows("admin", "pluginInstallation", ["id", "homeSavedView"])).toEqual(
						expected,
					);
					expect(
						yield* readRows({ userId: "owner", audience: "plugin" }, "pluginInstallation", [
							"id",
							"homeSavedView",
						]),
					).toEqual(expected.filter(({ id }) => id === "installed" || id.startsWith("owner-")));
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"exposes only effective definitions to their user in every audience",
			() =>
				Effect.gen(function* () {
					for (const audience of ["kernel", "plugin"] as const) {
						expect(
							yield* readRows({ audience, userId: "owner" }, "entitySchema", [
								"id",
								"pluginId",
								"mergeIdentityProperties",
							]),
						).toEqual([
							{ pluginId: null, id: "kernel-entity", mergeIdentityProperties: ["name"] },
							{
								id: "private-entity",
								pluginId: "private-plugin",
								mergeIdentityProperties: ["name"],
							},
							{ id: "system-entity", pluginId: "system-plugin", mergeIdentityProperties: ["name"] },
						]);
					}
					expect(yield* readRows(other, "entitySchema", ["id"])).toEqual([
						{ id: "kernel-entity" },
						{ id: "other-entity" },
						{ id: "system-entity" },
					]);
					expect(
						yield* readRows(owner, "eventSchema", ["id", "pluginId", "entitySchemaSlug"]),
					).toEqual([
						{ pluginId: null, id: "kernel-event", entitySchemaSlug: "kernel-entity" },
						{ id: "system-event", pluginId: "system-plugin", entitySchemaSlug: "system-entity" },
					]);
					expect(yield* readRows(owner, "relationshipSchema", ["id"])).toEqual([
						{ id: "kernel-link" },
						{ id: "private-link" },
					]);
					expect(yield* readRows(other, "relationshipSchema", ["id"])).toEqual([
						{ id: "kernel-link" },
					]);
					expect(
						yield* readRows(other, "signalSchema", ["id", "pluginId", "catalogState"]),
					).toEqual([{ id: "system.signal", catalogState: "active", pluginId: "system-plugin" }]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"derives import source readiness and integration provider scripts",
			() =>
				Effect.gen(function* () {
					expect(
						yield* readRows(owner, "importSource", [
							"id",
							"missingPluginConfigKeys",
							"isStartable",
						]),
					).toEqual([
						{ isStartable: true, id: "import-private", missingPluginConfigKeys: [] },
						{
							isStartable: false,
							id: "import-sys-missing",
							missingPluginConfigKeys: [
								pluginConfigEnvironmentKey(systemPackageId, "clientSecret"),
							],
						},
						{ isStartable: false, id: "import-sys-no-script", missingPluginConfigKeys: [] },
						{ isStartable: true, id: "import-sys-ready", missingPluginConfigKeys: [] },
						{
							isStartable: true,
							missingPluginConfigKeys: [],
							id: `kernel:data-json:${owner.userId}`,
						},
					]);
					expect(yield* readRows(other, "importSource", ["id"])).not.toContainEqual({
						id: "import-private",
					});
					expect(
						yield* readRows(owner, "integrationProvider", ["id", "lot", "hasScript", "plan"]),
					).toEqual([
						{ plan: null, lot: "sink", hasScript: true, id: `kernel:data-json:${owner.userId}` },
						{ plan: null, lot: "yank", hasScript: false, id: "provider-missing" },
						{ plan: null, lot: "push", hasScript: true, id: "provider-push" },
						{
							lot: "yank",
							hasScript: true,
							id: "provider-yank",
							plan: { selections: { collector: { value: "remote" } } },
						},
					]);
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"never returns sandbox script bodies to admins",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const scripts = table("sandboxScript", "scripts");
					const items = rowsOf(
						yield* service.executeForAdmin({
							source: {
								kind: "inline",
								document: { queries: { rows: rows(scripts, { fields: [star(scripts)] }) } },
							},
						}),
					).items;

					expect(items).toHaveLength(4);
					for (const item of items) {
						expect(Object.values(item)).not.toContain("private-source");
						expect(Object.values(item)).not.toContain("private-code");
					}
				}),
			testTimeout,
		);
	},
);

const matchSource = table("entity", "source");

const matchingIds = Effect.fn(function* (userId: string, where: Predicate) {
	const service = yield* RyotQLService;
	const response = yield* service.executeForUser(userId, null, "kernel", {
		source: {
			kind: "inline",
			document: {
				queries: {
					rows: rows(matchSource, {
						orderBy: [ascending(column(matchSource, "id"))],
						fields: [field("id", column(matchSource, "id"))],
						where: and(inArray(column(matchSource, "userId"), [literal(userId)]), where),
					}),
				},
			},
		},
	});
	return rowsOf(response).items;
});

const ids = (values: readonly string[]) => values.map((id) => ({ id }));

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"ryotql catalog harness",
	(test) => {
		test.effect(
			"matches text prefixes and substrings with literal pattern characters",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db.insert(entity).values([
							...(
								[
									["a", "Alphabet"],
									["b", "the alphabet"],
									["c", "a\\%b tail"],
									["d", "a%b tail"],
									["e", "a\\Zb tail"],
									["f", "\\lead"],
									["g", "_x tail"],
									["h", "yx tail"],
									["i", "%pct"],
									["j", "mid a\\%b _x"],
								] as const
							).map(([id, name]) => ({ id, name, userId: "plain", entitySchemaSlug: "probe" })),
							...(
								[
									["p01", "Alphabet", "ALPHA"],
									["p02", "the alphabet", "alpha"],
									["p03", "a\\%b tail", "a\\%b"],
									["p04", "a%b tail", "a\\%b"],
									["p05", "a\\Zb tail", "a\\%b"],
									["p06", "x a\\%b", "a\\%b"],
									["p07", "\\lead", "\\"],
									["p08", "%lead", "\\"],
									["p09", "_x tail", "_x"],
									["p10", "yx tail", "_x"],
									["p11", "%pct", "%"],
									["p12", "no pct", "%"],
									["p13", "a %", "%"],
								] as const
							).map(([id, name, entitySchemaSlug]) => ({
								id,
								name,
								userId: "mixed",
								entitySchemaSlug,
								externalId: id === "p01" ? "ext-1" : null,
							})),
						]),
					);
					const name = column(matchSource, "name");
					const slug = column(matchSource, "entitySchemaSlug");
					const externalId = column(matchSource, "externalId");
					const pairs = [
						"p01",
						"p02",
						"p03",
						"p04",
						"p05",
						"p06",
						"p07",
						"p08",
						"p09",
						"p10",
						"p11",
						"p12",
						"p13",
					];
					const cases: readonly {
						readonly nullNeedle: string;
						readonly columns: readonly string[];
						readonly literals: readonly (readonly [string, readonly string[]])[];
						readonly match: (left: ScalarExpression, right: ScalarExpression) => Predicate;
					}[] = [
						{
							match: startsWith,
							nullNeedle: "ext",
							columns: ["p01", "p03", "p07", "p09", "p11"],
							literals: [
								["alpha", ["a"]],
								["ALPHA", ["a"]],
								["a\\%b", ["c"]],
								["\\", ["f"]],
								["_x", ["g"]],
								["%", ["i"]],
							],
						},
						{
							match: contains,
							nullNeedle: "xt-",
							columns: ["p01", "p02", "p03", "p06", "p07", "p09", "p11", "p13"],
							literals: [
								["alpha", ["a", "b"]],
								["ALPHA", ["a", "b"]],
								["a\\%b", ["c", "j"]],
								["\\", ["c", "e", "f", "j"]],
								["_x", ["g", "j"]],
								["%", ["c", "d", "i", "j"]],
							],
						},
					];
					for (const { match, columns, literals, nullNeedle } of cases) {
						for (const [needle, expected] of literals) {
							expect(yield* matchingIds("plain", match(name, literal(needle)))).toEqual(
								ids(expected),
							);
						}
						expect(yield* matchingIds("mixed", match(name, slug))).toEqual(ids(columns));
						expect(yield* matchingIds("mixed", match(externalId, literal(nullNeedle)))).toEqual(
							ids(["p01"]),
						);
						expect(
							yield* matchingIds("mixed", not(match(externalId, literal(nullNeedle)))),
						).toEqual(ids(pairs.slice(1)));
						expect(yield* matchingIds("mixed", not(match(externalId, slug)))).toEqual(ids(pairs));
						expect(yield* matchingIds("mixed", not(match(name, externalId)))).toEqual(ids(pairs));
					}
				}),
			testTimeout,
		);
	},
);

layer(catalogDatabaseLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"entity presentation resolution",
	(test) => {
		test.effect(
			"hydrates owner and entity data from declarations and honors captured revisions",
			() =>
				Effect.gen(function* () {
					const service = yield* RyotQLService;
					const session = yield* DatabaseSession;
					const subject = table("entity", "entity");
					const client = {
						homeView: null,
						apiVersion: CLIENT_API_VERSION,
						exports: {
							card: {
								kind: "presentation",
								entry: "client/card.tsx",
								automaticEntityPresentations: false,
							},
						},
						entities: {
							card: {
								gridPresentation: "card",
								presentation: {
									entity: [field("title", column(subject, "name"))],
									owner: [
										field("title", column(subject, "name")),
										field("owner", column(subject, "userId")),
									],
								},
							},
						},
					} satisfies NonNullable<PluginManifest["client"]>;
					yield* insertPlugin({
						client,
						ownerId: null,
						homeView: null,
						slug: "presentation",
						id: "presentation-plugin",
					});
					yield* session.run((db) =>
						Effect.gen(function* () {
							yield* db
								.insert(pluginInstallation)
								.values({
									userId: "owner",
									health: "ready",
									id: "presentation-install",
									pluginId: "presentation-plugin",
								});
							yield* db
								.insert(definitionEntitySchema)
								.values({ ...entitySchemaDefinition("card", "presentation-plugin") });
							yield* db.insert(entity).values([
								{
									name: "Visible",
									userId: "owner",
									id: "presentation-one",
									entitySchemaSlug: "card",
									entitySchemaPluginId: "presentation-plugin",
								},
								{
									name: "Private",
									userId: "other",
									id: "presentation-other",
									entitySchemaSlug: "card",
									entitySchemaPluginId: "presentation-plugin",
								},
							]);
							const pinned = {
								...manifest("presentation", null, PluginPackageId.make("test/presentation")),
								client: {
									...client,
									entities: {
										card: {
											...client.entities.card,
											presentation: {
												...client.entities.card.presentation,
												entity: [field("title", literal("Captured"))],
											},
										},
									},
								},
							};
							yield* insertPluginRevision(db, {
								manifest: pinned,
								id: "presentation-captured",
								pluginId: "presentation-plugin",
								contentHash: "presentation-captured",
							});
						}),
					);
					const document = (scope: "owner" | "entity") => ({
						queries: {
							rows: rows(subject, {
								presentation: { scope, entityId: "id" },
								fields: [field("id", column(subject, "id"))],
								where: queryEq(
									column(subject, "entitySchemaPluginId"),
									literal("presentation-plugin"),
								),
							}),
						},
					});
					const privateResult = yield* service.executeForUser("owner", null, "kernel", {
						source: { kind: "inline", document: document("owner") },
					});
					expect(rowsOf(privateResult).items).toHaveLength(1);
					expect(rowsOf(privateResult).items[0]).toMatchObject({
						__entityPresentation: {
							scope: "owner",
							schemaSlug: "card",
							pluginId: "presentation-plugin",
							data: { owner: "owner", title: "Visible" },
						},
					});
					const publicResult = yield* service.executeDeclared(
						{ language: null, userId: "owner" },
						document("entity"),
						{},
						100000,
						{ "presentation-plugin": "presentation-captured" },
					);
					expect(rowsOf(publicResult).items).toHaveLength(1);
					expect(rowsOf(publicResult).items[0]?.["__entityPresentation"]).toMatchObject({
						scope: "entity",
						data: { title: "Captured" },
						context: { settings: null },
					});
					expect(rowsOf(publicResult).items[0]?.["__entityPresentation"]).not.toHaveProperty(
						"data.owner",
					);
				}),
			testTimeout,
		);
	},
);
