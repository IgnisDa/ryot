import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { RelationshipProjectionRequest } from "@ryot-app/contract/modules/relationships/projections";
import { EntityId, RelationshipSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Effect, Schema } from "effect";

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
	type LifecycleHostInput,
	type LifecycleItemWrite,
	userLifecycleSource,
	writeInlineLifecycleItems,
} from "#modules/scripts/host/lifecycle-host";
import { SandboxSubmissionCommands } from "#modules/scripts/host/submission-command";

import {
	type PendingRelationshipMutations,
	RelationshipBatchSummary,
	RelationshipMutationPipeline,
	RelationshipReconciliationSummary,
} from "./mutation-pipeline";
import { RelationshipProjectionService } from "./projections/service";

const toSandboxRelationshipIdentity = <
	T extends {
		readonly sourceEntityId: string;
		readonly targetEntityId: string;
		readonly relationshipSchemaSlug: string;
	},
>(
	relationship: T,
	pluginId: null | string,
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
	submissions: SandboxSubmissionCommands["Service"],
) => {
	const applyRelationshipHostPolicies = (pending: PendingRelationshipMutations) =>
		relationships.applyPolicies(pending).pipe(Effect.mapError(lifecycleHostFailure));
	return {
		upsertGlobalRelationships: {
			value: (results: ReadonlyArray<RelationshipReconciliationSummary>) =>
				results.map(({ deleted, upserted }) => ({ deleted, upserted })),
			itemWrite: (input: LifecycleHostInput<"UpsertGlobalRelationships">) => {
				const groups = input.groups.map((group) => toReconcileGroup(group, input.command));
				return {
					items: input.groups,
					result: RelationshipReconciliationSummary,
					applyPolicies: applyRelationshipHostPolicies,
					commit: () => (pending: PendingRelationshipMutations) =>
						relationships.commitReconciliation(pending).pipe(Effect.mapError(lifecycleHostFailure)),
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
		changeUserRelationships: {
			value: (results: ReadonlyArray<RelationshipBatchSummary>) =>
				results.map(({ created, deleted }) => ({ created, deleted })),
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
						relationships.commitBatch(pending).pipe(Effect.mapError(lifecycleHostFailure)),
					prepare: (current: (typeof batches)[number], index: number) =>
						relationships
							.prepareChangeUserBatch(input.userId, current, index, input.command, batches)
							.pipe(Effect.mapError(lifecycleHostFailure)),
				} satisfies LifecycleItemWrite<(typeof batches)[number], RelationshipBatchSummary>;
			},
			validate: (
				rawInput: ScriptRunInput,
				batches: LifecycleHostInput<"ChangeUserRelationships">["batches"],
				options?: Parameters<AdditionalScriptHostImplementationMap["changeUserRelationships"]>[2],
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
						const command = yield* submissions.commandFor(
							input,
							yield* sandboxLifecycleCommand(
								input,
								userLifecycleSource(input),
								"changeUserRelationships",
							),
							options,
						);
						return {
							batches,
							command,
							_tag: "ChangeUserRelationships",
							userId: UserId.make(userSandboxRunUserId(input)),
						} as const;
					}),
				),
		},
	};
};

export type RelationshipLifecycleHostSteps = ReturnType<typeof relationshipLifecycleHostSteps>;

export const makeRelationshipScriptHost = Effect.gen(function* () {
	const lifecycleExecution = yield* LifecycleExecution;
	const projections = yield* RelationshipProjectionService;
	const lifecycle = relationshipLifecycleHostSteps(
		yield* RelationshipMutationPipeline,
		yield* SandboxSubmissionCommands,
	);

	return {
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
		changeUserRelationships: (
			rawInput,
			batches,
			options?: Parameters<AdditionalScriptHostImplementationMap["changeUserRelationships"]>[2],
		) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.changeUserRelationships.validate(
						rawInput,
						batches,
						options,
					);
					const results = yield* writeInlineLifecycleItems(lifecycleExecution, {
						capability: "changeUserRelationships",
						...lifecycle.changeUserRelationships.itemWrite(input),
					});
					return lifecycle.changeUserRelationships.value(results);
				}),
			),
		requestRelationshipProjectionsForAllUsers: (rawInput, request) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(
						rawInput,
						"requestRelationshipProjectionsForAllUsers",
					);
					const pluginPin = input.principal.pluginRevision;
					if (!pluginPin) {
						return yield* Effect.fail(
							"requestRelationshipProjectionsForAllUsers requires a pinned plugin script",
						);
					}
					const users = yield* projections
						.requestForAllUsers({
							pluginPin,
							request: yield* Schema.decodeEffect(RelationshipProjectionRequest)(request),
						})
						.pipe(Effect.mapError((error) => error.message));
					return { users };
				}),
			),
		requestRelationshipProjections: (rawInput, request) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(
						rawInput,
						"requestRelationshipProjections",
					);
					const accountGeneration = input.principal.subject.accountGeneration;
					const userId = userSandboxRunUserId(input);
					if (!accountGeneration || accountGeneration.userId !== userId) {
						return yield* Effect.fail(
							"requestRelationshipProjections requires an active user account",
						);
					}
					const pluginPin = input.principal.pluginRevision;
					if (!pluginPin) {
						return yield* Effect.fail(
							"requestRelationshipProjections requires a pinned plugin script",
						);
					}
					const workId = yield* projections
						.request({
							pluginPin,
							accountGeneration,
							request: yield* Schema.decodeEffect(RelationshipProjectionRequest)(request),
							command: yield* sandboxLifecycleCommand(
								input,
								userLifecycleSource(input),
								"requestRelationshipProjections",
							),
						})
						.pipe(Effect.mapError((error) => error.message));
					return { workId };
				}),
			),
	} satisfies Pick<
		AdditionalScriptHostImplementationMap,
		| "changeUserRelationships"
		| "upsertGlobalRelationships"
		| "requestRelationshipProjections"
		| "requestRelationshipProjectionsForAllUsers"
	>;
});
