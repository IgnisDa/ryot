import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { createUserEntityArgsSchema } from "@ryot-app/plugin-backend-sdk/core";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import {
	requireSandboxCapabilityInput,
	sandboxHostEffect,
	sandboxHostFailure,
	type AdditionalSandboxHostImplementationMap,
	type SandboxRunInput,
} from "@ryot-app/sandbox/host/invocation";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { principalOwner } from "@ryot-app/sandbox/protocol/principal";
import { Effect, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { runLifecycleWriteInline } from "#modules/automations/lifecycle/write-step";
import { DefinitionRepository } from "#modules/definitions/repository";
import { readScriptEntitySchemas } from "#modules/definitions/script-host";
import {
	reportSandboxLifecycleWarnings,
	sandboxLifecycleCommand,
	userSandboxRunUserId,
} from "#modules/scripts/host/execution-context";
import {
	lifecycleHostFailure,
	userLifecycleSource,
	type LifecycleHostInput,
} from "#modules/scripts/host/lifecycle-host";

import {
	EntitiesService,
	type GlobalEntityUpsertResults,
	type PendingGlobalEntityUpsert,
} from "./service";

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
				rawInput: SandboxRunInput,
				items: LifecycleHostInput<"UpsertGlobalEntities">["items"],
				options: LifecycleHostInput<"UpsertGlobalEntities">["options"] | undefined,
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
	const definitions = yield* DefinitionRepository;
	const lifecycleExecution = yield* LifecycleExecution;
	const lifecycle = entityLifecycleHostSteps(entities);

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
		createUserEntity: (rawInput, rawItem) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "createUserEntity");
					const [item] = yield* Schema.decodeEffect(createUserEntityArgsSchema)([rawItem]);
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(userSandboxRunUserId(input));
					const owner = definitionOwner(revision?.id ?? null);
					const schemas = yield* readScriptEntitySchemas(definitions, input, [
						item.entitySchemaSlug,
					]);
					const definition = schemas[definitionKey("entity", owner, item.entitySchemaSlug)];
					if (
						!revision?.schemaScope.entitySchemaSlugs.includes(item.entitySchemaSlug) ||
						!definition ||
						definition.pluginId !== revision.id
					) {
						return yield* sandboxHostFailure("Entity schema is not owned by the executing plugin", {
							code: "unavailable-operation",
							operation: "createUserEntity",
						});
					}
					const command = yield* sandboxLifecycleCommand(
						input,
						userLifecycleSource(input),
						"createUserEntity",
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
		ensureUserEntities: (rawInput, items) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "ensureUserEntities");
					const revision = input.principal.pluginRevision;
					const userId = UserId.make(userSandboxRunUserId(input));
					const entitySchemas = yield* readScriptEntitySchemas(
						definitions,
						input,
						items.map(({ entitySchemaSlug }) => entitySchemaSlug),
					);
					for (const item of items) {
						const definition =
							entitySchemas[
								definitionKey(
									"entity",
									definitionOwner(revision?.id ?? null),
									item.entitySchemaSlug,
								)
							];
						if (
							!revision?.schemaScope.entitySchemaSlugs.includes(item.entitySchemaSlug) ||
							!definition ||
							definition.pluginId !== revision.id
						) {
							return yield* Effect.fail(
								`ensureUserEntities cannot write foreign entity schema: ${item.entitySchemaSlug}`,
							);
						}
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
	} satisfies Pick<
		AdditionalSandboxHostImplementationMap,
		"createUserEntity" | "ensureUserEntities" | "upsertGlobalEntities"
	>;
});
