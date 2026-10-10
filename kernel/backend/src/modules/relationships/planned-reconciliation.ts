import type {
	AutomationRelationshipRequestPayload,
	AutomationRelationshipSnapshot,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { Effect, Schema } from "effect";

import {
	LifecyclePersistenceError,
	type CommittedLifecycleWork,
	type LifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { mutationReceiptIdentity, mutationReceiptOwner } from "#modules/mutations/receipts";
import { catalogDefinitionFingerprint } from "#modules/plugins/runtime-resolver";

import {
	classifyRelationshipReceiptConflict,
	makeRelationshipMutationPrimitives,
	relationshipPopulation,
} from "./mutation-primitives";
import {
	activeTransactionGuard,
	itemCommand,
	parseProperties,
	relationshipReceiptIdentity,
	RelationshipRecordedResult,
	relationshipKey,
	snapshot,
	validateUserRelationshipEntities,
	type PlannedRelationshipReconciliationResult,
	type ReconcileGlobalRelationshipGroup,
	type RelationshipMutationDependencies,
	type RelationshipReconciliationScope,
} from "./mutation-support";
import {
	relationshipMutationLockKey,
	type RelationshipIdentityInput,
	type RelationshipReconciliationListInput,
} from "./repository";

/** Provider population reconciliation, persisted inside the caller's active transaction. */
export const makePlannedRelationshipReconciliation = (
	dependencies: RelationshipMutationDependencies,
) => {
	const { session, planner, runtime, entities, receipts, repository, definitions } = dependencies;
	const primitives = makeRelationshipMutationPrimitives(dependencies);
	const GroupResult = Schema.Struct({
		created: Schema.Finite,
		updated: Schema.Finite,
		deleted: Schema.Finite,
		upserted: Schema.Finite,
	});
	const assertActiveTransaction = activeTransactionGuard(session);
	const persistPlannedReconciliation = Effect.fn(
		"RelationshipsService.persistPlannedReconciliation",
	)(function* (
		groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
		command: LifecycleCommand,
		scope: RelationshipReconciliationScope,
	) {
		yield* assertActiveTransaction;
		const scopeUserId = scope.scope === "user" ? scope.userId : null;
		const groupReceipts = groups.map((_, groupIndex) =>
			mutationReceiptIdentity({
				scopeUserId,
				input: { scope, groups },
				commandKind: "relationship:reconcile",
				ownerUserId: mutationReceiptOwner(command, scopeUserId),
				command: { ...command, itemIdentity: `${command.itemIdentity}:group:${groupIndex}` },
			}),
		);
		const recorded = yield* Effect.forEach(groupReceipts, (identity) =>
			receipts
				.lookup(identity, GroupResult)
				.pipe(Effect.mapError(classifyRelationshipReceiptConflict)),
		);
		if (recorded.every((entry) => entry !== null)) {
			return {
				result: recorded.map((entry) => entry.result),
				dispatch: recorded.flatMap((entry) => entry.dispatch),
			} satisfies CommittedLifecycleWork<PlannedRelationshipReconciliationResult>;
		}
		yield* runtime.lockCatalog();
		const slugs = groups.map(({ relationshipSchemaSlug }) => relationshipSchemaSlug);
		const schemas =
			scope.scope === "user"
				? yield* definitions.findUserRelationshipSchemas(scope.userId, slugs)
				: (yield* definitions.getGlobalSnapshot).relationshipSchemas;
		const dispatch: LifecycleDispatchPlan[] = [];
		const result: Array<PlannedRelationshipReconciliationResult[number]> = [];
		for (const [groupIndex, group] of groups.entries()) {
			const groupReceipt = groupReceipts[groupIndex];
			if (!groupReceipt) {
				return yield* Effect.die("Missing relationship reconciliation group identity");
			}
			const previous = recorded[groupIndex];
			if (previous) {
				result.push(previous.result);
				dispatch.push(...previous.dispatch);
				continue;
			}
			const definition = schemas[group.relationshipSchemaSlug];
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
					yield* validateUserRelationshipEntities(entities, scope.userId, relationship, definition);
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
						propertiesSchema: definition.propertiesSchema,
						schemaFingerprint: catalogDefinitionFingerprint(definition),
						command: itemCommand(command, input, `group:${groupIndex}:${change.mode}`),
					};
				})
				.sort((left, right) =>
					relationshipMutationLockKey(left.input).localeCompare(
						relationshipMutationLockKey(right.input),
					),
				);
			const batchScope = {
				command,
				resource: "relationship" as const,
				identity: [`group:${groupIndex}`],
			};
			const decision = yield* planner.prepareBatch({ ...batchScope, scopes: [scopeUserId] });
			const itemReceipts = mutations.map(relationshipReceiptIdentity);
			const itemReplays = yield* Effect.forEach(itemReceipts, (identity) =>
				receipts
					.lookup(identity, RelationshipRecordedResult)
					.pipe(Effect.mapError(classifyRelationshipReceiptConflict)),
			);
			yield* primitives.lockMutations(mutations);
			const prepared: Array<{
				input: RelationshipIdentityInput;
				mode: "upsert" | "delete";
				command: LifecycleCommand;
				before: AutomationRelationshipSnapshot | null;
				request: AutomationRelationshipRequestPayload | null;
				requestId: LifecycleCommand["causation"]["parentTriggerId"];
			}> = [];
			for (const [index, mutation] of mutations.entries()) {
				if (itemReplays[index]) {
					prepared.push({ ...mutation, before: null, request: null, requestId: null });
					continue;
				}
				const row = yield* repository.findRelationship(mutation.input);
				const before = row ? yield* snapshot(row) : null;
				const request = yield* primitives.prepareRequest(
					{ ...mutation, propertiesSchema: definition.propertiesSchema },
					before,
				);
				if (!request) {
					prepared.push({ ...mutation, before, request: null, requestId: null });
					continue;
				}
				const requestPlan = yield* planner.plan({
					trigger: lifecycleTrigger(mutation.command, scopeUserId, request),
				});
				if (requestPlan.trigger?.blockedReason) {
					return yield* new RelationshipBadRequest({
						reason: { code: "automation-limit-reached" },
					});
				}
				if (requestPlan.policies.length > 0) {
					return yield* new LifecyclePersistenceError({ code: "before-policy-requires-owner" });
				}
				prepared.push({ ...mutation, before, request, requestId: requestPlan.trigger?.id ?? null });
			}
			const counts = {
				createdCount: prepared.filter(({ request }) => request?.operation === "create").length,
				updatedCount: prepared.filter(({ request }) => request?.operation === "update").length,
				deletedCount: prepared.filter(({ request }) => request?.operation === "delete").length,
			};
			let changedIndex = 0;
			const groupDispatch: LifecycleDispatchPlan[] = [];
			for (const [index, item] of prepared.entries()) {
				const receipt = itemReceipts[index];
				if (!receipt) {
					return yield* Effect.die("Missing relationship reconciliation identity");
				}
				const replay = itemReplays[index];
				if (replay) {
					groupDispatch.push(...replay.dispatch);
					continue;
				}
				const { payload, ...itemResult } = yield* primitives.persistSource(
					item,
					item.request,
					item.before,
				);
				if (!payload) {
					yield* primitives.recordResult({
						index,
						dispatch: [],
						batch: decision,
						identity: receipt,
						result: itemResult,
					});
					continue;
				}
				const population = relationshipPopulation(
					item.command,
					counts,
					existing.length,
					changedIndex === 0,
				);
				changedIndex += 1;
				const { change, dispatch: itemDispatch } = yield* primitives.planChange({
					payload,
					population,
					mutation: item,
					requestId: item.requestId,
				});
				yield* primitives.recordResult({
					index,
					batch: decision,
					evidence: change,
					identity: receipt,
					result: itemResult,
					dispatch: itemDispatch,
				});
				groupDispatch.push(...itemDispatch);
			}
			groupDispatch.push(...(yield* planner.planBatch(batchScope)));
			const groupResult = {
				upserted: desired.length,
				created: counts.createdCount,
				updated: counts.updatedCount,
				deleted: counts.deletedCount,
			};
			yield* receipts.insert({
				result: groupResult,
				identity: groupReceipt,
				dispatch: groupDispatch,
			});
			result.push(groupResult);
			dispatch.push(...groupDispatch);
		}
		return {
			result,
			dispatch,
		} satisfies CommittedLifecycleWork<PlannedRelationshipReconciliationResult>;
	});
	return { persistPlannedReconciliation };
};
