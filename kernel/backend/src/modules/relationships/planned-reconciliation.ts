import type {
	AutomationRelationshipRequestPayload,
	AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { Effect, Schema } from "effect";

import type {
	CommittedLifecycleWork,
	LifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import {
	makeReceiptBatches,
	type MutationReceiptRecord,
	mutationReceiptRecord,
} from "#modules/entities/mutation-persistence";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { mutationReceiptIdentity, mutationReceiptOwner } from "#modules/mutations/receipts";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";

import {
	classifyRelationshipReceiptConflict,
	makeRelationshipMutationPrimitives,
	relationshipPopulation,
	type ValidatedMutation,
} from "./mutation-primitives";
import {
	activeTransactionGuard,
	itemCommand,
	parseProperties,
	type PlannedRelationshipReconciliationResult,
	type ReconcileGlobalRelationshipGroup,
	relationshipKey,
	type RelationshipMutationDependencies,
	relationshipReceiptIdentity,
	type RelationshipReconciliationScope,
	RelationshipRecordedResult,
	snapshot,
	validateUserRelationshipEntities,
} from "./mutation-support";
import {
	type RelationshipIdentityInput,
	relationshipMutationLockKey,
	type RelationshipReconciliationListInput,
} from "./repository";

/** Provider population reconciliation, persisted inside the caller's active transaction. */
export const makePlannedRelationshipReconciliation = (
	dependencies: RelationshipMutationDependencies,
) => {
	const { session, planner, runtime, entities, receipts, repository, definitions } = dependencies;
	const primitives = makeRelationshipMutationPrimitives(dependencies);
	const { lookupReceipts, insertReceipts } = makeReceiptBatches(receipts);
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
		command: DomainLifecycleCommand,
		scope: RelationshipReconciliationScope,
	) {
		yield* assertActiveTransaction;
		const scopeUserId = scope.scope === "user" ? scope.userId : null;
		const pinOf = yield* primitives.verifyWrites(
			groups.map((group) => ({ command, scopeUserId, owner: group.relationshipSchema.owner })),
		);
		const groupReceipts = groups.map((_, groupIndex) =>
			mutationReceiptIdentity({
				scopeUserId,
				commandKind: "relationship:reconcile",
				ownerUserId: mutationReceiptOwner(command, scopeUserId),
				input: { scope, groups, writeContext: command.writeContext },
				command: { ...command, itemIdentity: `${command.itemIdentity}:group:${groupIndex}` },
			}),
		);
		const recorded = yield* lookupReceipts(groupReceipts, GroupResult).pipe(
			Effect.mapError(classifyRelationshipReceiptConflict),
		);
		if (recorded.every((entry) => entry !== null)) {
			return {
				result: recorded.map((entry) => entry.result),
				dispatch: recorded.flatMap((entry) => entry.dispatch),
			} satisfies CommittedLifecycleWork<PlannedRelationshipReconciliationResult>;
		}
		yield* runtime.lockCatalog();
		const references = groups.map((group) => group.relationshipSchema);
		const schemas =
			scope.scope === "user"
				? yield* definitions.findUserRelationshipSchemas(scope.userId, references)
				: yield* definitions.findGlobalRelationshipSchemas(references);
		const dispatch: LifecycleDispatchPlan[] = [];
		const groupRecords: MutationReceiptRecord[] = [];
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
			const reference = group.relationshipSchema;
			const definition = schemas[definitionKey("relationship", reference.owner, reference.slug)];
			if (!definition) {
				return yield* new RelationshipNotFound({
					reason: { schema: reference, code: "relationship-schema-not-found" },
				});
			}
			const selector = {
				...group.selector,
				...scope,
				relationshipSchemaSlug: group.relationshipSchema.slug,
				relationshipSchemaPluginId: definition.pluginId ?? null,
			} satisfies RelationshipReconciliationListInput;
			const scopes =
				scope.scope === "user"
					? yield* entities.getEntityScopesForUser(
							group.relationships.flatMap(({ sourceEntityId, targetEntityId }) => [
								sourceEntityId,
								targetEntityId,
							]),
							scope.userId,
						)
					: new Map();
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
					yield* validateUserRelationshipEntities(scopes, relationship, definition, scope.userId);
				}
				desired.push({
					...relationship,
					properties: yield* parseProperties(relationship.properties, definition.propertiesSchema),
				});
			}
			const sweepGeneration = group.generation?.kind === "sweep" ? group.generation.value : null;
			const existing =
				sweepGeneration === null
					? yield* repository.listRelationshipsForReconciliation(selector)
					: yield* repository.listRelationshipsOutsideGeneration(selector, sweepGeneration);
			const deletions = group.generation?.kind === "page" ? [] : existing;
			const upsertMode = group.generation?.preserveExisting
				? ("ensure" as const)
				: ("upsert" as const);
			const mutations: Array<{
				input: RelationshipIdentityInput;
				mode: "upsert" | "ensure" | "delete";
				command: DomainLifecycleCommand;
				properties: Record<string, unknown>;
			}> = [
				...desired.map((input) => ({ input, mode: upsertMode, properties: input.properties })),
				...deletions
					.filter((input) => !seen.has(relationshipKey(input)))
					.map((input) => ({ input, properties: {}, mode: "delete" as const })),
			]
				.map((change) => {
					const input = {
						...change.input,
						...scope,
						relationshipSchemaSlug: group.relationshipSchema.slug,
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
			const itemReplays = yield* lookupReceipts(itemReceipts, RelationshipRecordedResult).pipe(
				Effect.mapError(classifyRelationshipReceiptConflict),
			);
			yield* primitives.lockMutations(mutations);
			const unrecorded = mutations.filter((_, index) => itemReplays[index] === null);
			const reads = yield* primitives.readEntities(unrecorded);
			const rows = yield* repository.findRelationships(unrecorded.map(({ input }) => input));
			const prepared: Array<{
				input: RelationshipIdentityInput;
				mode: "upsert" | "ensure" | "delete";
				command: DomainLifecycleCommand;
				validated: ValidatedMutation | null;
				before: AutomationRelationshipSnapshot | null;
				request: AutomationRelationshipRequestPayload | null;
			}> = [];
			for (const [index, mutation] of mutations.entries()) {
				if (itemReplays[index]) {
					prepared.push({ ...mutation, before: null, request: null, validated: null });
					continue;
				}
				const row = rows.get(relationshipMutationLockKey(mutation.input));
				const before = row ? yield* snapshot(row) : null;
				const validated = yield* primitives.validateMutation(mutation, reads, pinOf(mutation));
				const request = yield* primitives.prepareRequest(
					{ ...mutation, propertiesSchema: definition.propertiesSchema },
					before,
					validated,
				);
				prepared.push({ ...mutation, before, request, validated });
			}
			const counts = {
				createdCount: prepared.filter(({ request }) => request?.operation === "create").length,
				updatedCount: prepared.filter(({ request }) => request?.operation === "update").length,
				deletedCount: prepared.filter(({ request }) => request?.operation === "delete").length,
			};
			let changedIndex = 0;
			const groupDispatch: LifecycleDispatchPlan[] = [];
			const itemRecords: MutationReceiptRecord[] = [];
			const unreplayed = prepared.flatMap((item, index) =>
				item.validated === null
					? []
					: [
							{
								index,
								mutation: item,
								before: item.before,
								request: item.request,
								validated: item.validated,
							},
						],
			);
			const persisted = new Map(
				(yield* primitives.persistSources(unreplayed)).map((source, position) => [
					unreplayed[position]?.index,
					source,
				]),
			);
			if (group.generation?.kind === "page") {
				yield* repository.stampRelationshipGeneration(
					mutations.map(({ input }) => input),
					group.generation.value,
				);
			}
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
				const source = persisted.get(index);
				if (!source) {
					return yield* Effect.die("Missing persisted relationship reconciliation source");
				}
				const { payload, ...itemResult } = source;
				if (!payload) {
					itemRecords.push(
						mutationReceiptRecord({
							index,
							dispatch: [],
							batch: decision,
							identity: receipt,
							result: itemResult,
						}),
					);
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
					requestId: null,
				});
				itemRecords.push(
					mutationReceiptRecord({
						index,
						batch: decision,
						evidence: change,
						identity: receipt,
						result: itemResult,
						dispatch: itemDispatch,
					}),
				);
				groupDispatch.push(...itemDispatch);
			}
			yield* insertReceipts(itemRecords);
			groupDispatch.push(...(yield* planner.planBatch(batchScope)));
			const groupResult = {
				upserted: desired.length,
				created: counts.createdCount,
				updated: counts.updatedCount,
				deleted: counts.deletedCount,
			};
			groupRecords.push({ result: groupResult, identity: groupReceipt, dispatch: groupDispatch });
			result.push(groupResult);
			dispatch.push(...groupDispatch);
		}
		yield* insertReceipts(groupRecords);
		return {
			result,
			dispatch,
		} satisfies CommittedLifecycleWork<PlannedRelationshipReconciliationResult>;
	});
	return { persistPlannedReconciliation };
};
