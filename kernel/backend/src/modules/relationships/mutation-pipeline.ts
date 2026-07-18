import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRelationshipDraft,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
	type RelationshipBatchResult,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { RelationshipId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Effect, Schema } from "effect";

import { LifecyclePlanner, lifecycleTriggerId } from "#lib/domain/lifecycle";
import { lifecycleTrigger, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type { RelationshipSchemaDefinition } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	catalogDefinitionFingerprint,
	PluginRuntimeResolver,
} from "#modules/plugins/runtime-resolver";

import {
	assertRootTransaction,
	badProperties,
	equal,
	itemCommand,
	mergeProperties,
	parseProperties,
	populationIdentity,
	relationshipChange,
	relationshipKey,
	snapshot,
	transaction,
	validateUserIdentity,
	type ChangeUserRelationshipBatch,
	type Mutation,
	type ReconcileGlobalRelationshipGroup,
	type RelationshipRequest,
} from "./mutation-support";
import {
	RelationshipsRepository,
	relationshipMutationLockKey,
	type GlobalRelationshipListInput,
} from "./repository";

export const mutateRelationships = Effect.fn("RelationshipsService.mutate")(function* (
	mutations: ReadonlyArray<Mutation>,
	selector?: GlobalRelationshipListInput,
	expectedSelection?: ReadonlyArray<{ id: RelationshipId }>,
) {
	yield* assertRootTransaction;
	const repository = yield* RelationshipsRepository;
	const entities = yield* EntitiesRepository;
	const planner = yield* LifecyclePlanner;
	const execution = yield* LifecycleExecution;
	const runtime = yield* PluginRuntimeResolver;
	const ordered = [...mutations].sort((left, right) =>
		relationshipMutationLockKey(left.input).localeCompare(relationshipMutationLockKey(right.input)),
	);
	const lock = Effect.gen(function* () {
		if (selector) {
			const selection = yield* repository.listGlobalRelationships(selector);
			if (
				expectedSelection &&
				!equal(selection.map(({ id }) => id).sort(), expectedSelection.map(({ id }) => id).sort())
			) {
				return yield* new RelationshipBadRequest({
					reason: { code: "concurrent-relationship-change" },
				});
			}
		}
		yield* entities.lockEntityReferencesByIds(
			ordered.flatMap(({ input }) => [input.sourceEntityId, input.targetEntityId]),
		);
		yield* repository.lockRelationshipMutations(ordered.map(({ input }) => input));
		return undefined;
	});
	const prepared = yield* transaction(
		Effect.gen(function* () {
			yield* lock;
			return yield* Effect.forEach(ordered, (mutation) =>
				Effect.gen(function* () {
					const { mode, input, command } = mutation;
					let replay: RelationshipRequest | null = null;
					for (const operation of ["create", "update", "delete"] as const) {
						const payload = yield* repository.findLifecyclePayload(
							lifecycleTriggerId({
								discriminator: "lifecycle",
								itemIdentity: command.itemIdentity,
								executionId: command.causation.executionId,
								kind: { operation, category: "request", resource: "relationship" },
							}),
						);
						if (payload?.category === "request" && payload.resource === "relationship") {
							replay = payload;
						}
					}
					const row = yield* repository.findRelationship(input);
					let before = row ? yield* snapshot(row) : null;
					if (replay) {
						switch (replay.operation) {
							case "create":
								before = null;
								break;
							case "delete":
								before = replay.draft;
								break;
							case "update":
								before = replay.before;
								break;
						}
					}
					if (!before && mode === "update") {
						return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
					}
					if (!before && mode === "delete") {
						return { before, mutation, plan: null, request: null };
					}
					let request: RelationshipRequest;
					if (mode === "delete" && before) {
						request = {
							draft: before,
							category: "request",
							operation: "delete",
							resource: "relationship",
						};
					} else {
						if (!mutation.propertiesSchema) {
							return yield* new DbError({ message: "Missing relationship property schema" });
						}
						const properties =
							mode === "merge"
								? mergeProperties(before?.properties, mutation.properties)
								: mutation.properties;
						const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
							properties,
							sourceEntityId: input.sourceEntityId,
							targetEntityId: input.targetEntityId,
							relationshipSchemaSlug: input.relationshipSchemaSlug,
						}).pipe(Effect.mapError(() => badProperties([])));
						if (!replay && before && equal(before.properties, draft.properties)) {
							return { before, mutation, plan: null, request: null };
						}
						request = before
							? {
									draft,
									before,
									category: "request",
									operation: "update",
									resource: "relationship",
								}
							: { draft, category: "request", operation: "create", resource: "relationship" };
					}
					if (replay && !equal(replay, request)) {
						return yield* new RelationshipBadRequest({
							reason: { code: "lifecycle-command-conflict" },
						});
					}
					const plan = yield* planner.plan({
						trigger: lifecycleTrigger(
							command,
							input.scope === "user" ? input.userId : null,
							request,
						),
					});
					return { plan, before, request, mutation };
				}),
			);
		}),
	);
	const accepted = yield* Effect.forEach(prepared, (item) =>
		Effect.gen(function* () {
			if (!item.request) {
				return { ...item, final: null };
			}
			if (item.plan.trigger.blockedReason) {
				return yield* new RelationshipBadRequest({ reason: { code: "automation-limit-reached" } });
			}
			let request = item.request;
			for (const policy of item.plan.policies) {
				const output = yield* execution
					.executePolicy({ payload: request, runId: policy.runId })
					.pipe(
						Effect.catchTag("AutomationPolicyExecutionError", (error) =>
							Effect.fail(
								new RelationshipBadRequest({
									reason: { runId: error.runId, code: "policy-execution-failed" },
								}),
							),
						),
					);
				if (output.action === "reject") {
					return yield* new RelationshipBadRequest({
						reason: { runId: policy.runId, code: "policy-rejected" },
					});
				}
				if (output.action === "transform") {
					if (
						output.payload.resource !== "relationship" ||
						output.payload.operation !== request.operation
					) {
						return yield* new RelationshipBadRequest({
							reason: { runId: policy.runId, code: "policy-rejected" },
						});
					}
					if (request.operation !== "delete") {
						request = Object.assign({}, request, {
							draft: { ...request.draft, properties: output.payload.draft.properties },
						});
					}
				}
			}
			if (request.operation !== "delete") {
				if (!item.mutation.propertiesSchema) {
					return yield* new DbError({ message: "Missing relationship property schema" });
				}
				const properties = yield* parseProperties(
					request.draft.properties,
					item.mutation.propertiesSchema,
				);
				const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
					...request.draft,
					properties,
				}).pipe(Effect.mapError(() => badProperties([])));
				request = { ...request, draft };
			}
			return { ...item, final: request };
		}),
	).pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) =>
				Effect.forEach(prepared, (item) =>
					item.plan
						? execution.skipQueuedPolicies({ triggerId: item.plan.trigger.id })
						: Effect.void,
				).pipe(Effect.andThen(Effect.failCause(cause)), Effect.uninterruptible),
		),
	);
	const committed = yield* transaction(
		Effect.gen(function* () {
			let revalidated = accepted;
			if (accepted.some(({ final }) => final !== null && final.operation !== "delete")) {
				yield* runtime.lockCatalog();
				const userCatalogs = new Map<
					UserId,
					Effect.Success<ReturnType<typeof runtime.getEffectiveDefinitions>>
				>();
				let globalCatalog: Effect.Success<ReturnType<typeof runtime.getGlobalDefinitions>> | null =
					null;
				revalidated = yield* Effect.forEach(accepted, (item) =>
					Effect.gen(function* () {
						const { mutation } = item;
						if (item.final === null || item.final.operation === "delete") {
							return item;
						}
						const expected = mutation.schemaFingerprint;
						if (!expected) {
							return yield* new RelationshipBadRequest({
								reason: { code: "concurrent-relationship-change" },
							});
						}
						let definition: RelationshipSchemaDefinition | undefined;
						if (mutation.input.scope === "user") {
							let catalog = userCatalogs.get(mutation.input.userId);
							if (!catalog) {
								catalog = yield* runtime.getEffectiveDefinitions(mutation.input.userId);
								userCatalogs.set(mutation.input.userId, catalog);
							}
							definition = catalog.relationshipSchemas[mutation.input.relationshipSchemaSlug];
						} else {
							globalCatalog ??= yield* runtime.getGlobalDefinitions();
							definition = globalCatalog.relationshipSchemas[mutation.input.relationshipSchemaSlug];
						}
						if (
							!definition ||
							(definition.pluginId ?? null) !==
								(mutation.input.relationshipSchemaPluginId ?? null) ||
							!equal(catalogDefinitionFingerprint(definition), expected)
						) {
							return yield* new RelationshipBadRequest({
								reason: { code: "concurrent-relationship-change" },
							});
						}
						const properties = yield* parseProperties(
							item.final.draft.properties,
							definition.propertiesSchema,
						);
						const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
							...item.final.draft,
							properties,
						}).pipe(Effect.mapError(() => badProperties([])));
						return { ...item, final: { ...item.final, draft } };
					}),
				);
			}
			yield* lock;
			const results = [];
			for (const item of revalidated) {
				const { input, command } = item.mutation;
				const request = item.final;
				if (request) {
					const prior = yield* repository.findLifecyclePayload(
						lifecycleTriggerId({
							discriminator: "lifecycle",
							itemIdentity: command.itemIdentity,
							executionId: command.causation.executionId,
							kind: { category: "change", resource: "relationship", operation: request.operation },
						}),
					);
					if (prior?.category === "change" && prior.resource === "relationship") {
						const persisted = prior.operation === "delete" ? prior.before : prior.after;
						const draft = {
							properties: persisted.properties,
							sourceEntityId: persisted.sourceEntityId,
							targetEntityId: persisted.targetEntityId,
							relationshipSchemaSlug: persisted.relationshipSchemaSlug,
						};
						if (
							prior.operation !== request.operation ||
							(request.operation === "delete"
								? !equal(request.draft, persisted)
								: !equal(request.draft, draft)) ||
							(request.operation === "update" &&
								prior.operation === "update" &&
								!equal(request.before, prior.before))
						) {
							return yield* new RelationshipBadRequest({
								reason: { code: "lifecycle-command-conflict" },
							});
						}
						const priorPopulation = prior.population;
						if (
							!equal(populationIdentity(priorPopulation), populationIdentity(command.population))
						) {
							return yield* new RelationshipBadRequest({
								reason: { code: "lifecycle-command-conflict" },
							});
						}
						const plan = yield* planner.plan({
							trigger: lifecycleTrigger(
								{
									...command,
									causation: { ...command.causation, parentTriggerId: item.plan.trigger.id },
								},
								input.scope === "user" ? input.userId : null,
								prior,
							),
						});
						const saved = prior.operation === "delete" ? prior.before : prior.after;
						results.push({
							plan,
							operation: "noop" as const,
							relationship: { ...saved, wasInserted: prior.operation === "create" },
						});
						continue;
					}
				}
				const row = yield* repository.findRelationship(input);
				const current = row ? yield* snapshot(row) : null;
				if (!equal(current, item.before)) {
					return yield* new RelationshipBadRequest({
						reason: { code: "concurrent-relationship-change" },
					});
				}
				if (
					!request ||
					(request.operation !== "delete" &&
						current &&
						equal(current.properties, request.draft.properties))
				) {
					results.push({
						plan: null,
						operation: "noop" as const,
						relationship: row ? { ...row, wasInserted: false } : null,
					});
					continue;
				}
				let saved;
				if (request.operation === "delete") {
					saved = yield* repository.deleteRelationship(input);
				} else {
					const write =
						request.operation === "create"
							? repository.createRelationship
							: repository.updateRelationship;
					saved = yield* write({ ...input, properties: { ...request.draft.properties } });
				}
				if (!saved) {
					return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
				}
				const persisted = yield* snapshot(saved);
				const payload = relationshipChange(request, persisted);
				results.push({
					plan: null,
					operation: request.operation,
					pending: { input, payload, command, requestId: item.plan.trigger.id },
					relationship: { ...saved, wasInserted: request.operation === "create" },
				});
			}
			const counts = {
				createdCount: results.filter(({ operation }) => operation === "create").length,
				updatedCount: results.filter(({ operation }) => operation === "update").length,
				deletedCount: results.filter(({ operation }) => operation === "delete").length,
			};
			const beforeCount =
				expectedSelection?.length ?? accepted.filter(({ before }) => before !== null).length;
			let changedIndex = 0;
			return yield* Effect.forEach(results, (result) =>
				Effect.gen(function* () {
					if (!("pending" in result)) {
						return result;
					}
					const { input, payload, command, requestId } = result.pending;
					const population = command.population
						? {
								...command.population,
								...(command.population.batch
									? {
											batch: {
												...command.population.batch,
												...counts,
												beforeCount,
												isLeader: changedIndex === 0,
												afterCount: beforeCount + counts.createdCount - counts.deletedCount,
											},
										}
									: {}),
							}
						: undefined;
					changedIndex += 1;
					const plan = yield* planner.plan({
						trigger: lifecycleTrigger(
							{ ...command, causation: { ...command.causation, parentTriggerId: requestId } },
							input.scope === "user" ? input.userId : null,
							{ ...payload, ...(population === undefined ? {} : { population }) },
						),
					});
					return { plan, operation: result.operation, relationship: result.relationship };
				}),
			);
		}),
	);
	return yield* Effect.forEach(committed, (result) =>
		Effect.gen(function* () {
			const warnings: AutomationWarning[] = [];
			if (result.plan) {
				const { runs, trigger } = result.plan;
				if (trigger.blockedReason?.hasRequiredHooks) {
					warnings.push({ ...trigger.blockedReason, triggerId: trigger.id });
				}
				warnings.push(...(yield* execution.after({ runs, triggerId: trigger.id })));
			}
			return { warnings, operation: result.operation, relationship: result.relationship };
		}),
	);
});

const summarize = (
	results: ReadonlyArray<{ operation: string; warnings: ReadonlyArray<AutomationWarning> }>,
): RelationshipBatchResult => ({
	warnings: results.flatMap((row) => row.warnings),
	created: results.filter((row) => row.operation === "create").length,
	updated: results.filter((row) => row.operation === "update").length,
	deleted: results.filter((row) => row.operation === "delete").length,
});

export const changeUserRelationships = Effect.fn("RelationshipsService.changeUser")(function* (
	userId: UserId,
	batches: ReadonlyArray<ChangeUserRelationshipBatch>,
	command: LifecycleCommand,
) {
	return yield* Effect.forEach(batches, (batch, index) =>
		Effect.gen(function* () {
			const mutations = yield* Effect.forEach(
				[
					...batch.creates.map((input) => ({
						input,
						mode: "upsert" as const,
						properties: input.properties,
					})),
					...batch.deletes.map((input) => ({
						input,
						properties: undefined,
						mode: "delete" as const,
					})),
				],
				(change) =>
					Effect.gen(function* () {
						const definition = yield* validateUserIdentity(userId, change.input);
						const input = {
							...change.input,
							userId,
							scope: "user" as const,
							relationshipSchemaPluginId: definition.pluginId ?? null,
						};
						return {
							input,
							mode: change.mode,
							properties: change.properties,
							propertiesSchema: definition.propertiesSchema,
							schemaFingerprint: catalogDefinitionFingerprint(definition),
							command: itemCommand(command, input, `batch:${index}:${change.mode}`),
						};
					}),
			);
			return summarize(yield* mutateRelationships(mutations));
		}),
	);
});

export const reconcileGlobalRelationships = Effect.fn("RelationshipsService.reconcileGlobal")(
	function* (groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>, command: LifecycleCommand) {
		yield* assertRootTransaction;
		const runtime = yield* PluginRuntimeResolver;
		const repository = yield* RelationshipsRepository;
		const database = yield* Database;
		return yield* Effect.forEach(groups, (group, index) =>
			Effect.gen(function* () {
				const definition = (yield* runtime.getGlobalDefinitions()).relationshipSchemas[
					group.relationshipSchemaSlug
				];
				if (!definition) {
					return yield* new RelationshipNotFound({
						reason: {
							code: "relationship-schema-not-found",
							relationshipSchemaSlug: group.relationshipSchemaSlug,
						},
					});
				}
				const selector = {
					...group.selector,
					relationshipSchemaSlug: group.relationshipSchemaSlug,
					relationshipSchemaPluginId: definition.pluginId ?? null,
				};
				const seen = new Set<string>();
				for (const relationship of group.relationships) {
					let matches = relationship.sourceEntityId === relationship.targetEntityId;
					if (group.selector.type === "anchored") {
						matches =
							group.selector.direction === "outgoing"
								? relationship.sourceEntityId === group.selector.anchorEntityId
								: relationship.targetEntityId === group.selector.anchorEntityId;
					}
					if (!matches) {
						return yield* new RelationshipBadRequest({
							reason: { code: "reconciliation-selector-mismatch" },
						});
					}
					const key = relationshipKey(relationship);
					if (seen.has(key)) {
						return yield* new RelationshipBadRequest({
							reason: { code: "duplicate-reconciliation-relationship" },
						});
					}
					seen.add(key);
				}
				const existing = yield* mapDatabaseErrors(
					database.transaction((tx) =>
						repository.listGlobalRelationships(selector).pipe(Effect.provideService(Database, tx)),
					),
				);
				const mutations = [
					...group.relationships.map((input) => ({ input, mode: "upsert" as const })),
					...existing
						.filter((input) => !seen.has(relationshipKey(input)))
						.map((input) => ({ input, mode: "delete" as const })),
				].map((change) => {
					const input = {
						...change.input,
						scope: "global" as const,
						relationshipSchemaSlug: group.relationshipSchemaSlug,
						relationshipSchemaPluginId: definition.pluginId ?? null,
					};
					return {
						input,
						mode: change.mode,
						properties: change.input.properties,
						propertiesSchema: definition.propertiesSchema,
						schemaFingerprint: catalogDefinitionFingerprint(definition),
						command: itemCommand(command, input, `group:${index}:${change.mode}`),
					};
				});
				const result = summarize(yield* mutateRelationships(mutations, selector, existing));
				return { ...result, upserted: group.relationships.length };
			}),
		);
	},
);
