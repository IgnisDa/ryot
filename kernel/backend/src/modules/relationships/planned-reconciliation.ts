import type {
	AutomationRelationshipRequestPayload,
	AutomationRelationshipSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import { RelationshipNotFound } from "@ryot-app/contract/modules/relationships/schemas";
import { Effect } from "effect";

import type {
	CommittedLifecycleWork,
	LifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { mutationUserIds } from "#modules/mutations/account-admission";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";

import {
	makeRelationshipMutationPrimitives,
	relationshipPopulation,
	type ValidatedMutation,
} from "./mutation-primitives";
import {
	activeTransactionGuard,
	emptyUserEntityScopes,
	itemCommand,
	parseProperties,
	type PlannedRelationshipReconciliationResult,
	type ReconcileGlobalRelationshipGroup,
	reconciliationKeys,
	type RelationshipMutationDependencies,
	type RelationshipReconciliationScope,
	retiredRelationships,
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
	const { session, planner, runtime, entities, repository, definitions } = dependencies;
	const primitives = makeRelationshipMutationPrimitives(dependencies);
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
		yield* runtime.lockCatalog(mutationUserIds(command, scopeUserId));
		const references = groups.map((group) => group.relationshipSchema);
		const schemas =
			scope.scope === "user"
				? yield* definitions.findUserRelationshipSchemas(scope.userId, references)
				: yield* definitions.findGlobalRelationshipSchemas(references);
		const dispatch: LifecycleDispatchPlan[] = [];
		const result: Array<PlannedRelationshipReconciliationResult[number]> = [];
		for (const [groupIndex, group] of groups.entries()) {
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
					: emptyUserEntityScopes();
			const seen = yield* reconciliationKeys(group);
			const desired: Array<
				{
					properties: Record<string, unknown>;
				} & ReconcileGlobalRelationshipGroup["relationships"][number]
			> = [];
			for (const relationship of group.relationships) {
				if (scope.scope === "user") {
					yield* validateUserRelationshipEntities(scopes, relationship, definition, scope.userId);
				}
				desired.push({
					...relationship,
					properties: yield* parseProperties(relationship.properties, definition.propertiesSchema),
				});
			}
			const { paging } = group;
			const existing = yield* repository.listRelationshipsForReconciliation(selector);
			let deletions = existing;
			if (paging?.kind === "page") {
				deletions = [];
			} else if (paging?.kind === "sweep") {
				deletions = existing.filter(
					(relationship) =>
						!paging.kept.has(relationship.sourceEntityId) &&
						!paging.kept.has(relationship.targetEntityId),
				);
			}
			const upsertMode =
				paging?.kind === "page" && paging.preserveExisting
					? ("ensure" as const)
					: ("upsert" as const);
			const mutations: Array<{
				command: DomainLifecycleCommand;
				input: RelationshipIdentityInput;
				properties: Record<string, unknown>;
				mode: "upsert" | "ensure" | "delete";
			}> = [
				...desired.map((input) => ({ input, mode: upsertMode, properties: input.properties })),
				...retiredRelationships(deletions, seen).map((input) => ({
					input,
					properties: {},
					mode: "delete" as const,
				})),
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
			yield* primitives.lockMutations(mutations);
			const reads = yield* primitives.readEntities(mutations);
			const rows = yield* repository.findRelationships(mutations.map(({ input }) => input));
			const prepared: Array<{
				validated: ValidatedMutation;
				command: DomainLifecycleCommand;
				input: RelationshipIdentityInput;
				mode: "upsert" | "ensure" | "delete";
				before: null | AutomationRelationshipSnapshot;
				request: null | AutomationRelationshipRequestPayload;
			}> = [];
			for (const mutation of mutations) {
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
			const persisted = yield* primitives.persistSources(
				prepared.map((item) => ({
					mutation: item,
					before: item.before,
					request: item.request,
					validated: item.validated,
				})),
			);
			for (const [index, item] of prepared.entries()) {
				const source = persisted[index];
				if (!source) {
					return yield* Effect.die("Missing persisted relationship reconciliation source");
				}
				const { payload } = source;
				if (!payload) {
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
				yield* planner.recordBatchChange(decision.id, { index, scopeUserId, payload: change });
				groupDispatch.push(...itemDispatch);
			}
			groupDispatch.push(...(yield* planner.planBatch(batchScope)));
			const groupResult = {
				upserted: desired.length,
				created: counts.createdCount,
				updated: counts.updatedCount,
				deleted: counts.deletedCount,
			};
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
