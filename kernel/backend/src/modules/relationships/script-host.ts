import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, RelationshipSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Effect } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
	type ScriptRunInput,
} from "#modules/scripts/authorization/capabilities";
import { principalOwner } from "#modules/scripts/authorization/principal";
import {
	sandboxLifecycleCommand,
	userSandboxRunUserId,
} from "#modules/scripts/host/execution-context";
import {
	lifecycleHostFailure,
	userLifecycleSource,
	writeInlineLifecycleItems,
	type LifecycleHostInput,
	type LifecycleItemWrite,
} from "#modules/scripts/host/lifecycle-host";

import {
	reconciliationSummary,
	RelationshipBatchSummary,
	RelationshipMutationPipeline,
	RelationshipReconciliationSummary,
	summarizeRelationshipMutations,
	type PendingRelationshipMutations,
} from "./mutation-pipeline";

const toSandboxRelationshipIdentity = <
	T extends {
		readonly sourceEntityId: string;
		readonly targetEntityId: string;
		readonly relationshipSchemaSlug: string;
	},
>(
	relationship: T,
	pluginId: string | null,
) => {
	const { relationshipSchemaSlug, ...identity } = relationship;
	return {
		...identity,
		sourceEntityId: EntityId.make(relationship.sourceEntityId),
		targetEntityId: EntityId.make(relationship.targetEntityId),
		relationshipSchema: {
			owner: definitionOwner(pluginId),
			slug: RelationshipSchemaSlug.make(relationshipSchemaSlug),
		},
	};
};

const toReconcileGroup = (
	group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
	command: DomainLifecycleCommand,
) => ({
	relationshipSchema: {
		owner: principalOwner(command.writeContext),
		slug: RelationshipSchemaSlug.make(group.relationshipSchemaSlug),
	},
	selector:
		group.selector.type === "self"
			? group.selector
			: { ...group.selector, anchorEntityId: EntityId.make(group.selector.anchorEntityId) },
	relationships: group.relationships.map((relationship) => ({
		...relationship,
		sourceEntityId: EntityId.make(relationship.sourceEntityId),
		targetEntityId: EntityId.make(relationship.targetEntityId),
	})),
});

export const relationshipLifecycleHostSteps = (
	relationships: RelationshipMutationPipeline["Service"],
) => {
	const applyRelationshipHostPolicies = (pending: PendingRelationshipMutations) =>
		relationships.applyPolicies(pending).pipe(Effect.mapError(lifecycleHostFailure));
	return {
		changeUserRelationships: {
			value: (results: ReadonlyArray<RelationshipBatchSummary>) =>
				results.map(({ created, deleted }) => ({ created, deleted })),
			validate: (
				rawInput: ScriptRunInput,
				batches: LifecycleHostInput<"ChangeUserRelationships">["batches"],
			): Effect.Effect<LifecycleHostInput<"ChangeUserRelationships">, SandboxHostError> =>
				sandboxHostEffect(
					Effect.gen(function* () {
						const input = yield* requireSandboxCapabilityInput(rawInput, "changeUserRelationships");
						const changeCount = batches.reduce(
							(total, batch) => total + batch.creates.length + batch.deletes.length,
							0,
						);
						if (changeCount > SANDBOX_LIMITS.userRelationshipWrites.changesTotal) {
							return yield* Effect.fail(
								`changeUserRelationships exceeds ${SANDBOX_LIMITS.userRelationshipWrites.changesTotal} changes`,
							);
						}
						const command = yield* sandboxLifecycleCommand(
							input,
							userLifecycleSource(input),
							"changeUserRelationships",
						);
						return {
							batches,
							command,
							_tag: "ChangeUserRelationships",
							userId: UserId.make(userSandboxRunUserId(input)),
						} as const;
					}),
				),
			itemWrite: (input: LifecycleHostInput<"ChangeUserRelationships">) => {
				const batches = input.batches.map((entry) => ({
					creates: entry.creates.map((relationship) =>
						toSandboxRelationshipIdentity(
							relationship,
							input.command.writeContext?.pluginRevision?.id ?? null,
						),
					),
					deletes: entry.deletes.map((relationship) =>
						toSandboxRelationshipIdentity(
							relationship,
							input.command.writeContext?.pluginRevision?.id ?? null,
						),
					),
				}));
				return {
					items: batches,
					result: RelationshipBatchSummary,
					applyPolicies: applyRelationshipHostPolicies,
					commit: () => (pending: PendingRelationshipMutations) =>
						relationships
							.commitProjected(pending, summarizeRelationshipMutations)
							.pipe(Effect.mapError(lifecycleHostFailure)),
					prepare: (current: (typeof batches)[number], index: number) =>
						relationships
							.prepareChangeUserBatch(input.userId, current, index, input.command, batches)
							.pipe(Effect.mapError(lifecycleHostFailure)),
				} satisfies LifecycleItemWrite<(typeof batches)[number], RelationshipBatchSummary>;
			},
		},
		upsertGlobalRelationships: {
			value: (results: ReadonlyArray<RelationshipReconciliationSummary>) =>
				results.map(({ deleted, upserted }) => ({ deleted, upserted })),
			itemWrite: (input: LifecycleHostInput<"UpsertGlobalRelationships">) => {
				const groups = input.groups.map((group) => toReconcileGroup(group, input.command));
				return {
					items: input.groups,
					result: RelationshipReconciliationSummary,
					applyPolicies: applyRelationshipHostPolicies,
					commit:
						(group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number]) =>
						(pending: PendingRelationshipMutations) =>
							relationships
								.commitProjected(pending, reconciliationSummary(group.relationships.length))
								.pipe(Effect.mapError(lifecycleHostFailure)),
					prepare: (
						group: LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
						index: number,
					) =>
						relationships
							.prepareReconcileGlobalGroup(
								toReconcileGroup(group, input.command),
								index,
								input.command,
								groups,
							)
							.pipe(Effect.mapError(lifecycleHostFailure)),
				} satisfies LifecycleItemWrite<
					LifecycleHostInput<"UpsertGlobalRelationships">["groups"][number],
					RelationshipReconciliationSummary
				>;
			},
			validate: (
				rawInput: ScriptRunInput,
				groups: LifecycleHostInput<"UpsertGlobalRelationships">["groups"],
			): Effect.Effect<LifecycleHostInput<"UpsertGlobalRelationships">, SandboxHostError> =>
				sandboxHostEffect(
					Effect.gen(function* () {
						const input = yield* requireSandboxCapabilityInput(
							rawInput,
							"upsertGlobalRelationships",
						);
						const relationshipCount = groups.reduce(
							(total, group) => total + group.relationships.length,
							0,
						);
						if (groups.length > SANDBOX_LIMITS.globalWrites.relationshipGroups) {
							return yield* Effect.fail(
								`upsertGlobalRelationships exceeds ${SANDBOX_LIMITS.globalWrites.relationshipGroups} groups`,
							);
						}
						if (relationshipCount > SANDBOX_LIMITS.globalWrites.relationshipsTotal) {
							return yield* Effect.fail(
								`upsertGlobalRelationships exceeds ${SANDBOX_LIMITS.globalWrites.relationshipsTotal} relationships`,
							);
						}
						const command = yield* sandboxLifecycleCommand(
							input,
							"provider-refresh",
							"upsertGlobalRelationships",
						);
						return { groups, command, _tag: "UpsertGlobalRelationships" } as const;
					}),
				),
		},
	};
};

export type RelationshipLifecycleHostSteps = ReturnType<typeof relationshipLifecycleHostSteps>;

export const makeRelationshipScriptHost = Effect.gen(function* () {
	const lifecycleExecution = yield* LifecycleExecution;
	const lifecycle = relationshipLifecycleHostSteps(yield* RelationshipMutationPipeline);

	return {
		changeUserRelationships: (rawInput, batches) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.changeUserRelationships.validate(rawInput, batches);
					const results = yield* writeInlineLifecycleItems(lifecycleExecution, {
						capability: "changeUserRelationships",
						...lifecycle.changeUserRelationships.itemWrite(input),
					});
					return lifecycle.changeUserRelationships.value(results);
				}),
			),
		upsertGlobalRelationships: (rawInput, groups) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.upsertGlobalRelationships.validate(rawInput, groups);
					const results = yield* writeInlineLifecycleItems(lifecycleExecution, {
						capability: "upsertGlobalRelationships",
						...lifecycle.upsertGlobalRelationships.itemWrite(input),
					});
					return lifecycle.upsertGlobalRelationships.value(results);
				}),
			),
	} satisfies Pick<
		AdditionalScriptHostImplementationMap,
		"changeUserRelationships" | "upsertGlobalRelationships"
	>;
});
