import { assert, describe, expect, it, layer } from "@effect/vitest";
import { PluginPackageId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import type { WorkflowDurableCallRequest } from "@ryot-app/sandbox-sdk/workflow";
import { ScriptPluginRevision } from "@ryot-app/sandbox/protocol/principal";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { fakeDatabaseSession } from "#lib/test-utils/effect";
import type { PluginSandboxAuthority } from "#modules/scripts/authorization/plugin-authority";

import { isWorkflowCallTargetKind, SandboxRepository } from "./repository";

const activity = {
	index: 0,
	name: "activity",
	kind: "activity",
	args: { input: {}, scriptSlug: "activity.test" },
} satisfies WorkflowDurableCallRequest;

describe("workflow call script resolution", () => {
	it("dispatches activity requests to scripts", () => {
		expect(isWorkflowCallTargetKind(activity, "script")).toBe(true);
		for (const kind of ["operation", "workflow", "provider", "automation"] as const) {
			expect(isWorkflowCallTargetKind(activity, kind)).toBe(false);
		}
	});

	it("dispatches children only to workflow scripts", () => {
		const child = {
			index: 0,
			name: "child",
			kind: "child",
			args: { input: {}, workflowSlug: "workflow.test" },
		} satisfies WorkflowDurableCallRequest;
		expect(isWorkflowCallTargetKind(child, "workflow")).toBe(true);
		expect(isWorkflowCallTargetKind(child, "script")).toBe(false);
	});
});

const configSchema = {
	fields: {},
	unknownKeys: "strict",
} satisfies PluginSandboxAuthority["configSchema"];

const packageId = PluginPackageId.make("test/sandbox");

const manifest = {
	configSchema,
	entitySchemas: [],
	relationshipSchemas: [],
	workflows: [{ slug: "plugin-workflow", scriptSlug: "plugin.workflow" }],
	scripts: [{ kind: "script", runtimeImports: [], slug: "plugin.script" }],
	userBootstrap: [{ slug: "bootstrap", description: "Bootstrap", scriptSlug: "plugin.script" }],
};

const environmentConfigRevisionId = (): string | null => "config-1";

const sandboxAuthority = {
	packageId,
	configSchema: manifest.configSchema,
	scriptKinds: { "plugin.script": "script" },
	userBootstrapScriptSlugs: ["plugin.script"],
	workflowScripts: { "plugin-workflow": "plugin.workflow" },
	schemaScope: {
		eventSchemas: [],
		entitySchemaSlugs: [],
		signalSchemaSlugs: [],
		relationshipSchemaSlugs: [],
	},
} satisfies PluginSandboxAuthority;

const pluginPinRow = {
	id: "script-id",
	sandboxAuthority,
	pluginOwnerId: null,
	pluginId: "plugin-id",
	slug: "plugin.script",
	pluginStatus: "active",
	providerId: "provider-id",
	pluginPackageId: packageId,
	contentHash: "current-hash",
	providerPluginId: "plugin-id",
	pluginRevisionId: "revision-1",
	activeRevisionId: "revision-1",
	metadata: { runtimeImports: [], kind: "script" as const },
	environmentConfigRevisionId: environmentConfigRevisionId(),
};

const config = {
	ownerUserId: null,
	scope: "environment",
	encryptedPayload: "encrypted",
	pluginRevisionId: "revision-1",
};

type SQLCondition = { getSQL: () => SQL };
type PinRows = (table: unknown, condition?: SQLCondition) => readonly unknown[];

class PinDatabase extends Context.Service<
	PinDatabase,
	{
		readonly conditions: Effect.Effect<ReadonlyArray<SQLCondition>>;
		readonly respondWith: (rows: PinRows) => Effect.Effect<void>;
	}
>()("test/PinDatabase") {}

const pinDatabaseLayer = (rows: PinRows) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const conditions = yield* Ref.make<ReadonlyArray<SQLCondition>>([]);
			const response = yield* Ref.make(rows);
			const query = (table: unknown, condition: SQLCondition) =>
				Ref.update(conditions, (all) => [...all, condition]).pipe(
					Effect.andThen(Ref.get(response)),
					Effect.map((current) => current(table, condition)),
				);
			const database = Object.assign(Object.create(null), {
				select: () => ({
					from: (table: unknown) => {
						const builder = {
							leftJoin: () => builder,
							innerJoin: () => builder,
							where: (condition: SQLCondition) =>
								Object.assign(query(table, condition), { limit: () => query(table, condition) }),
						};
						return builder;
					},
				}),
			});
			return Layer.merge(
				fakeDatabaseSession(database),
				Layer.succeed(PinDatabase, {
					conditions: Ref.get(conditions),
					respondWith: (next) => Ref.set(response, next),
				}),
			);
		}),
	);

const pinRows =
	(row: typeof pluginPinRow | null, storedConfig = config): PinRows =>
	(table) => {
		if (table === tables.pluginConfigRevision) {
			return [storedConfig];
		}
		return row ? [row] : [];
	};

const pinRepositoryLayer = SandboxRepository.layer.pipe(
	Layer.provideMerge(pinDatabaseLayer(pinRows(null))),
);

const getPin = Effect.fnUntraced(function* (
	row: typeof pluginPinRow | null,
	expectedRevision?: Pick<ScriptPluginRevision, "id" | "revisionId" | "configRevisionId">,
	storedConfig = config,
) {
	yield* (yield* PinDatabase).respondWith(pinRows(row, storedConfig));
	return yield* (yield* SandboxRepository).getScriptPin(
		SandboxScriptId.make("script-id"),
		expectedRevision,
	);
});

layer(pinRepositoryLayer)((test) => {
	test.effect(
		"admits only the exact hidden unfinished installation bootstrap and rejects stale activations",
		() =>
			Effect.gen(function* () {
				const database = yield* PinDatabase;
				const repository = yield* SandboxRepository;
				const userId = UserId.make("initializer-owner");
				const subject = {
					userId,
					type: "user",
					accountGeneration: { userId, token: "active-account" },
				} as const;
				const row = { ...pluginPinRow, pluginOwnerId: userId, activationId: "activation-1" };
				const state = {
					isHidden: true,
					disabledAt: null,
					uninstalledAt: null,
					health: "installing",
					isInitialized: false,
					id: "hidden-installation",
					incompatibilityReason: null,
					activeConfigRevisionId: "config-1",
				};
				yield* database.respondWith((table) => {
					if (table === tables.user) {
						return [{ disabledAt: null, accountGeneration: "active-account" }];
					}
					if (table === tables.pluginInstallation) {
						return [state];
					}
					if (table === tables.pluginConfigRevision) {
						return [{ ...config, ownerUserId: userId }];
					}
					return [row];
				});
				const binding = { installationId: state.id, activationId: row.activationId };
				const pin = yield* repository.getScriptPin(
					SandboxScriptId.make(row.id),
					undefined,
					subject,
					binding,
				);
				expect(pin).toMatchObject({
					initialization: binding,
					pluginRevision: { ownerId: userId, userBootstrapScriptSlugs: ["plugin.script"] },
				});
				expect(
					yield* Effect.flip(
						repository.getScriptPin(SandboxScriptId.make(row.id), undefined, subject),
					),
				).toMatchObject({ data: { code: "installation-unavailable" } });
				expect(
					yield* Effect.flip(
						repository.getScriptPin(
							SandboxScriptId.make(row.id),
							pin?.pluginRevision ?? undefined,
							subject,
							{ ...binding, activationId: "old-activation" },
						),
					),
				).toMatchObject({ data: { code: "installation-unavailable" } });
				yield* database.respondWith((table) => {
					if (table === tables.user) {
						return [{ disabledAt: null, accountGeneration: "active-account" }];
					}
					if (table === tables.pluginInstallation) {
						return [{ ...state, isInitialized: true }];
					}
					if (table === tables.pluginConfigRevision) {
						return [{ ...config, ownerUserId: userId }];
					}
					return [row];
				});
				expect(
					yield* Effect.flip(
						repository.getScriptPin(
							SandboxScriptId.make(row.id),
							pin?.pluginRevision ?? undefined,
							subject,
							binding,
						),
					),
				).toMatchObject({ data: { code: "installation-unavailable" } });
			}),
	);
	test.effect(
		"keeps private bootstrap and historical pins but blocks current quarantine and account revocation",
		() =>
			Effect.gen(function* () {
				const database = yield* PinDatabase;
				const repository = yield* SandboxRepository;
				const userId = UserId.make("private-owner");
				const subject = {
					userId,
					type: "user",
					accountGeneration: { userId, token: "current-account" },
				} as const;
				const row = {
					...pluginPinRow,
					slug: "plugin.job",
					pluginOwnerId: userId,
					metadata: { runtimeImports: [], kind: "workflow" as const },
					sandboxAuthority: {
						...sandboxAuthority,
						scriptKinds: { ...sandboxAuthority.scriptKinds, "plugin.job": "workflow" as const },
					},
				};
				const installation = {
					health: "ready",
					isHidden: false,
					disabledAt: null,
					uninstalledAt: null,
					id: "private-installation",
					incompatibilityReason: null,
					activeConfigRevisionId: "config-1",
				};
				const respond =
					(state: typeof installation, disabled = false): PinRows =>
					(table) => {
						if (table === tables.user) {
							return [
								{ accountGeneration: "current-account", disabledAt: disabled ? new Date(0) : null },
							];
						}
						if (table === tables.pluginInstallation) {
							return [state];
						}
						if (table === tables.pluginConfigRevision) {
							return [{ ...config, ownerUserId: userId }];
						}
						return [row];
					};
				yield* database.respondWith(respond(installation));
				const original = yield* repository.getScriptPin(
					SandboxScriptId.make(row.id),
					undefined,
					subject,
				);
				assert(original?.pluginRevision);
				expect(original.pluginRevision.userBootstrapScriptSlugs).toEqual(["plugin.script"]);
				yield* database.respondWith((table, condition) =>
					table === tables.sandboxScript
						? [{ ...row, activeRevisionId: "revision-2" }]
						: respond(installation)(table, condition),
				);
				expect(
					yield* repository.getScriptPin(
						SandboxScriptId.make(row.id),
						original.pluginRevision,
						subject,
					),
				).toMatchObject({
					pluginRevision: { revisionId: "revision-1", configRevisionId: "config-1" },
				});
				yield* database.respondWith((table, condition) => {
					if (table === tables.pluginInstallation) {
						return [{ ...installation, health: "installing" }];
					}
					if (table === tables.sandboxScript) {
						return [{ ...row, activeRevisionId: "revision-2" }];
					}
					return respond(installation)(table, condition);
				});
				expect(
					yield* repository.getScriptPin(
						SandboxScriptId.make(row.id),
						original.pluginRevision,
						subject,
					),
				).toMatchObject({
					scriptSlug: "plugin.job",
					pluginRevision: { revisionId: "revision-1", configRevisionId: "config-1" },
				});
				expect(
					yield* repository.getScriptPin(SandboxScriptId.make(row.id), undefined, subject),
				).toBeNull();
				yield* database.respondWith((table, condition) => {
					if (table === tables.pluginInstallation) {
						return [
							{ ...installation, activeConfigRevisionId: null, health: "needs-configuration" },
						];
					}
					if (table === tables.sandboxScript) {
						return [{ ...row, activeRevisionId: "revision-2" }];
					}
					return respond(installation)(table, condition);
				});
				expect(
					yield* repository.getScriptPin(
						SandboxScriptId.make(row.id),
						original.pluginRevision,
						subject,
					),
				).toMatchObject({
					pluginRevision: { revisionId: "revision-1", configRevisionId: "config-1" },
				});
				expect(
					yield* repository.getScriptPin(SandboxScriptId.make(row.id), undefined, subject),
				).toBeNull();
				yield* database.respondWith((table, condition) =>
					table === tables.pluginInstallation
						? [
								{
									...installation,
									health: "incompatible",
									incompatibilityReason: "package-identity-conflict",
								},
							]
						: respond(installation)(table, condition),
				);
				const rejected = yield* Effect.flip(
					repository.getScriptPin(SandboxScriptId.make(row.id), original.pluginRevision, subject),
				);
				expect(rejected).toMatchObject({
					data: {
						pluginId: "plugin-id",
						code: "package-identity-conflict",
						installationId: "private-installation",
					},
				});
				yield* database.respondWith(respond(installation, true));
				expect(
					yield* repository.getScriptPin(
						SandboxScriptId.make(row.id),
						original.pluginRevision,
						subject,
					),
				).toBeNull();
				yield* database.respondWith((table, condition) =>
					table === tables.sandboxScript
						? [{ ...pluginPinRow, pluginOwnerId: userId }]
						: respond(installation, true)(table, condition),
				);
				expect(
					yield* repository.getScriptPin(SandboxScriptId.make(row.id), undefined, subject),
				).toMatchObject({ scriptSlug: "plugin.script" });
			}),
	);
	test.effect("pins active current plugin identity and exact bootstrap declaration", () =>
		Effect.gen(function* () {
			expect(yield* getPin(pluginPinRow)).toMatchObject({
				scriptSlug: "plugin.script",
				pluginRevision: {
					packageId,
					ownerId: null,
					id: "plugin-id",
					scope: "system",
					revisionId: "revision-1",
					configRevisionId: "config-1",
					userBootstrapScriptSlugs: ["plugin.script"],
					workflowScripts: { "plugin-workflow": "plugin.workflow" },
				},
			});
		}),
	);
});

layer(pinRepositoryLayer)((test) => {
	test.effect("rejects inactive, stale, and foreign-provider plugin pins", () =>
		Effect.gen(function* () {
			for (const row of [
				{ ...pluginPinRow, pluginStatus: "inactive" },
				{ ...pluginPinRow, activeRevisionId: "revision-2" },
				{ ...pluginPinRow, providerPluginId: "foreign-plugin-id" },
				{ ...pluginPinRow, pluginPackageId: PluginPackageId.make("test/mismatched") },
			]) {
				expect(yield* getPin(row)).toBeNull();
			}
		}),
	);
});

layer(pinRepositoryLayer)((test) => {
	test.effect("rejects system plugin pins before environment configuration resolves", () =>
		Effect.gen(function* () {
			expect(yield* getPin({ ...pluginPinRow, environmentConfigRevisionId: null })).toBeNull();
		}),
	);
});

layer(pinRepositoryLayer)((test) => {
	test.effect(
		"retains revision/config pins across serialization and ignores active state for explicit pins",
		() =>
			Effect.gen(function* () {
				const original = yield* getPin(pluginPinRow);
				if (!original?.pluginRevision) {
					throw new Error("Expected plugin pin");
				}
				const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(ScriptPluginRevision))(
					original.pluginRevision,
				);
				const pin = yield* Schema.decodeEffect(Schema.fromJsonString(ScriptPluginRevision))(
					encoded,
				);
				expect(pin).toMatchObject({ revisionId: "revision-1", configRevisionId: "config-1" });
				expect(
					yield* getPin(
						{ ...pluginPinRow, pluginStatus: "inactive", activeRevisionId: "revision-2" },
						pin,
					),
				).toMatchObject({
					pluginRevision: { revisionId: "revision-1", configRevisionId: "config-1" },
				});
				expect(
					yield* getPin(pluginPinRow, pin, { ...config, pluginRevisionId: "revision-2" }),
				).toBeNull();
				expect(yield* getPin(pluginPinRow, pin, { ...config, encryptedPayload: "" })).toBeNull();
			}),
	);
});

const dialect = new PgDialect();
const rootId = SandboxScriptId.make("workflow-script-id");
const root = {
	...pluginPinRow,
	id: rootId,
	providerId: null,
	providerPluginId: null,
	slug: "plugin.workflow",
	contentHash: "workflow-v1",
	metadata: { kind: "workflow" as const },
	sandboxAuthority: {
		...sandboxAuthority,
		scriptKinds: { "plugin.child": "workflow", "plugin.workflow": "workflow" },
		workflowScripts: Object.fromEntries([
			["root", "plugin.workflow"],
			["child", "plugin.child"],
		]),
		schemaScope: {
			eventSchemas: [],
			signalSchemaSlugs: [],
			relationshipSchemaSlugs: [],
			entitySchemaSlugs: ["original-entity"],
		},
	},
};
const replacedRoot = {
	...root,
	sandboxAuthority: {
		...root.sandboxAuthority,
		workflowScripts: Object.fromEntries([
			["root", "plugin.workflow"],
			["child", "plugin.replacement"],
		]),
		schemaScope: {
			eventSchemas: [],
			signalSchemaSlugs: [],
			relationshipSchemaSlugs: [],
			entitySchemaSlugs: ["replacement-entity"],
		},
	},
};
const isChildTarget = (condition: SQLCondition) =>
	dialect.sqlToQuery(condition.getSQL()).params.includes("plugin.child");
const workflowRows =
	(selectedPinRow: typeof root): PinRows =>
	(table, condition) => {
		if (table === tables.pluginConfigRevision) {
			return [config];
		}
		const params = condition ? dialect.sqlToQuery(condition.getSQL()).params : [];
		if (params.includes("plugin.child")) {
			return [{ id: "child-v1-id", metadata: { kind: "workflow" as const } }];
		}
		if (params.length === 1 && params[0] === "revision-1") {
			return [
				{ slug: "plugin.child", contentHash: "child-v1" },
				{ slug: "plugin.workflow", contentHash: "workflow-v1" },
			];
		}
		return [selectedPinRow];
	};

layer(SandboxRepository.layer.pipe(Layer.provideMerge(pinDatabaseLayer(workflowRows(root)))))(
	(test) => {
		test.effect("resolves first-observed children from the pinned plugin revision", () =>
			Effect.gen(function* () {
				const repository = yield* SandboxRepository;
				const database = yield* PinDatabase;
				const pin = yield* repository.getScriptPin(rootId);
				expect(pin?.pluginRevision).not.toBeNull();

				yield* database.respondWith(workflowRows(replacedRoot));
				expect(pin?.pluginRevision?.schemaScope.entitySchemaSlugs).toEqual(["original-entity"]);

				expect(
					yield* repository.resolveWorkflowCallScript(pin?.pluginRevision ?? null, {
						index: 0,
						name: "child",
						kind: "child",
						args: { input: {}, workflowSlug: "child" },
					}),
				).toEqual({ kind: "workflow", scriptId: "child-v1-id" });
				const condition = (yield* database.conditions).find(isChildTarget);
				if (condition === undefined) {
					throw new Error("Expected workflow target condition");
				}
				expect(dialect.sqlToQuery(condition.getSQL()).params).toEqual(
					expect.arrayContaining(["revision-1", "plugin.child", "child-v1"]),
				);

				yield* database.respondWith(
					workflowRows({
						...replacedRoot,
						slug: "plugin.child",
						contentHash: "child-v1",
						id: SandboxScriptId.make("child-v1-id"),
					}),
				);
				expect(
					yield* repository.getScriptPin(
						SandboxScriptId.make("child-v1-id"),
						pin?.pluginRevision ?? undefined,
					),
				).toMatchObject({
					scriptId: "child-v1-id",
					contentHash: "child-v1",
					pluginRevision: { compiledHashes: { "plugin.child": "child-v1" } },
				});
			}),
		);
	},
);
