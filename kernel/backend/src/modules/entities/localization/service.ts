import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AutomationExecutionId, UserId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, DateTime, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { DefinitionRepository } from "#modules/definitions/repository";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";
import type * as schema from "#schema/tables/combined";

import {
	TranslateEntityWorkflow,
	translateEntityExecutionId,
	type TranslateEntityWorkflowPayload,
	type TranslationExecution,
} from "./entity-translation-workflow";
import { TranslationsRepository, type TranslationOverlayInput } from "./repository";

export type RequestFillInput = Omit<TranslateEntityWorkflowPayload, "command" | "executionId">;

const entityMatchesPayload = (
	entity: Pick<
		typeof schema.entity.$inferSelect,
		"entitySchemaPluginId" | "entitySchemaSlug" | "externalId" | "providerId"
	>,
	payload: Pick<
		TranslateEntityWorkflowPayload,
		"entitySchemaPluginId" | "entitySchemaSlug" | "externalId" | "providerId"
	>,
) =>
	entity.providerId === payload.providerId &&
	entity.externalId === payload.externalId &&
	entity.entitySchemaPluginId === payload.entitySchemaPluginId &&
	entity.entitySchemaSlug === payload.entitySchemaSlug;

export class TranslationsService extends Context.Service<TranslationsService>()(
	"TranslationsService",
	{
		make: Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const repository = yield* TranslationsRepository;
			const session = yield* DatabaseSession;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const runtime = yield* PluginRuntimeResolver;
			const definitions = yield* DefinitionRepository;
			const sandbox = yield* ScriptExecutionService;
			const checks = yield* DomainWriteChecks;
			const requestFill = Effect.fn("TranslationsService.requestFill")(function* (
				input: RequestFillInput,
			) {
				const executionId = translateEntityExecutionId({
					language: input.language,
					entityId: input.entityId,
				});
				const command = {
					...rootLifecycleCommand({
						source: "api",
						lane: input.lane,
						itemIdentity: executionId,
						accountGeneration: input.accountGeneration,
						initiator: { kind: "user", id: input.userId },
						executionId: AutomationExecutionId.make(executionId),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					}),
					writeContext: null,
				};
				return yield* engine
					.execute(TranslateEntityWorkflow, {
						executionId,
						discard: true,
						payload: { ...input, command, executionId },
					})
					.pipe(
						Effect.asVoid,
						Effect.tapCause((cause) => Effect.logWarning("translation fill enqueue failed", cause)),
						Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
					);
			});

			const admitExecution = Effect.fn("TranslationsService.admitExecution")(function* (
				payload: TranslateEntityWorkflowPayload,
				executionId: string,
			) {
				const pluginId = payload.entitySchemaPluginId;
				if (pluginId === null) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: "Translation entity is not owned by a plugin",
					});
				}
				const script = yield* runtime.resolveUserTranslateScript(
					payload.userId,
					payload.providerId,
				);
				const captured = yield* Ref.make<TranslationExecution | null>(null);
				yield* sandbox.preRegisterPluginWorkflow({
					pluginId,
					executionId,
					scriptId: script.id,
					executingUserId: payload.userId,
					accountGeneration: payload.accountGeneration,
					retain: (principal) =>
						Effect.gen(function* () {
							const owner = definitionOwner(payload.entitySchemaPluginId);
							const entity = yield* repository.findEntityForUser(payload);
							const provider = yield* runtime.findProviderAvailableToUser(
								payload.userId,
								payload.providerId,
							);
							const activeScript = yield* runtime.resolveUserTranslateScript(
								payload.userId,
								payload.providerId,
							);
							if (
								!entity ||
								entity.populatedAt === null ||
								!entityMatchesPayload(entity, payload) ||
								!provider ||
								provider.pluginId !== entity.entitySchemaPluginId ||
								provider.rootEntitySchemaSlug !== entity.entitySchemaSlug ||
								principal.providerId !== provider.id ||
								activeScript.id !== principal.scriptId
							) {
								return yield* new SandboxRunError({
									kind: "invalid-input",
									message: "Translation entity or provider identity is unavailable",
								});
							}
							yield* checks.check({ writeContext: principal }, owner, entity.userId, true);
							yield* checks.check(payload.command, owner, entity.userId, true);
							return yield* Ref.set(captured, {
								principal,
								properties: entity.properties,
								entityScopeUserId: entity.userId === null ? null : UserId.make(entity.userId),
							});
						}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
				});
				const execution = yield* Ref.get(captured);
				if (!execution) {
					return yield* new SandboxRunError({
						kind: "infrastructure",
						message: "Translation capture returned no execution",
					});
				}
				return execution;
			});

			const upsert = Effect.fn("TranslationsService.upsert")(function* (
				input: TranslationOverlayInput,
				payload: TranslateEntityWorkflowPayload,
				execution: TranslationExecution,
			) {
				return yield* session.transaction(
					Effect.gen(function* () {
						const owner = definitionOwner(payload.entitySchemaPluginId);
						yield* checks.check(
							{ writeContext: execution.principal },
							owner,
							execution.entityScopeUserId,
							true,
						);
						yield* checks.check(payload.command, owner, execution.entityScopeUserId, true);
						const entity = yield* repository.findEntityForUser(payload, true);
						const provider = yield* checks.checkProvider(payload.providerId, owner);
						if (
							!entity ||
							entity.userId !== execution.entityScopeUserId ||
							!entityMatchesPayload(entity, payload) ||
							provider.rootEntitySchemaSlug !== entity.entitySchemaSlug ||
							execution.principal.providerId !== payload.providerId ||
							input.entityId !== payload.entityId ||
							input.language !== payload.language
						) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Translation commit entity or provider identity changed",
							});
						}
						const schemaKey = definitionKey("entity", owner, payload.entitySchemaSlug);
						const schemas = yield* definitions.findUserEntitySchemas(payload.userId, [
							{ owner, slug: payload.entitySchemaSlug },
						]);
						const propertiesSchema = schemas[schemaKey]?.propertiesSchema;
						if (!propertiesSchema) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Translation entity schema is unavailable",
							});
						}
						if (input.properties !== null) {
							yield* assetReferences
								.lock([
									{
										propertiesSchema,
										properties: input.properties,
										ownerUserId: execution.entityScopeUserId,
									},
								])
								.pipe(
									Effect.catchTag(
										"ManagedAssetReferenceRejected",
										() =>
											new SandboxRunError({
												kind: "invalid-input",
												data: { code: "asset-forbidden" },
												message: "Translation references a forbidden managed asset",
											}),
									),
								);
						}
						return yield* repository.upsertOverlay(input);
					}),
				);
			});

			return { upsert, requestFill, admitExecution };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
