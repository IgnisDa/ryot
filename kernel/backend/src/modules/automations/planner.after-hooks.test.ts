import { expect, it } from "@effect/vitest";
import {
	type AutomationRun,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { PluginBeforeHook, PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import type { AutomationTriggerId } from "@ryot-app/contract/schema/brands";
import { UserId } from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Schema } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecyclePlanner, LifecycleWork } from "#modules/automations/lifecycle/planning";
import { makeUserPrincipal } from "#modules/scripts/authorization/principal.test-support";
import type { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { fakeDatabaseSession, makeAppConfigLayer } from "#testing/effect";

import { triggerFixture } from "./lifecycle.test-support";
import { LifecyclePlannerLive } from "./planner";
import { AutomationPlannerResolver } from "./planner-resolver";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const userId = UserId.make("owner");
const accountGeneration = { userId, token: "generation" };
const writeContext = makeUserPrincipal({
	subject: { userId, type: "user", accountGeneration, afterHooks: "skip" },
});
const before = Schema.decodeSync(PluginBeforeHook)({
	name: "Policy",
	slug: "policy",
	stage: "before",
	scriptSlug: "policy",
	targets: [{ resource: "entity", operation: "create", entitySchemaSlug: "record" }],
});
const after = Schema.decodeSync(PluginHook)({
	stage: "after",
	name: "Changed",
	slug: "changed",
	delivery: "async",
	scriptSlug: "changed",
	targets: [{ resource: "entity", operation: "create", entitySchemaSlug: "record" }],
});
type ResolvedHook = Effect.Success<
	ReturnType<AutomationPlannerResolver["Service"]["resolve"]>
>[number];
const match = (hook: ResolvedHook["hook"]): ResolvedHook => ({
	hook,
	executionUserId: userId,
	script: {
		id: hook.scriptSlug,
		contentHash: "hash",
		slug: hook.scriptSlug,
		metadata: { runtimeImports: [] },
	},
	plugin: {
		scripts: [],
		id: "plugin",
		signalSchemas: [],
		hooks: [before, after],
		pluginRevisionId: "revision",
		pluginConfigRevisionId: "config",
	},
});
const trigger = (id: string, category: "change" | "request" = "change") => {
	const snapshot = {
		id: "record",
		name: "Record",
		properties: {},
		externalId: null,
		providerId: null,
		populatedAt: null,
		entitySchemaSlug: "record",
		entitySchemaPluginId: "plugin",
		createdAt: "2026-09-15T00:00:00.000Z",
		updatedAt: "2026-09-15T00:00:00.000Z",
	};
	const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = snapshot;
	return Schema.decodeUnknownSync(AutomationTrigger)({
		...triggerFixture(id),
		scopeUserId: userId,
		kind: { category, resource: "entity", operation: "create" },
		payload: {
			category,
			resource: "entity",
			operation: "create",
			...(category === "request" ? { draft } : { after: snapshot }),
		},
	});
};

const withPlanner = <A, E>(
	body: (harness: {
		batchSelections: string[];
		admitted: AutomationTrigger[];
		planner: LifecyclePlanner["Service"];
		decisions: Map<string, typeof tables.mutationReceipt.$inferInsert>;
		admissionContexts: Array<Parameters<LifecycleWork["Service"]["admit"]>[1]>;
	}) => Effect.Effect<A, E, DatabaseSession>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const admitted: AutomationTrigger[] = [];
			const admissionContexts: Array<Parameters<LifecycleWork["Service"]["admit"]>[1]> = [];
			const batchSelections: string[] = [];
			const storedTriggers = new Map<string, AutomationTrigger>();
			const storedRuns = new Map<string, AutomationRun[]>();
			const decisions = new Map<string, typeof tables.mutationReceipt.$inferInsert>();
			const dialect = new PgDialect();
			const database = fakeDatabaseSession(
				{
					execute: () => Effect.void,
					insert: () => ({
						values: (row: typeof tables.mutationReceipt.$inferInsert) =>
							Effect.sync(() => {
								decisions.set(row.id, row);
							}),
					}),
					select: () => ({
						from: (table: unknown) => {
							const where = (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
								const rows = Effect.sync(() => {
									if (table === tables.pluginRevision) {
										return [{ id: "revision", hooks: [before] }];
									}
									if (table === tables.automationRun) {
										return [{ count: 0 }];
									}
									if (table === tables.user) {
										return [{ token: accountGeneration.token }];
									}
									const [id] = dialect.sqlToQuery(condition).params;
									const row = typeof id === "string" ? decisions.get(id) : undefined;
									return table === tables.mutationReceipt && row ? [row] : [];
								});
								return Object.assign(rows, { for: () => rows, limit: () => rows });
							};
							return { where, innerJoin: () => ({ where }) };
						},
					}),
				},
				{ requireTransaction: Effect.void, isTransactionActive: Effect.succeed(true) },
			);
			const repositories = Layer.merge(
				Layer.effect(
					AutomationTriggerRepository,
					Effect.gen(function* () {
						const repository = yield* AutomationTriggerRepository.make;
						return {
							...repository,
							insertRecipients: () => Effect.succeed([]),
							findById: (id: AutomationTriggerId) => Effect.succeed(storedTriggers.get(id) ?? null),
							insert: (value: AutomationTrigger) =>
								Effect.sync(() => {
									storedTriggers.set(value.id, value);
									return value;
								}),
						};
					}),
				),
				Layer.effect(
					AutomationRunRepository,
					Effect.gen(function* () {
						const repository = yield* AutomationRunRepository.make;
						return {
							...repository,
							listByTrigger: (id: AutomationTriggerId) => Effect.succeed(storedRuns.get(id) ?? []),
							insertQueued: ({ runs }: Parameters<typeof repository.insertQueued>[0]) =>
								Effect.sync(() => {
									for (const run of runs) {
										storedRuns.set(run.triggerId, [...(storedRuns.get(run.triggerId) ?? []), run]);
									}
									return [...runs];
								}),
						};
					}),
				),
			);
			const dependencies = Layer.mergeAll(
				repositories,
				makeAppConfigLayer(),
				Layer.succeed(LifecycleWork, {
					dispatch: () => Effect.die("Unexpected dispatch during planning"),
					admit: (value, context) =>
						Effect.sync(() => {
							admitted.push(value);
							admissionContexts.push(context);
							return ["projection-job"];
						}),
				}),
				Layer.succeed(AutomationPlannerResolver, {
					lockCatalog: () => Effect.void,
					resolve: (value) =>
						Effect.succeed([match(value.kind.category === "request" ? before : after)]),
					resolveBatchCandidates: ({ resource }) =>
						Effect.sync(() => {
							batchSelections.push(resource);
							return [];
						}),
				}),
			).pipe(Layer.provideMerge(database));
			const context = yield* Layer.build(
				LifecyclePlannerLive.pipe(Layer.provideMerge(dependencies)),
			);
			return yield* body({
				admitted,
				decisions,
				batchSelections,
				admissionContexts,
				planner: Context.get(context, LifecyclePlanner),
			}).pipe(Effect.provide(context));
		}),
	);

it.effect(
	"skips after hooks, retains before policies and admits projection work on fresh and replayed plans",
	() =>
		withPlanner(({ planner, admitted, admissionContexts }) =>
			Effect.gen(function* () {
				const change = trigger("changed");
				const skipped = yield* planner.plan({ writeContext, trigger: change });
				expect(skipped).toMatchObject({
					runs: [],
					policies: [],
					backgroundJobIds: ["projection-job"],
				});
				const policy = yield* planner.plan({
					writeContext,
					trigger: trigger("requested", "request"),
				});
				expect(policy.runs.map(({ stage }) => stage)).toEqual(["before"]);
				expect(policy.policies).toHaveLength(1);
				expect(
					yield* planner.plan({ writeContext, trigger: trigger("requested", "request") }),
				).toEqual({ ...policy, wasCreated: false });
				const normal = yield* planner.plan({ trigger: trigger("ordinary") });
				expect(normal.runs.map(({ stage }) => stage)).toEqual(["after"]);
				expect(yield* planner.plan({ writeContext, trigger: trigger("ordinary") })).toMatchObject({
					runs: [],
					backgroundJobIds: ["projection-job"],
				});
				expect(admitted.map(({ id }) => id)).toEqual([
					"changed",
					"requested",
					"requested",
					"ordinary",
					"ordinary",
				]);
				expect(admissionContexts.map(({ fresh }) => fresh)).toEqual([
					true,
					true,
					false,
					true,
					false,
				]);
				expect(admissionContexts.map(({ writeContext: context }) => context)).toEqual([
					writeContext,
					writeContext,
					writeContext,
					undefined,
					writeContext,
				]);
			}),
		),
);

it.effect("records an empty durable batch candidate decision only for trusted suppression", () =>
	withPlanner(({ planner, decisions, batchSelections }) =>
		Effect.gen(function* () {
			const change = trigger("batch");
			const command = {
				...rootLifecycleCommand({
					source: "api",
					accountGeneration,
					lane: "background",
					itemIdentity: "batch",
					occurredAt: change.occurredAt,
					initiator: { id: userId, kind: "user" },
					executionId: change.causation.executionId,
				}),
				writeContext,
			};
			const input = { command, scopes: [userId], identity: ["batch"], resource: "entity" as const };
			const first = yield* planner.prepareBatch(input);
			expect(first.hasCandidates).toBe(false);
			expect(decisions.get(first.id)?.result).toEqual({ maxItems: 200, candidateCount: 0 });
			expect(yield* planner.prepareBatch(input)).toEqual(first);
			expect(batchSelections).toEqual([]);
			yield* planner.prepareBatch({
				...input,
				identity: ["ordinary"],
				commandInput: { afterHooks: "skip" },
				command: { ...command, writeContext: null },
			});
			expect(batchSelections).toEqual(["entity"]);
		}),
	),
);
