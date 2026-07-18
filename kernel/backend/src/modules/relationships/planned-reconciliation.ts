import {
	AutomationRelationshipDraft,
	type AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { Effect, Schema } from "effect";

import {
	LifecyclePersistenceError,
	type CommittedLifecycleWork,
	type LifecyclePlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { EntitiesRepository } from "#modules/entities/repository";

import {
	activeTransactionGuard,
	badProperties,
	equal,
	itemCommand,
	parseProperties,
	relationshipChange,
	relationshipKey,
	snapshot,
	validateUserRelationshipEntities,
	type PlannedRelationshipReconciliationResult,
	type ReconcileGlobalRelationshipGroup,
	type RelationshipMutationDependencies,
	type RelationshipRequest,
	type RelationshipReconciliationScope,
} from "./mutation-support";
import {
	relationshipMutationLockKey,
	type RelationshipIdentityInput,
	type RelationshipReconciliationListInput,
} from "./repository";

/** Provider population reconciliation, persisted inside the caller's active transaction. */
export const makePlannedRelationshipReconciliation = ({
	client,
	planner,
	runtime,
	repository,
}: Omit<RelationshipMutationDependencies, "execution">) => {
	const assertActiveTransaction = activeTransactionGuard(client);
	const persistPlannedReconciliation = Effect.fn(
		"RelationshipsService.persistPlannedReconciliation",
	)(function* (
		groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
		command: LifecycleCommand,
		scope: RelationshipReconciliationScope,
	) {
		yield* assertActiveTransaction;
		const entities = yield* EntitiesRepository;
		yield* runtime.lockCatalog();
		const effectiveDefinitions =
			scope.scope === "user" ? yield* runtime.getEffectiveDefinitions(scope.userId) : null;
		const globalDefinitions =
			scope.scope === "global" ? yield* runtime.getGlobalDefinitions() : null;
		const scopeUserId = scope.scope === "user" ? scope.userId : null;
		const plans: LifecyclePlan[] = [];
		const result: Array<PlannedRelationshipReconciliationResult[number]> = [];
		for (const [groupIndex, group] of groups.entries()) {
			const definition =
				scope.scope === "global"
					? globalDefinitions?.relationshipSchemas[group.relationshipSchemaSlug]
					: effectiveDefinitions?.relationshipSchemas[group.relationshipSchemaSlug];
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
				...scope,
				relationshipSchemaSlug: group.relationshipSchemaSlug,
				relationshipSchemaPluginId: definition.pluginId ?? null,
			} satisfies RelationshipReconciliationListInput;
			const seen = new Set<string>();
			const desired: Array<
				ReconcileGlobalRelationshipGroup["relationships"][number] & {
					properties: Record<string, unknown>;
				}
			> = [];
			for (const relationship of group.relationships) {
				let matches = relationship.sourceEntityId === relationship.targetEntityId;
				if (group.selector.type !== "self") {
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
				if (scope.scope === "user") {
					yield* validateUserRelationshipEntities(scope.userId, relationship, definition);
				}
				desired.push({
					...relationship,
					properties: yield* parseProperties(relationship.properties, definition.propertiesSchema),
				});
			}
			const existing = yield* repository.listRelationshipsForReconciliation(selector);
			const mutations: Array<{
				input: RelationshipIdentityInput;
				mode: "upsert" | "delete";
				command: LifecycleCommand;
				properties: Record<string, unknown>;
			}> = [
				...desired.map((input) => ({
					input,
					mode: "upsert" as const,
					properties: input.properties,
				})),
				...existing
					.filter((input) => !seen.has(relationshipKey(input)))
					.map((input) => ({ input, properties: {}, mode: "delete" as const })),
			]
				.map((change) => {
					const input = {
						...change.input,
						...scope,
						relationshipSchemaSlug: group.relationshipSchemaSlug,
						relationshipSchemaPluginId: definition.pluginId ?? null,
					};
					return {
						input,
						mode: change.mode,
						properties: change.properties,
						command: itemCommand(command, input, `group:${groupIndex}:${change.mode}`),
					};
				})
				.sort((left, right) =>
					relationshipMutationLockKey(left.input).localeCompare(
						relationshipMutationLockKey(right.input),
					),
				);
			yield* entities.lockEntityReferencesByIds(
				mutations.flatMap(({ input }) => [input.sourceEntityId, input.targetEntityId]),
			);
			yield* repository.lockRelationshipMutations(mutations.map(({ input }) => input));
			const prepared: Array<{
				input: RelationshipIdentityInput;
				mode: "upsert" | "delete";
				command: LifecycleCommand;
				before: AutomationRelationshipSnapshot | null;
				request: RelationshipRequest | null;
				requestPlan: LifecyclePlan | null;
			}> = [];
			for (const mutation of mutations) {
				const row = yield* repository.findRelationship(mutation.input);
				const before = row ? yield* snapshot(row) : null;
				let request: RelationshipRequest;
				if (mutation.mode === "delete") {
					if (before === null) {
						prepared.push({ ...mutation, before, request: null, requestPlan: null });
						continue;
					}
					request = {
						draft: before,
						category: "request",
						operation: "delete",
						resource: "relationship",
					};
				} else {
					if (before !== null && equal(before.properties, mutation.properties)) {
						prepared.push({ ...mutation, before, request: null, requestPlan: null });
						continue;
					}
					const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
						properties: mutation.properties,
						sourceEntityId: mutation.input.sourceEntityId,
						targetEntityId: mutation.input.targetEntityId,
						relationshipSchemaSlug: mutation.input.relationshipSchemaSlug,
					}).pipe(Effect.mapError(() => badProperties([])));
					request = before
						? { draft, before, category: "request", operation: "update", resource: "relationship" }
						: { draft, category: "request", operation: "create", resource: "relationship" };
				}
				const requestPlan = yield* planner.plan({
					trigger: lifecycleTrigger(mutation.command, scopeUserId, request),
				});
				if (requestPlan.trigger.blockedReason !== null) {
					return yield* new RelationshipBadRequest({
						reason: { code: "automation-limit-reached" },
					});
				}
				if (requestPlan.policies.length > 0) {
					return yield* new LifecyclePersistenceError({ code: "before-policy-requires-owner" });
				}
				prepared.push({ ...mutation, before, request, requestPlan });
			}
			const counts = {
				createdCount: prepared.filter(({ request }) => request?.operation === "create").length,
				updatedCount: prepared.filter(({ request }) => request?.operation === "update").length,
				deletedCount: prepared.filter(({ request }) => request?.operation === "delete").length,
			};
			let changedIndex = 0;
			for (const item of prepared) {
				if (item.request === null) {
					continue;
				}
				if (item.requestPlan === null) {
					return yield* Effect.die("Planned relationship request is missing its plan");
				}
				let saved;
				if (item.request.operation === "delete") {
					saved = yield* repository.deleteRelationship(item.input);
				} else if (item.request.operation === "create") {
					saved = yield* repository.createRelationship({
						...item.input,
						properties: { ...item.request.draft.properties },
					});
				} else {
					saved = yield* repository.updateRelationship({
						...item.input,
						properties: { ...item.request.draft.properties },
					});
				}
				if (!saved) {
					return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
				}
				const persistedSnapshot = yield* snapshot(saved);
				const population = item.command.population
					? {
							...item.command.population,
							...(item.command.population.batch
								? {
										batch: {
											...item.command.population.batch,
											...counts,
											beforeCount: existing.length,
											isLeader: changedIndex === 0,
											afterCount: existing.length + counts.createdCount - counts.deletedCount,
										},
									}
								: {}),
						}
					: undefined;
				changedIndex += 1;
				const changePlan = yield* planner.plan({
					trigger: lifecycleTrigger(
						{
							...item.command,
							causation: {
								...item.command.causation,
								parentTriggerId: item.requestPlan.trigger.id,
							},
						},
						scopeUserId,
						{
							...relationshipChange(item.request, persistedSnapshot),
							...(population === undefined ? {} : { population }),
						},
					),
				});
				plans.push(changePlan);
			}
			result.push({
				upserted: desired.length,
				created: counts.createdCount,
				updated: counts.updatedCount,
				deleted: counts.deletedCount,
			});
		}
		return {
			plans,
			result,
		} satisfies CommittedLifecycleWork<PlannedRelationshipReconciliationResult>;
	});
	return { persistPlannedReconciliation };
};
