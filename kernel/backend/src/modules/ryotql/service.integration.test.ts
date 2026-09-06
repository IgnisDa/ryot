import { expect, it } from "@effect/vitest";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	CLIENT_API_VERSION,
	type PluginManifest,
} from "@ryot-app/contract/modules/plugins/manifest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import type { RyotQLResponse, RowItem } from "@ryot-app/contract/modules/ryotql/language";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import { NotificationSubscriptionId, SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import { ascending, column, descending, field, rows, star, table } from "@ryot-app/ryotql";
import { automationHistoryRunRecipe } from "@ryot-app/ryotql-recipes/automation-history";
import { entityDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { godModeUsersRecipe, migrationReportRecipe } from "@ryot-app/ryotql-recipes/god-mode";
import { importSourcesRecipe } from "@ryot-app/ryotql-recipes/import-sources";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Redacted, Result, Option } from "effect";
import { assert } from "vitest";

import { account, user } from "#lib/infrastructure/db/schema/tables/auth";
import {
	automationRun,
	automationRunAttempt,
	automationTrigger,
	automationTriggerRecipient,
	notificationSubscription,
} from "#lib/infrastructure/db/schema/tables/automations";
import { backupRun } from "#lib/infrastructure/db/schema/tables/backups";
import {
	plugin,
	pluginConfigRevision,
	pluginInstallation,
	pluginRevision,
	sandboxScript,
} from "#lib/infrastructure/db/schema/tables/core";
import {
	definitionEntitySchema,
	definitionEventSchema,
	definitionImportSource,
	definitionIntegrationProvider,
	definitionRelationshipSchema,
	definitionSignalSchema,
} from "#lib/infrastructure/db/schema/tables/definitions";
import { migrationReport } from "#lib/infrastructure/db/schema/tables/migration-reports";
import { savedView } from "#lib/infrastructure/db/schema/tables/views";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { fixtureManifest } from "#modules/plugins/test-support";

import type { RyotQLAudience } from "./catalog";
import { RyotQLService } from "./service";

const occurredAt = new Date(0);
const futureExpiry = new Date("2100-01-01T00:00:00Z");
const systemPluginSlug = "media-hub";

const trigger = (id: string) => ({
	id,
	depth: 0,
	occurredAt,
	executionId: id,
	rootExecutionId: id,
	source: "api" as const,
	operation: "emit" as const,
	category: "signal" as const,
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

const manifest = (slug: string, homeView: string | null): PluginManifest => ({
	...fixtureManifest(),
	metadata: {
		...fixtureManifest().metadata,
		slug,
		name: `${slug} name`,
		description: `${slug} description`,
	},
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
});

const insertPlugin = Effect.fn(function* (input: {
	readonly id: string;
	readonly slug: string;
	readonly ownerId: string | null;
	readonly homeView: string | null;
}) {
	const db = yield* Database;
	const revisionId = `${input.id}-revision`;
	yield* db
		.insert(plugin)
		.values({
			id: input.id,
			slug: input.slug,
			status: "disabled",
			ownerId: input.ownerId,
			scope: input.ownerId === null ? "system" : "user",
		});
	yield* db
		.insert(pluginRevision)
		.values({
			id: revisionId,
			version: "1.0.0",
			pluginId: input.id,
			sourceHash: `${input.id}-hash`,
			manifest: manifest(input.slug, input.homeView),
			clientConfigSchema: { fields: {}, unknownKeys: "strict" },
		});
	yield* db
		.update(plugin)
		.set({ status: "active", activeRevisionId: revisionId })
		.where(eq(plugin.id, input.id));
});

const configRevision = (
	id: string,
	pluginRevisionId: string,
	configuredKeys: string[],
	installation: { readonly ownerUserId: string; readonly pluginInstallationId: string } | null,
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
	scope: installation ? ("installation" as const) : ("environment" as const),
});

const script = (id: string, slug: string, pluginRevisionId: string | null) => ({
	id,
	slug,
	name: slug,
	metadata: {},
	pluginRevisionId,
	contentHash: "hash",
	source: "private-source",
	compiledCode: "private-code",
});

const definition = (id: string, pluginId: string | null, position = 0) => ({
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

const entitySchemaDefinition = (id: string, pluginId: string | null) => ({
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
	const db = yield* Database;
	yield* db.insert(user).values([
		{ id: "owner", name: "Owner", preferences: {}, email: "owner@example.test" },
		{ id: "other", name: "Other", preferences: {}, email: "other@example.test" },
		{ id: "mixed", name: "Mixed", preferences: {}, email: "mixed@example.test" },
		{ id: "plain", name: "Plain", preferences: {}, email: "plain@example.test" },
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
	yield* db.insert(plugin).values([
		{ scope: "system", slug: "installed", status: "disabled", id: "installed-plugin" },
		{ slug: "removed", scope: "system", status: "disabled", id: "removed-plugin" },
	]);
	yield* insertPlugin({
		ownerId: null,
		id: "system-plugin",
		slug: systemPluginSlug,
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
		{ userId: "owner", id: "uninstalled", uninstalledAt: occurredAt, pluginId: "removed-plugin" },
		{
			userId: "owner",
			id: "owner-system",
			pluginId: "system-plugin",
			homeSavedViewId: "view-kernel",
		},
		{
			userId: "owner",
			id: "owner-private",
			pluginId: "private-plugin",
			healthReason: "configured",
			configuredSecretPaths: ["token"],
			clientConfig: { visible: "yes" },
			homeSavedViewId: "view-component",
		},
		{
			userId: "owner",
			isDisabled: true,
			id: "owner-disabled",
			pluginId: "disabled-plugin",
			homeSavedViewId: "view-plugin-component",
		},
		{
			userId: "other",
			id: "other-system",
			pluginId: "system-plugin",
			homeSavedViewId: "view-kernel",
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
			view(
				"view-private-home",
				"owner",
				"private-home",
				{ kind: "plugin", exportName: "page", pluginId: "system-plugin" },
				{ isBuiltin: true, pluginInstallationId: "owner-private" },
			),
			view("view-plugin-component", "owner", "plugin-component", {
				kind: "plugin",
				exportName: "widget",
				pluginId: "system-plugin",
			}),
			view(
				"view-disabled-home",
				"owner",
				"disabled-home",
				{ kind: "kernel", name: "entity-browser" },
				{ isBuiltin: true, isDisabled: true, pluginInstallationId: "owner-disabled" },
			),
			view(
				"view-other-home",
				"other",
				"system-home",
				{ kind: "plugin", exportName: "page", pluginId: "system-plugin" },
				{ isBuiltin: true, pluginInstallationId: "other-system" },
			),
		]);
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
		sql`update automation_run set queued_at = queued_at + (case id when 'run-eligible' then 100 when 'run-missing' then 200 when 'run-before' then 300 when 'run-succeeded' then 400 when 'run-expired' then 500 else 0 end) * interval '1 microsecond'`,
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
				level: "warning" as const,
				code: "seen-episode-absent" as const,
			},
			{
				count: 5,
				phase: "import",
				message: "counted",
				level: "warning" as const,
				code: "seen-episode-absent" as const,
			},
		]);
	yield* db
		.insert(notificationSubscription)
		.values({
			userId: "owner",
			signalSchemaSlug: "fixture.signal",
			id: NotificationSubscriptionId.make("subscription"),
		});
});

const withCatalogDatabase = <E>(test: Effect.Effect<void, E, RyotQLService>) => {
	const name = `ryotql_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const url = testDatabaseUrl();
	const root = DatabaseLive.pipe(
		Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(url) } })),
	);
	return Effect.gen(function* () {
		const rootDatabase = yield* Database;
		const directory = new URL("../../drizzle/", import.meta.url).pathname;
		const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
		assert(paths.length === 1);
		const ddl = yield* Effect.promise(() => Bun.file(directory + paths[0]).text());
		yield* rootDatabase.execute(sql`create database ${sql.identifier(name)}`);
		yield* Effect.gen(function* () {
			const db = yield* Database;
			for (const statement of ddl.split("--> statement-breakpoint")) {
				yield* db.execute(sql.raw(statement));
			}
			yield* seedCatalog;
			yield* test;
		}).pipe(
			Effect.provide(
				RyotQLService.layer.pipe(
					Layer.provideMerge(
						DatabaseLive.pipe(
							Layer.provide(
								makeAppConfigLayer({
									database: { url: Redacted.make(new URL(`/${name}`, url).toString()) },
								}),
							),
							Layer.fresh,
						),
					),
				),
			),
			Effect.ensuring(
				rootDatabase.execute(sql`drop database ${sql.identifier(name)}`).pipe(Effect.orDie),
			),
		);
	}).pipe(Effect.provide(root.pipe(Layer.provideMerge(makeConfigProviderLayer()))));
};

const rowsOf = (response: RyotQLResponse) => {
	const result = response.data["rows"];
	assert(result?.type === "rows");
	return result;
};

type Reader = { readonly userId: string; readonly audience: RyotQLAudience } | "admin";

const owner = { userId: "owner", audience: "kernel" } as const;
const other = { userId: "other", audience: "kernel" } as const;

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

it.effect("executes recipe documents and decodes correlated includes and admin totals", () =>
	withCatalogDatabase(
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
			expect(installations.items.find(({ slug }) => slug === "private")?.configuredSecrets).toEqual(
				["token"],
			);

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

			const usersRecipe = godModeUsersRecipe({ limit: 2, search: "example.test" });
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
	),
);

it.effect("pages numeric primary keys with admin cursors and derives detail totals", () =>
	withCatalogDatabase(
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
	),
);

it.effect("pages timestamps that share a millisecond at full database precision", () =>
	withCatalogDatabase(
		Effect.gen(function* () {
			const runs = table("automationRun", "runs");
			const queuedAt = column(runs, "queuedAt");
			const fields = [field("id", column(runs, "id"))];
			const microsecondOrder = [
				{ id: "run-eligible" },
				{ id: "run-missing" },
				{ id: "run-before" },
				{ id: "run-succeeded" },
				{ id: "run-expired" },
			];

			expect(
				yield* collectPages(rows(runs, { fields, orderBy: [ascending(queuedAt)] }), owner),
			).toEqual(microsecondOrder);
			expect(
				yield* collectPages(rows(runs, { fields, orderBy: [descending(queuedAt)] }), owner),
			).toEqual(microsecondOrder.toReversed());
		}),
	),
);

it.effect("pages composite primary keys with every key column as a tie breaker", () =>
	withCatalogDatabase(
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
	),
);

it.effect("hides uninstalled installations from users but not from admins", () =>
	withCatalogDatabase(
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
	),
);

it.effect("expands admin-only fields only for admin wildcards", () =>
	withCatalogDatabase(
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
	),
);

it.effect("shows users only themselves and classifies auth state for admins", () =>
	withCatalogDatabase(
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
					preferences: {},
					email: "owner@example.test",
					createdAt: expect.any(String),
				},
			]);
			expect(yield* readRows("admin", "user", ["id", "authState"])).toEqual([
				{ id: "mixed", authState: "mixed" },
				{ id: "other", authState: "oidc" },
				{ id: "owner", authState: "credential" },
				{ id: "plain", authState: "none" },
			]);
		}),
	),
);

it.effect("scopes backups and saved views to their owner without artifact keys", () =>
	withCatalogDatabase(
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
				{ id: "view-component" },
				{ id: "view-disabled-home" },
				{ id: "view-kernel" },
				{ id: "view-plugin-component" },
				{ id: "view-private-home" },
			]);
			expect(yield* readRows(other, "savedView", ["id"])).toEqual([{ id: "view-other-home" }]);
		}),
	),
);

it.effect("reads plugin revision metadata and redacted installation projections", () =>
	withCatalogDatabase(
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
				description: `${systemPluginSlug} description`,
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
	),
);

it.effect("derives the effective home view from usable selections and manifest defaults", () =>
	withCatalogDatabase(
		Effect.gen(function* () {
			const expected = [
				{ id: "installed", homeSavedViewId: null },
				{ id: "other-private", homeSavedViewId: null },
				{ id: "other-system", homeSavedViewId: "view-other-home" },
				{ id: "owner-disabled", homeSavedViewId: null },
				{ id: "owner-private", homeSavedViewId: "view-private-home" },
				{ id: "owner-system", homeSavedViewId: "view-kernel" },
				{ id: "uninstalled", homeSavedViewId: null },
			];

			expect(yield* readRows("admin", "pluginInstallation", ["id", "homeSavedViewId"])).toEqual(
				expected,
			);
			expect(
				yield* readRows({ userId: "owner", audience: "plugin" }, "pluginInstallation", [
					"id",
					"homeSavedViewId",
				]),
			).toEqual(expected.filter(({ id }) => id === "installed" || id.startsWith("owner-")));
		}),
	),
);

it.effect("exposes only effective definitions to their user in every audience", () =>
	withCatalogDatabase(
		Effect.gen(function* () {
			for (const audience of ["kernel", "plugin"] as const) {
				expect(
					yield* readRows({ audience, userId: "owner" }, "entitySchema", [
						"id",
						"pluginSlug",
						"mergeIdentityProperties",
					]),
				).toEqual([
					{ pluginSlug: null, id: "kernel-entity", mergeIdentityProperties: ["name"] },
					{ id: "private-entity", pluginSlug: "private", mergeIdentityProperties: ["name"] },
					{ id: "system-entity", pluginSlug: systemPluginSlug, mergeIdentityProperties: ["name"] },
				]);
			}
			expect(yield* readRows(other, "entitySchema", ["id"])).toEqual([
				{ id: "kernel-entity" },
				{ id: "other-entity" },
				{ id: "system-entity" },
			]);
			expect(
				yield* readRows(owner, "eventSchema", ["id", "pluginSlug", "entitySchemaSlug"]),
			).toEqual([
				{ pluginSlug: null, id: "kernel-event", entitySchemaSlug: "kernel-entity" },
				{ id: "system-event", pluginSlug: systemPluginSlug, entitySchemaSlug: "system-entity" },
			]);
			expect(yield* readRows(owner, "relationshipSchema", ["id"])).toEqual([
				{ id: "kernel-link" },
				{ id: "private-link" },
			]);
			expect(yield* readRows(other, "relationshipSchema", ["id"])).toEqual([{ id: "kernel-link" }]);
			expect(yield* readRows(other, "signalSchema", ["id", "pluginSlug", "catalogState"])).toEqual([
				{ id: "system.signal", catalogState: "active", pluginSlug: systemPluginSlug },
			]);
		}),
	),
);

it.effect("derives import source readiness and integration provider scripts", () =>
	withCatalogDatabase(
		Effect.gen(function* () {
			expect(
				yield* readRows(owner, "importSource", ["id", "missingPluginConfigKeys", "isStartable"]),
			).toEqual([
				{ isStartable: true, id: "import-private", missingPluginConfigKeys: [] },
				{
					isStartable: false,
					id: "import-sys-missing",
					missingPluginConfigKeys: [pluginConfigEnvironmentKey(systemPluginSlug, "clientSecret")],
				},
				{ isStartable: false, id: "import-sys-no-script", missingPluginConfigKeys: [] },
				{ isStartable: true, id: "import-sys-ready", missingPluginConfigKeys: [] },
			]);
			expect(yield* readRows(other, "importSource", ["id"])).not.toContainEqual({
				id: "import-private",
			});
			expect(yield* readRows(owner, "integrationProvider", ["id", "lot", "hasScript"])).toEqual([
				{ lot: "yank", hasScript: false, id: "provider-missing" },
				{ lot: "push", hasScript: true, id: "provider-push" },
				{ lot: "yank", hasScript: true, id: "provider-yank" },
			]);
		}),
	),
);

it.effect("scopes automation history to the executing user and derives retry eligibility", () =>
	withCatalogDatabase(
		Effect.gen(function* () {
			expect(
				yield* readRows(owner, "automationRun", ["id", "pluginName", "retryEligibility"]),
			).toEqual([
				{ id: "run-before", pluginName: null, retryEligibility: { reason: "before-policy" } },
				{ pluginName: null, id: "run-eligible", retryEligibility: { reason: null } },
				{ pluginName: null, id: "run-expired", retryEligibility: { reason: "expired" } },
				{
					id: "run-missing",
					pluginName: `${systemPluginSlug} name`,
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
	),
);

it.effect("never returns sandbox script bodies to admins", () =>
	withCatalogDatabase(
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
	),
);
