import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, EntitySchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import {
	clearUserEntityDataArgsSchema,
	createUserEntityArgsSchema,
	deleteUserEntityArgsSchema,
	mergeUserEntityDataArgsSchema,
	updateUserEntityArgsSchema,
} from "@ryot-app/plugin-backend-sdk/core";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { sandboxHostEffect, sandboxHostFailure } from "@ryot-app/sandbox/host/invocation";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Effect, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { runLifecycleWriteInline } from "#modules/automations/lifecycle/write-step";
import { DefinitionRepository } from "#modules/definitions/repository";
import { readScriptEntitySchemas } from "#modules/definitions/script-host";
import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
	type ScriptRunInput,
	type UserSandboxRunInput,
} from "#modules/scripts/authorization/capabilities";
import { principalOwner } from "#modules/scripts/authorization/principal";
import {
	reportSandboxLifecycleWarnings,
	sandboxLifecycleCommand,
	userSandboxRunUserId,
} from "#modules/scripts/host/execution-context";
import {
	lifecycleHostFailure,
	type LifecycleHostInput,
	userLifecycleSource,
} from "#modules/scripts/host/lifecycle-host";
import { SandboxSubmissionCommands } from "#modules/scripts/host/submission-command";

import {
	EntitiesService,
	type GlobalEntityUpsertResults,
	type PendingGlobalEntityUpsert,
} from "./service";
import { EntityUserDataService } from "./user-data/service";
import { kernelCollectionLifecycleCommand } from "./write-context";

const hasInvalidPopulatedAt = (item: LifecycleHostInput<"UpsertGlobalEntities">["items"][number]) =>
	item.populatedAt !== null && Number.isNaN(new Date(item.populatedAt).getTime());

export const entityLifecycleHostSteps = (entities: EntitiesService["Service"]) => {
	const upsertGlobalEntitiesStep = (
		input: LifecycleHostInput<"UpsertGlobalEntities">,
		cursor: Parameters<EntitiesService["Service"]["prepareUpsertGlobalEntitiesStep"]>[4],
	) =>
		entities
			.prepareUpsertGlobalEntitiesStep(
				input.items.map((item) => ({
					name: item.name,
					externalId: item.externalId,
					properties: item.properties,
					populatedAt: item.populatedAt === null ? null : new Date(item.populatedAt),
					entitySchema: {
						owner: principalOwner(input.command.writeContext),
						slug: EntitySchemaSlug.make(item.entitySchemaSlug),
					},
				})),
				input.providerId,
				input.command,
				input.options?.maximumTotal === undefined
					? undefined
					: { maximumTotal: input.options.maximumTotal },
				cursor,
			)
			.pipe(Effect.mapError(lifecycleHostFailure));
	return {
		upsertGlobalEntities: {
			prepare: upsertGlobalEntitiesStep,
			applyPolicies: (pending: PendingGlobalEntityUpsert) =>
				entities.applyGlobalEntityPolicies(pending).pipe(Effect.mapError(lifecycleHostFailure)),
			commit: (
				input: LifecycleHostInput<"UpsertGlobalEntities">,
				pending: PendingGlobalEntityUpsert,
			) => upsertGlobalEntitiesStep(input, { planned: pending.planned, accepted: pending.pending }),
			value: (results: GlobalEntityUpsertResults) =>
				results.map((result) =>
					result.status === "skipped"
						? { status: result.status }
						: { status: result.status, entityId: result.entityId, wasInserted: result.wasInserted },
				),
			validate: (
				rawInput: ScriptRunInput,
				items: LifecycleHostInput<"UpsertGlobalEntities">["items"],
				options: undefined | LifecycleHostInput<"UpsertGlobalEntities">["options"],
			): Effect.Effect<LifecycleHostInput<"UpsertGlobalEntities">, SandboxHostError> =>
				sandboxHostEffect(
					Effect.gen(function* () {
						const input = yield* requireSandboxCapabilityInput(rawInput, "upsertGlobalEntities");
						if (items.length > SANDBOX_LIMITS.globalWrites.entityItems) {
							return yield* Effect.fail(
								`upsertGlobalEntities exceeds ${SANDBOX_LIMITS.globalWrites.entityItems} items`,
							);
						}
						if (items.some(hasInvalidPopulatedAt)) {
							return yield* Effect.fail(
								"upsertGlobalEntities populatedAt must be a valid date string",
							);
						}
						const command = yield* sandboxLifecycleCommand(
							input,
							"provider-refresh",
							"upsertGlobalEntities",
						);
						return {
							items,
							command,
							options: options ?? null,
							_tag: "UpsertGlobalEntities",
							providerId: input.principal.providerId,
						} as const;
					}),
				),
		},
	};
};

export type EntityLifecycleHostSteps = ReturnType<typeof entityLifecycleHostSteps>;

export const makeEntityScriptHost = Effect.gen(function* () {
	const entities = yield* EntitiesService;
	const userData = yield* EntityUserDataService;
	const definitions = yield* DefinitionRepository;
	const lifecycleExecution = yield* LifecycleExecution;
	const submissions = yield* SandboxSubmissionCommands;
	const lifecycle = entityLifecycleHostSteps(entities);
	const findForeignEntitySchemaSlug = Effect.fn(function* (
		input: UserSandboxRunInput,
		slugs: ReadonlyArray<string>,
	) {
		const revision = input.principal.pluginRevision;
		const schemas = yield* readScriptEntitySchemas(definitions, input, slugs);
		return slugs.find((slug) => {
			const definition =
				schemas[definitionKey("entity", definitionOwner(revision?.id ?? null), slug)];
			return (
				!revision?.schemaScope.entitySchemaSlugs.includes(slug) ||
				!definition ||
				definition.pluginId !== revision.id
			);
		});
	});
	const userDataCommand = Effect.fnUntraced(function* (
		input: UserSandboxRunInput,
		operation: "clearUserEntityData" | "mergeUserEntityData",
		entitySchemaSlug: string,
		submission: Parameters<typeof submissions.commandFor>[2],
	) {
		if (!input.principal.pluginRevision) {
			return yield* sandboxHostFailure(
				operation === "clearUserEntityData"
					? "Entity clearing requires a pinned plugin"
					: "Entity merge requires a pinned plugin",
			);
		}
		if ((yield* findForeignEntitySchemaSlug(input, [entitySchemaSlug])) !== undefined) {
			return yield* sandboxHostFailure("Entity schema is not owned by the executing plugin", {
				operation,
				code: "unavailable-operation",
			});
		}
		return yield* submissions.commandFor(
			input,
			kernelCollectionLifecycleCommand(
				yield* sandboxLifecycleCommand(input, userLifecycleSource(input), operation),
			),
			submission,
		);
	});

	return {
		upsertGlobalEntities: (rawInput, items, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* lifecycle.upsertGlobalEntities.validate(rawInput, items, options);
					const { result, warnings } = yield* runLifecycleWriteInline(lifecycleExecution, {
						applyPolicies: lifecycle.upsertGlobalEntities.applyPolicies,
						commit: (pending) => lifecycle.upsertGlobalEntities.commit(input, pending),
						prepare: lifecycle.upsertGlobalEntities.prepare(input, { planned: [], accepted: null }),
					});
					yield* reportSandboxLifecycleWarnings("upsertGlobalEntities", warnings);
					return lifecycle.upsertGlobalEntities.value(result);
				}),
			),
		clearUserEntityData: (
			rawInput,
			rawItem,
			options?: Parameters<AdditionalScriptHostImplementationMap["clearUserEntityData"]>[2],
		) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "clearUserEntityData");
					const [item, submission] = yield* Schema.decodeEffect(clearUserEntityDataArgsSchema)([
						rawItem,
						options,
					]);
					const command = yield* userDataCommand(
						input,
						"clearUserEntityData",
						item.entitySchemaSlug,
						submission,
					);
					const { warnings, deletedEventsCount, deletedRelationshipsCount } =
						yield* userData.clearEntityUserDataForCommand(
							UserId.make(userSandboxRunUserId(input)),
							{
								entityId: EntityId.make(item.entityId),
								entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
							},
							command,
						);
					yield* reportSandboxLifecycleWarnings("clearUserEntityData", warnings);
					return { deletedEventsCount, deletedRelationshipsCount };
				}),
			),
		mergeUserEntityData: (
			rawInput,
			rawItem,
			options?: Parameters<AdditionalScriptHostImplementationMap["mergeUserEntityData"]>[2],
		) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "mergeUserEntityData");
					const [item, submission] = yield* Schema.decodeEffect(mergeUserEntityDataArgsSchema)([
						rawItem,
						options,
					]);
					const command = yield* userDataCommand(
						input,
						"mergeUserEntityData",
						item.entitySchemaSlug,
						submission,
					);
					const { warnings, movedEventsCount, movedRelationshipsCount } =
						yield* userData.mergeEntityUserDataForCommand(
							UserId.make(userSandboxRunUserId(input)),
							{
								mergeFrom: EntityId.make(item.mergeFrom),
								mergeInto: EntityId.make(item.mergeInto),
								entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
							},
							command,
						);
					yield* reportSandboxLifecycleWarnings("mergeUserEntityData", warnings);
					return { movedEventsCount, movedRelationshipsCount };
				}),
			),
		deleteUserEntity: (rawInput, rawItem, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "deleteUserEntity");
					const [item, submission] = yield* Schema.decodeEffect(deleteUserEntityArgsSchema)([
						rawItem,
						options,
					]);
					if (!input.principal.pluginRevision) {
						return yield* sandboxHostFailure("Entity deletion requires a pinned plugin");
					}
					const userId = UserId.make(userSandboxRunUserId(input));
					const command = yield* submissions.commandFor(
						input,
						yield* sandboxLifecycleCommand(input, userLifecycleSource(input), "deleteUserEntity"),
						submission,
					);
					const { warnings } = yield* entities.deleteByIds(
						[EntityId.make(item.entityId)],
						command,
						{
							userId,
							entitySchema: {
								owner: principalOwner(input.principal),
								slug: EntitySchemaSlug.make(item.entitySchemaSlug),
							},
						},
					);
					yield* reportSandboxLifecycleWarnings("deleteUserEntity", warnings);
					return { entityId: item.entityId };
				}),
			),
		updateUserEntity: (
			rawInput,
			rawItem,
			options?: Parameters<AdditionalScriptHostImplementationMap["updateUserEntity"]>[2],
		) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "updateUserEntity");
					const [item, submission] = yield* Schema.decodeEffect(updateUserEntityArgsSchema)([
						rawItem,
						options,
					]);
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(userSandboxRunUserId(input));
					const command = yield* submissions.commandFor(
						input,
						yield* sandboxLifecycleCommand(input, userLifecycleSource(input), "updateUserEntity"),
						submission,
					);
					if (!revision) {
						return yield* sandboxHostFailure("Entity updates require a pinned plugin");
					}
					const { entity, warnings } = yield* entities.update({
						userId,
						scope: "user",
						name: item.name,
						lifecycle: command,
						requireUserOwned: true,
						expected: item.expected,
						properties: item.properties,
						entityId: EntityId.make(item.entityId),
					});
					yield* reportSandboxLifecycleWarnings("updateUserEntity", warnings);
					return { entityId: entity.id };
				}),
			),
		ensureUserEntities: (rawInput, items) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "ensureUserEntities");
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(userSandboxRunUserId(input));
					const foreignSlug = yield* findForeignEntitySchemaSlug(
						input,
						items.map(({ entitySchemaSlug }) => entitySchemaSlug),
					);
					if (foreignSlug !== undefined) {
						return yield* Effect.fail(
							`ensureUserEntities cannot write foreign entity schema: ${foreignSlug}`,
						);
					}
					const command = yield* sandboxLifecycleCommand(input, "bootstrap", "ensureUserEntities");
					const results = yield* entities.ensureUserEntities(
						userId,
						items.map(({ entitySchemaSlug, ...item }) => ({
							...item,
							entitySchema: {
								owner: definitionOwner(revision?.id ?? null),
								slug: EntitySchemaSlug.make(entitySchemaSlug),
							},
						})),
						command,
					);
					yield* reportSandboxLifecycleWarnings(
						"ensureUserEntities",
						results.flatMap((result) => result.warnings),
					);
					return results.map(({ entityId, wasInserted }) => ({ entityId, wasInserted }));
				}),
			),
		createUserEntity: (
			rawInput,
			rawItem,
			options?: Parameters<AdditionalScriptHostImplementationMap["createUserEntity"]>[2],
		) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "createUserEntity");
					const [item, submission] = yield* Schema.decodeEffect(createUserEntityArgsSchema)([
						rawItem,
						options,
					]);
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(userSandboxRunUserId(input));
					const owner = definitionOwner(revision?.id ?? null);
					if ((yield* findForeignEntitySchemaSlug(input, [item.entitySchemaSlug])) !== undefined) {
						return yield* sandboxHostFailure("Entity schema is not owned by the executing plugin", {
							code: "unavailable-operation",
							operation: "createUserEntity",
						});
					}
					const command = yield* submissions.commandFor(
						input,
						yield* sandboxLifecycleCommand(input, userLifecycleSource(input), "createUserEntity"),
						submission,
					);
					const { entity, warnings } = yield* entities.create({
						userId,
						scope: "user",
						name: item.name,
						lifecycle: command,
						properties: item.properties,
						entitySchema: { owner, slug: EntitySchemaSlug.make(item.entitySchemaSlug) },
					});
					yield* reportSandboxLifecycleWarnings("createUserEntity", warnings);
					return { entityId: entity.id };
				}),
			),
	} satisfies Pick<
		AdditionalScriptHostImplementationMap,
		| "createUserEntity"
		| "deleteUserEntity"
		| "updateUserEntity"
		| "ensureUserEntities"
		| "clearUserEntityData"
		| "mergeUserEntityData"
		| "upsertGlobalEntities"
	>;
});
