import { expect, layer } from "@effect/vitest";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	CLIENT_API_VERSION,
	type PluginConfigSchema,
	type PluginManifest,
} from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { builtinSavedViewId, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type {
	Predicate,
	RowItem,
	RyotQLDocument,
	RyotQLResponse,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/language";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	NotificationSubscriptionId,
	PluginPackageId,
	SavedViewId,
	SignalSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	contains,
	descending,
	field,
	inArray,
	literal,
	not,
	rows,
	star,
	startsWith,
	table,
} from "@ryot-app/ryotql";
import {
	automationHistoryRunRecipe,
	automationHistoryRunsRecipe,
} from "@ryot-app/ryotql-recipes/automation-history";
import { entityDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { importSourcesRecipe } from "@ryot-app/ryotql-recipes/import-sources";
import {
	instanceAdminUsersRecipe,
	migrationReportRecipe,
} from "@ryot-app/ryotql-recipes/instance-admin";
import { oauthConnectionStatusRecipe } from "@ryot-app/ryotql-recipes/oauth-connections";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { twoFactorStatusRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Option, Result } from "effect";
import { assert } from "vitest";

import { redactPluginConfig } from "#modules/plugins/configuration/redaction";
import {
	fixtureManifest,
	insertPluginRevision,
	testPluginPackageId,
} from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import { account, user } from "#schema/tables/auth";
import {
	automationRun,
	automationRunAttempt,
	automationTrigger,
	automationTriggerRecipient,
	notificationSubscription,
} from "#schema/tables/automations";
import { backgroundWork } from "#schema/tables/background-work";
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
import { entity } from "#schema/tables/entities";
import { eventProjection } from "#schema/tables/event-projections";
import { eventStream, eventStreamWork } from "#schema/tables/event-streams";
import { event } from "#schema/tables/events";
import { migrationReport } from "#schema/tables/migration-reports";
import { oauthConnection } from "#schema/tables/oauth-connections";
import { savedView, savedViewOverride } from "#schema/tables/views";
import { makeConfigProviderLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import type { RyotQLAudience } from "./catalog";
import { RyotQLService } from "./service";

const occurredAt = new Date(0);
const futureExpiry = new Date("2100-01-01T00:00:00Z");
const systemPluginName = "media-hub";
const systemPackageId = PluginPackageId.make("ryot/fixture-hub");

const trigger = (id: string) => ({
	id,
	depth: 0,
	occurredAt,
	executionId: id,
	rootExecutionId: id,
	source: "api" as const,
	operation: "emit" as const,
	category: "signal" as const,
	lane: "interactive" as const,
	resourceKind: "signal" as const,
	initiatorKind: "system" as const,
	payload: {
		properties: {},
		actorUserId: null,
		signalSchemaPluginId: null,
		operation: "emit" as const,
		resource: "signal" as const,
		category: "signal" as const,
		signalSchemaSlug: SignalSchemaSlug.make("fixture.signal"),
	},
});

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
}) {
	const revisionId = `${input.id}-revision`;
	const packageId =
		input.slug === systemPluginName ? systemPackageId : PluginPackageId.make(`test/${input.slug}`);
	const revisionManifest = {
		...manifest(input.slug, input.homeView, packageId),
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

const run = (
	id: string,
	input: Partial<typeof automationRun.$inferInsert> = {},
): typeof automationRun.$inferInsert => ({
	id,
	hookSlug: id,
	hookName: id,
	stage: "after",
	attemptCount: 1,
	status: "failed",
	delivery: "async",
	queuedAt: occurredAt,
	triggerId: "trigger-a",
	executionUserId: "owner",
	scriptContentHash: "hash",
	scriptSlug: "kernel.notify",
	artifactsExpireAt: futureExpiry,
	sandboxScriptId: "kernel-script",
	retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
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
					issuer: "issuer",
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
			yield* db.insert(eventStream).values([
				{
					revision: 4,
					userId: "owner",
					id: "stream-owner",
					eventSchemaSlug: "record-set",
					entityId: "stream-entity-owner",
				},
				{
					revision: 2,
					userId: "other",
					id: "stream-other",
					eventSchemaSlug: "record-set",
					entityId: "stream-entity-other",
				},
			]);
			yield* db.insert(eventStreamWork).values([
				{
					id: "stream-owner",
					completedRevision: 4,
					pluginPin: { private: "owner-plugin-pin" },
					accountToken: "owner-private-account-token",
					pluginRevisionId: "owner-private-plugin-revision",
					outputSchema: { fields: {}, unknownKeys: "strict" },
					processorScriptId: "owner-private-processor-script",
				},
				{
					id: "stream-other",
					completedRevision: null,
					pluginPin: { private: "other-plugin-pin" },
					accountToken: "other-private-account-token",
					pluginRevisionId: "other-private-plugin-revision",
					outputSchema: { fields: {}, unknownKeys: "strict" },
					processorScriptId: "other-private-processor-script",
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
			yield* db.insert(automationTrigger).values([trigger("trigger-a"), trigger("trigger-b")]);
			yield* db.insert(automationTriggerRecipient).values([
				{ userId: "owner", triggerId: "trigger-b" },
				{ userId: "other", triggerId: "trigger-a" },
				{ userId: "owner", triggerId: "trigger-a" },
			]);
			yield* db
				.insert(automationRun)
				.values([
					run("run-eligible", { historyPayload: { shown: true } }),
					run("run-before", { stage: "before", retryPolicy: null, delivery: "policy" }),
					run("run-succeeded", { status: "succeeded" }),
					run("run-expired", { artifactsExpireAt: occurredAt }),
					run("run-missing", {
						sandboxScriptId: null,
						pluginId: "system-plugin",
						pluginConfigRevisionId: "system-env",
						pluginRevisionId: "system-plugin-revision",
					}),
					run("run-other", { triggerId: "trigger-b", executionUserId: "other" }),
				]);
			yield* db.execute(
				sql`update automation_run set queued_at = queued_at + (case id when 'run-eligible' then 100 when 'run-missing' then 200 when 'run-before' then 300 when 'run-succeeded' then 400 when 'run-expired' then 500 else 0 end) * interval '1 millisecond'`,
			);
			yield* db.insert(automationRunAttempt).values(
				[
					{ id: "attempt-owner", runId: "run-eligible" },
					{ runId: "run-other", id: "attempt-other" },
				].map(({ id, runId }) => ({
					id,
					runId,
					attemptNumber: 1,
					retryable: false,
					startedAt: occurredAt,
					finishedAt: occurredAt,
					status: "failed" as const,
					workflowExecutionId: `workflow-${id}`,
					logs: [{ message: "raw", level: "info" as const }],
					historyLogs: [{ message: "projected", level: "info" as const }],
				})),
			);
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

layer(catalogDatabaseLayer)((test) => {
	test.effect(
		"hides projection data and readiness when its installation is unhealthy or plugin is inactive",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db
						.update(pluginInstallation)
						.set({ health: "ready" })
						.where(eq(pluginInstallation.id, "owner-system")),
				);
				yield* session.run((db) =>
					db
						.insert(event)
						.values({
							occurredAt,
							properties: {},
							userId: "owner",
							id: "projection-gate",
							eventSchemaSlug: "projected",
							entityId: "stream-entity-owner",
							eventSchemaPluginId: "system-plugin",
						}),
				);
				yield* session.run((db) =>
					db
						.insert(eventStream)
						.values({
							revision: 1,
							userId: "owner",
							id: "projection-gate-stream",
							eventSchemaSlug: "projected",
							entityId: "stream-entity-owner",
							eventSchemaPluginId: "system-plugin",
						}),
				);
				yield* session.run((db) =>
					db
						.insert(eventStreamWork)
						.values({
							completedRevision: 1,
							accountToken: "generation",
							id: "projection-gate-stream",
							outputSchema: { fields: {} },
							processorScriptId: "processor",
							pluginRevisionId: "system-plugin-revision",
							pluginPin: { configRevisionId: "system-env" },
						}),
				);
				yield* session.run((db) =>
					db
						.insert(eventProjection)
						.values({
							properties: { score: 4 },
							eventId: "projection-gate",
							streamId: "projection-gate-stream",
						}),
				);
				expect(yield* readRows(owner, "event", ["id", "projection", "projectionStatus"])).toEqual([
					{ id: "projection-gate", projection: { score: 4 }, projectionStatus: "ready" },
				]);
				yield* session.run((db) =>
					db
						.update(pluginInstallation)
						.set({ health: "failed" })
						.where(eq(pluginInstallation.id, "owner-system")),
				);
				expect(yield* readRows(owner, "event", ["id", "projection", "projectionStatus"])).toEqual([
					{ projection: null, id: "projection-gate", projectionStatus: "none" },
				]);
				yield* session.run((db) =>
					db
						.update(pluginInstallation)
						.set({ health: "ready" })
						.where(eq(pluginInstallation.id, "owner-system")),
				);
				yield* session.run((db) =>
					db.update(plugin).set({ status: "disabled" }).where(eq(plugin.id, "system-plugin")),
				);
				expect(yield* readRows(owner, "event", ["id", "projection", "projectionStatus"])).toEqual([
					{ projection: null, id: "projection-gate", projectionStatus: "none" },
				]);
			}),
	);
});
const other = { userId: "other", audience: "kernel" } as const;

layer(catalogDatabaseLayer)((test) => {
	test.effect(
		"projects password availability and nullable two-factor state for the current user",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const recipe = twoFactorStatusRecipe();
				for (const [userId, available] of [
					["owner", true],
					["mixed", true],
					["other", false],
					["plain", false],
				] as const) {
					const response = yield* service.executeForUser(userId, null, "kernel", recipe.document);
					expect(Result.getOrThrow(recipe.decode(response))).toEqual({ available, enabled: false });
				}
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, "owner")),
				);
				expect(
					Result.getOrThrow(
						recipe.decode(yield* service.executeForUser("owner", null, "kernel", recipe.document)),
					),
				).toEqual({ enabled: true, available: true });
			}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("reads owned OAuth status with query-time expiry and no credential fields", () =>
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
				const recipe = oauthConnectionStatusRecipe({ id });
				expect(
					Result.getOrThrow(
						recipe.decode(yield* service.executeForUser("owner", null, "kernel", recipe.document)),
					),
				).toEqual(Option.some(status));
				expect(
					Result.getOrThrow(
						recipe.decode(yield* service.executeForUser("other", null, "kernel", recipe.document)),
					),
				).toEqual(Option.none());
			}
			const missing = oauthConnectionStatusRecipe({ id: "missing" });
			expect(
				Result.getOrThrow(
					missing.decode(yield* service.executeForUser("owner", null, "kernel", missing.document)),
				),
			).toEqual(Option.none());
			const connection = table("oauthConnection", "connection");
			const response = yield* service.executeForUser("owner", null, "kernel", {
				queries: { rows: rows(connection, { fields: [star(connection)] }) },
			});
			expect(rowsOf(response).items.find(({ id }) => id === "failed")).toEqual({
				id: "failed",
				status: "failed",
			});
		}),
	);
});

const readRows = Effect.fn(function* (
	reader: Reader,
	tableName: string,
	fieldNames: readonly string[],
) {
	const service = yield* RyotQLService;
	const source = table(tableName, "source");
	const document = {
		queries: {
			rows: rows(source, { fields: fieldNames.map((name) => field(name, column(source, name))) }),
		},
	};
	return rowsOf(
		yield* reader === "admin"
			? service.executeForAdmin(document)
			: service.executeForUser(reader.userId, null, reader.audience, document),
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
					rows: {
						...query,
						output: { ...query.output, pagination: { limit: 1, ...(after ? { after } : {}) } },
					},
				},
			};
			const page = rowsOf(
				yield* reader === "admin"
					? service.executeForAdmin(document)
					: service.executeForUser(reader.userId, null, reader.audience, document),
			);
			items.push(...page.items);
			after = page.pageInfo.nextCursor ?? undefined;
		} while (after);
		return items;
	});

layer(catalogDatabaseLayer)((test) => {
	test.effect("reports no projection for source events without a projection declaration", () =>
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
			expect(yield* readRows(owner, "event", ["id", "projection", "projectionStatus"])).toEqual([
				{ projection: null, projectionStatus: "none", id: "projection-source-owner" },
			]);
			expect(yield* readRows(other, "event", ["id", "projection", "projectionStatus"])).toEqual([]);
		}),
	);

	test.effect("executes automation history filters against persisted runs", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const read = (input: Parameters<typeof automationHistoryRunsRecipe>[0]) =>
				Effect.map(
					service.executeForUser(
						"owner",
						null,
						"kernel",
						automationHistoryRunsRecipe(input).document,
					),
					(response) =>
						Result.getOrThrow(automationHistoryRunsRecipe(input).decode(response)).items.map(
							({ id }) => id,
						),
				);
			expect(
				yield* read({
					limit: 10,
					stage: "after",
					status: "failed",
					to: "1970-01-02",
					from: "1969-12-31",
					triggerId: "trigger-a",
					hookSlug: "run-missing",
					pluginId: "system-plugin",
				}),
			).toEqual(["run-missing"]);
			expect(yield* read({ limit: 10, from: "1970-01-02" })).toEqual([]);
			expect(yield* read({ limit: 10, to: "1969-12-31" })).toEqual([]);
			expect(yield* read({ limit: 10 })).toEqual([
				"run-expired",
				"run-succeeded",
				"run-before",
				"run-missing",
				"run-eligible",
			]);
		}),
	);

	test.effect("executes recipe documents and decodes correlated includes and admin totals", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const userRecipe = entityDefinitionsRecipe({ limit: 20 });
			const entities = Result.getOrThrow(
				userRecipe.decode(
					yield* service.executeForUser("owner", null, "kernel", userRecipe.document),
				),
			);
			expect(
				entities.items.find(({ slug }) => slug === "kernel-entity")?.eventSchemas.items,
			).toMatchObject([{ slug: "kernel-event" }]);

			const sourcesRecipe = importSourcesRecipe({ limit: 20 });
			const sources = Result.getOrThrow(
				sourcesRecipe.decode(
					yield* service.executeForUser("owner", null, "kernel", sourcesRecipe.document),
				),
			);
			expect(sources.items.find(({ slug }) => slug === "import-sys-ready")).toMatchObject({
				isStartable: true,
				workflowSlug: "import",
			});

			const installationsRecipe = pluginInstallationsRecipe({ limit: 20 });
			const installations = Result.getOrThrow(
				installationsRecipe.decode(
					yield* service.executeForUser("owner", null, "kernel", installationsRecipe.document),
				),
			);
			expect(
				installations.items.find(({ packageId }) => packageId === "test/private")
					?.configuredSecrets,
			).toEqual(["token"]);

			const runRecipe = automationHistoryRunRecipe({ id: "run-eligible" });
			const runDetail = Result.getOrThrow(
				runRecipe.decode(
					yield* service.executeForUser("owner", null, "kernel", runRecipe.document),
				),
			);
			expect(Option.isSome(runDetail)).toBe(true);
			if (Option.isSome(runDetail)) {
				expect(runDetail.value.trigger.payload).toEqual({ shown: true });
				expect(runDetail.value.attempts[0]?.logs).toEqual([
					{ level: "info", message: "projected" },
				]);
			}

			const usersRecipe = instanceAdminUsersRecipe({ limit: 2, search: "example.test" });
			const users = Result.getOrThrow(
				usersRecipe.decode(yield* service.executeForAdmin(usersRecipe.document)),
			);
			expect(users.total).toBe(4);
			expect(users.pageInfo.hasMore).toBe(true);

			const reportRecipe = migrationReportRecipe({ limit: 3 });
			const report = Result.getOrThrow(
				reportRecipe.decode(yield* service.executeForAdmin(reportRecipe.document)),
			);
			expect(report.items.map(({ level }) => level)).toEqual(["warning", "warning", "info"]);
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("pages numeric primary keys with admin cursors and derives detail totals", () =>
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
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("pages timestamp cursors at full database precision", () =>
		Effect.gen(function* () {
			const runs = table("automationRun", "runs");
			const queuedAt = column(runs, "queuedAt");
			const fields = [field("id", column(runs, "id"))];
			const queuedOrder = [
				{ id: "run-eligible" },
				{ id: "run-missing" },
				{ id: "run-before" },
				{ id: "run-succeeded" },
				{ id: "run-expired" },
			];

			expect(
				yield* collectPages(rows(runs, { fields, orderBy: [ascending(queuedAt)] }), owner),
			).toEqual(queuedOrder);
			expect(
				yield* collectPages(rows(runs, { fields, orderBy: [descending(queuedAt)] }), owner),
			).toEqual(queuedOrder.toReversed());
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("pages composite primary keys with every key column as a tie breaker", () =>
		Effect.gen(function* () {
			const recipient = table("automationTriggerRecipient", "recipient");
			const fields = [star(recipient)];

			expect(yield* collectPages(rows(recipient, { fields, orderBy: [] }))).toEqual([
				{ userId: "other", triggerId: "trigger-a" },
				{ userId: "owner", triggerId: "trigger-a" },
				{ userId: "owner", triggerId: "trigger-b" },
			]);
			expect(
				yield* collectPages(
					rows(recipient, { fields, orderBy: [descending(column(recipient, "userId"))] }),
				),
			).toEqual([
				{ userId: "owner", triggerId: "trigger-a" },
				{ userId: "owner", triggerId: "trigger-b" },
				{ userId: "other", triggerId: "trigger-a" },
			]);
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("exposes the private installation configuration pin to admin readers", () =>
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
	);
	test.effect("hides uninstalled installations from users but not from admins", () =>
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
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("expands admin-only fields only for admin wildcards", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const subscription = table("notificationSubscription", "subscription");
			const document = { queries: { rows: rows(subscription, { fields: [star(subscription)] }) } };

			const [userItem] = rowsOf(
				yield* service.executeForUser("owner", null, "kernel", document),
			).items;
			const [adminItem] = rowsOf(yield* service.executeForAdmin(document)).items;

			expect(userItem).not.toHaveProperty("userId");
			expect(adminItem).toMatchObject({ userId: "owner", id: "subscription" });
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("shows users only themselves and classifies auth state for admins", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const users = table("user", "users");
			const document = { queries: { rows: rows(users, { fields: [star(users)] }) } };

			expect(
				rowsOf(yield* service.executeForUser("owner", null, "kernel", document)).items,
			).toEqual([
				{
					id: "owner",
					image: null,
					name: "Owner",
					email: "owner@example.test",
					createdAt: expect.any(String),
					twoFactorStatus: { enabled: false, available: true },
					preferences: { language: null, disableIntegrations: false },
				},
			]);
			expect(yield* readRows("admin", "user", ["id", "authState"])).toEqual([
				{ id: "mixed", authState: "mixed" },
				{ id: "other", authState: "oidc" },
				{ id: "owner", authState: "credential" },
				{ id: "plain", authState: "none" },
			]);
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("scopes backups and saved views to their owner without artifact keys", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const backups = table("backupRun", "backups");
			const [backup, ...rest] = rowsOf(
				yield* service.executeForUser("owner", null, "kernel", {
					queries: { rows: rows(backups, { fields: [star(backups)] }) },
				}),
			).items;

			expect(rest).toEqual([]);
			expect(backup).toMatchObject({ id: "backup-owner", artifactProvider: "local" });
			expect(Object.values(backup ?? {})).not.toContain("secret-key");
			expect(yield* readRows(other, "backupRun", ["id"])).toEqual([{ id: "backup-other" }]);
			expect(yield* readRows(owner, "savedView", ["id"])).toEqual([
				{ id: builtinSavedViewId("owner", definitionOwner("system-plugin"), "system-home") },
				{ id: builtinSavedViewId("owner", definitionOwner("private-plugin"), "private-home") },
				{ id: builtinSavedViewId("owner", definitionOwner("disabled-plugin"), "disabled-home") },
				{ id: "view-component" },
				{ id: "view-kernel" },
				{ id: "view-plugin-component" },
			]);
			expect(yield* readRows(other, "savedView", ["id"])).toEqual([
				{ id: builtinSavedViewId("other", definitionOwner("system-plugin"), "system-home") },
			]);
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("withholds results above the byte budget across named queries", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const views = table("savedView", "views");
			const viewRows = rows(views, {
				orderBy: [descending(column(views, "id"))],
				fields: [field("id", column(views, "id"))],
			});
			const execute = (queries: RyotQLDocument["queries"], resultBytes: number) =>
				service.executeForUser("owner", null, "kernel", { queries }, "standard", resultBytes);

			let fitting = 1;
			while (Result.isFailure(yield* Effect.result(execute({ rows: viewRows }, fitting)))) {
				fitting *= 2;
			}
			expect(rowsOf(yield* execute({ rows: viewRows }, fitting)).items).toEqual([
				{ id: "view-plugin-component" },
				{ id: "view-kernel" },
				{ id: "view-component" },
				{ id: builtinSavedViewId("owner", definitionOwner("disabled-plugin"), "disabled-home") },
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
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("reads plugin revision metadata and redacted installation projections", () =>
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
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("never exposes secret config defaults through plugin or readiness reads", () =>
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
						.values(importSourceDefinition("import-secret", "secret-plugin", [], "private.import"));
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
			expect(source?.["readinessMetadata"]).toMatchObject({ availableConfigKeys: ["apiToken"] });
			expect(stableStringify(source)).not.toContain(secretDefault);
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("derives the effective home view from usable selections and manifest defaults", () =>
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
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("exposes only effective definitions to their user in every audience", () =>
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
					{ id: "private-entity", pluginId: "private-plugin", mergeIdentityProperties: ["name"] },
					{ id: "system-entity", pluginId: "system-plugin", mergeIdentityProperties: ["name"] },
				]);
			}
			expect(yield* readRows(other, "entitySchema", ["id"])).toEqual([
				{ id: "kernel-entity" },
				{ id: "other-entity" },
				{ id: "system-entity" },
			]);
			expect(yield* readRows(owner, "eventSchema", ["id", "pluginId", "entitySchemaSlug"])).toEqual(
				[
					{ pluginId: null, id: "kernel-event", entitySchemaSlug: "kernel-entity" },
					{ id: "system-event", pluginId: "system-plugin", entitySchemaSlug: "system-entity" },
				],
			);
			expect(yield* readRows(owner, "relationshipSchema", ["id"])).toEqual([
				{ id: "kernel-link" },
				{ id: "private-link" },
			]);
			expect(yield* readRows(other, "relationshipSchema", ["id"])).toEqual([{ id: "kernel-link" }]);
			expect(yield* readRows(other, "signalSchema", ["id", "pluginId", "catalogState"])).toEqual([
				{ id: "system.signal", catalogState: "active", pluginId: "system-plugin" },
			]);
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("derives import source readiness and integration provider scripts", () =>
		Effect.gen(function* () {
			expect(
				yield* readRows(owner, "importSource", ["id", "missingPluginConfigKeys", "isStartable"]),
			).toEqual([
				{ isStartable: true, id: "import-private", missingPluginConfigKeys: [] },
				{
					isStartable: false,
					id: "import-sys-missing",
					missingPluginConfigKeys: [pluginConfigEnvironmentKey(systemPackageId, "clientSecret")],
				},
				{ isStartable: false, id: "import-sys-no-script", missingPluginConfigKeys: [] },
				{ isStartable: true, id: "import-sys-ready", missingPluginConfigKeys: [] },
				{ isStartable: true, missingPluginConfigKeys: [], id: `kernel:data-json:${owner.userId}` },
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
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("exposes one user-scoped background job catalog without execution authority", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db.insert(backgroundWork).values(
					[
						{ userId: "owner", id: "background-owner", purpose: "user-script" as const },
						{ userId: "other", id: "background-other", purpose: "event-projection" as const },
					].map((job) => ({
						id: job.id,
						key: job.id,
						scope: "subject",
						inputHash: job.id,
						userId: job.userId,
						purpose: job.purpose,
						pluginId: "system-plugin",
						status: "queued" as const,
						accountToken: "private-generation",
						payload: { authority: "private-authority" },
					})),
				),
			);
			for (const audience of ["kernel", "plugin"] satisfies readonly RyotQLAudience[]) {
				expect(
					yield* readRows({ audience, userId: "owner" }, "backgroundWork", [
						"id",
						"status",
						"scope",
					]),
				).toEqual([{ status: "queued", scope: "subject", id: "background-owner" }]);
				expect(yield* readRows({ audience, userId: "other" }, "backgroundWork", ["id"])).toEqual([
					{ id: "background-other" },
				]);
				for (const name of [
					"payload",
					"accountToken",
					"inputHash",
					"execution",
					"pluginPin",
					"checkpoint",
				]) {
					expect(
						Result.isFailure(
							yield* Effect.result(
								readRows({ audience, userId: "owner" }, "backgroundWork", [name]),
							),
						),
					).toBe(true);
				}
				expect(
					Result.isFailure(
						yield* Effect.result(readRows({ audience, userId: "owner" }, "userWork", ["id"])),
					),
				).toBe(true);
			}
		}),
	);

	test.effect("scopes event streams and work to their owner in kernel and plugin audiences", () =>
		Effect.gen(function* () {
			for (const audience of ["kernel", "plugin"] satisfies readonly RyotQLAudience[]) {
				expect(
					yield* readRows({ audience, userId: "owner" }, "eventStream", [
						"id",
						"entityId",
						"eventSchemaSlug",
						"eventSchemaPluginId",
						"revision",
					]),
				).toEqual([
					{
						revision: 4,
						id: "stream-owner",
						eventSchemaPluginId: null,
						eventSchemaSlug: "record-set",
						entityId: "stream-entity-owner",
					},
				]);
				expect(
					yield* readRows({ audience, userId: "owner" }, "eventStreamWork", [
						"id",
						"completedRevision",
					]),
				).toEqual([{ id: "stream-owner", completedRevision: 4 }]);

				expect(yield* readRows({ audience, userId: "other" }, "eventStream", ["id"])).toEqual([
					{ id: "stream-other" },
				]);
				expect(
					yield* readRows({ audience, userId: "other" }, "eventStreamWork", [
						"id",
						"completedRevision",
					]),
				).toEqual([{ id: "stream-other", completedRevision: null }]);
			}
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("scopes automation history to the executing user and derives retry eligibility", () =>
		Effect.gen(function* () {
			expect(
				yield* readRows(owner, "automationRun", ["id", "pluginName", "retryEligibility"]),
			).toEqual([
				{ id: "run-before", pluginName: null, retryEligibility: { reason: "before-policy" } },
				{ pluginName: null, id: "run-eligible", retryEligibility: { reason: null } },
				{ pluginName: null, id: "run-expired", retryEligibility: { reason: "expired" } },
				{
					id: "run-missing",
					pluginName: `${systemPluginName} name`,
					retryEligibility: { reason: "missing-artifact" },
				},
				{ pluginName: null, id: "run-succeeded", retryEligibility: { reason: "not-failed" } },
			]);
			expect(yield* readRows(other, "automationRun", ["id"])).toEqual([{ id: "run-other" }]);
			expect(yield* readRows(owner, "automationTrigger", ["id", "kind"])).toEqual([
				{ id: "trigger-a", kind: { operation: "emit", category: "signal", resource: "signal" } },
			]);
			expect(yield* readRows(other, "automationTrigger", ["id"])).toEqual([{ id: "trigger-b" }]);
			expect(yield* readRows(owner, "automationRunAttempt", ["id", "historyLogs"])).toEqual([
				{ id: "attempt-owner", historyLogs: [{ level: "info", message: "projected" }] },
			]);
			expect(yield* readRows("admin", "automationRunAttempt", ["id", "logs"])).toEqual([
				{ id: "attempt-other", logs: [{ level: "info", message: "raw" }] },
				{ id: "attempt-owner", logs: [{ level: "info", message: "raw" }] },
			]);
		}),
	);
});

layer(catalogDatabaseLayer)((test) => {
	test.effect("never returns sandbox script bodies to admins", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const scripts = table("sandboxScript", "scripts");
			const items = rowsOf(
				yield* service.executeForAdmin({
					queries: { rows: rows(scripts, { fields: [star(scripts)] }) },
				}),
			).items;

			expect(items).toHaveLength(4);
			for (const item of items) {
				expect(Object.values(item)).not.toContain("private-source");
				expect(Object.values(item)).not.toContain("private-code");
			}
		}),
	);
});

const matchSource = table("entity", "source");

const matchingIds = Effect.fn(function* (userId: string, where: Predicate) {
	const service = yield* RyotQLService;
	const response = yield* service.executeForUser(userId, null, "kernel", {
		queries: {
			rows: rows(matchSource, {
				orderBy: [ascending(column(matchSource, "id"))],
				fields: [field("id", column(matchSource, "id"))],
				where: and(inArray(column(matchSource, "userId"), [literal(userId)]), where),
			}),
		},
	});
	return rowsOf(response).items;
});

const ids = (values: readonly string[]) => values.map((id) => ({ id }));

layer(catalogDatabaseLayer)((test) => {
	test.effect("matches text prefixes and substrings with literal pattern characters", () =>
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
					expect(yield* matchingIds("plain", match(name, literal(needle)))).toEqual(ids(expected));
				}
				expect(yield* matchingIds("mixed", match(name, slug))).toEqual(ids(columns));
				expect(yield* matchingIds("mixed", match(externalId, literal(nullNeedle)))).toEqual(
					ids(["p01"]),
				);
				expect(yield* matchingIds("mixed", not(match(externalId, literal(nullNeedle))))).toEqual(
					ids(pairs.slice(1)),
				);
				expect(yield* matchingIds("mixed", not(match(externalId, slug)))).toEqual(ids(pairs));
				expect(yield* matchingIds("mixed", not(match(name, externalId)))).toEqual(ids(pairs));
			}
		}),
	);
});
