import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AutomationExecutionId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { sandboxContextError } from "@ryot-app/sandbox/protocol/limits";
import { Context, DateTime, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { EnrichmentRequestInput } from "#modules/entities/enrichment/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";
import type * as schema from "#schema/tables/combined";

import {
	explicitTranslationExecutionId,
	translateEntityExecutionId,
	TranslateEntityWorkflow,
	TranslateEntityWorkflowPayload,
	type TranslationExecution,
} from "./entity-translation-workflow";
import { type TranslationOverlayInput, TranslationsRepository } from "./repository";

export type RequestFillInput = Omit<
	TranslateEntityWorkflowPayload,
	"command" | "principal" | "executionId" | "contentGeneration" | "entityScopeUserId"
> & { readonly retryOf?: string; readonly refreshKey?: string; readonly inputHash?: string };

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
			const requests = yield* EnrichmentRequests;
			const requestFill = Effect.fn("TranslationsService.requestFill")(function* (
				input: RequestFillInput,
			) {
				const entity = yield* repository
					.findEntityForUser(input)
					.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
				if (
					!entity ||
					!entityMatchesPayload(entity, input) ||
					input.entitySchemaPluginId === null
				) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: "Translation entity identity is unavailable",
					});
				}
				const pluginId = input.entitySchemaPluginId;
				const refreshKey = input.refreshKey ?? input.retryOf;
				const executionId =
					refreshKey !== undefined
						? explicitTranslationExecutionId(input.entityId, input.language, refreshKey)
						: translateEntityExecutionId({
								userId: input.userId,
								language: input.language,
								entityId: input.entityId,
								accountGeneration: input.accountGeneration,
								contentGeneration: entity.contentGeneration,
							});
				const existing = yield* requests
					.get(executionId)
					.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
				if (existing !== null) {
					return false;
				}
				const requestInput: Omit<EnrichmentRequestInput, "payload"> = {
					pluginId,
					level: null,
					id: executionId,
					dispatchRoot: true,
					entityId: input.entityId,
					operation: "translation",
					language: input.language,
					inputHash: input.inputHash,
					providerId: input.providerId,
					externalId: input.externalId,
					requester: input.accountGeneration,
					entitySchemaSlug: input.entitySchemaSlug,
					workflowName: TranslateEntityWorkflow._tag,
					sourceContentGeneration: entity.contentGeneration,
					scopeUserId: entity.userId === null ? null : UserId.make(entity.userId),
					...(input.retryOf === undefined ? {} : { retryOf: input.retryOf }),
				};
				const recordAdmissionFailure = Effect.fnUntraced(function* (error: SandboxRunError) {
					if (input.refreshKey === undefined) {
						return yield* error;
					}
					const failed = yield* session
						.transaction(
							Effect.gen(function* () {
								yield* session.acquireUserWriteLock(input.userId);
								yield* requests.lockTarget(
									`translation-commit:${input.entityId}:${input.language}`,
								);
								return yield* requests.ensure({
									...requestInput,
									payload: {},
									dispatchRoot: false,
								});
							}),
						)
						.pipe(Effect.mapError((failure) => toSandboxRunError(failure, "infrastructure")));
					if (!failed.dispatchRoot) {
						yield* requests.update(failed.id, { state: "failed", failureKind: error.kind });
					}
					return false;
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
				const script = yield* runtime
					.resolveUserTranslateScript(input.userId, input.providerId)
					.pipe(
						Effect.catchTag("UnsupportedProviderOperationError", (error) =>
							input.refreshKey !== undefined && error.reason === "unsupported_operation"
								? Effect.succeed(null)
								: Effect.fail(error),
						),
						Effect.mapError((error) => toSandboxRunError(error, "invalid-input")),
						Effect.catchTag("SandboxRunError", (error) =>
							recordAdmissionFailure(error).pipe(Effect.as(null)),
						),
					);
				if (
					script === null ||
					(input.refreshKey !== undefined &&
						script.metadata.translationInputs?.[input.entitySchemaSlug] === undefined)
				) {
					return false;
				}
				const duplicate = new SandboxRunError({
					kind: "invalid-input",
					message: "Translation request is already admitted",
				});
				const captured = yield* Ref.make<TranslateEntityWorkflowPayload | null>(null);
				const registered = yield* sandbox
					.preRegisterPluginWorkflow({
						executionId,
						scriptId: script.id,
						executingUserId: input.userId,
						pluginId: input.entitySchemaPluginId,
						accountGeneration: input.accountGeneration,
						retain: (principal) =>
							Effect.gen(function* () {
								yield* requests.lockTarget(
									`translation-commit:${input.entityId}:${input.language}`,
								);
								yield* requests.lockTarget(`translation-admission:${input.retryOf ?? executionId}`);
								if ((yield* requests.get(executionId)) !== null) {
									return yield* duplicate;
								}
								const payload = {
									command,
									principal,
									executionId,
									lane: input.lane,
									userId: input.userId,
									entityId: input.entityId,
									language: input.language,
									externalId: input.externalId,
									providerId: input.providerId,
									entitySchemaSlug: input.entitySchemaSlug,
									accountGeneration: input.accountGeneration,
									contentGeneration: entity.contentGeneration,
									entitySchemaPluginId: input.entitySchemaPluginId,
									entityScopeUserId: entity.userId === null ? null : UserId.make(entity.userId),
								};
								const admitted = yield* requests.ensure({ ...requestInput, payload });
								if (admitted.id !== executionId || admitted.state !== "queued") {
									return yield* duplicate;
								}
								return yield* Ref.set(
									captured,
									yield* Schema.decodeUnknownEffect(TranslateEntityWorkflowPayload)(
										admitted.payload,
									).pipe(Effect.mapError((error) => toSandboxRunError(error, "invalid-input"))),
								);
							}).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
					})
					.pipe(
						Effect.as(true),
						Effect.catchIf(
							(error) => error === duplicate,
							() => Effect.succeed(false),
						),
						Effect.catchTag("SandboxRunError", recordAdmissionFailure),
					);
				if (!registered) {
					return false;
				}
				const storedPayload = yield* Ref.get(captured);
				if (storedPayload === null) {
					return yield* new SandboxRunError({
						kind: "infrastructure",
						message: "Translation admission returned no payload",
					});
				}
				return yield* engine
					.execute(TranslateEntityWorkflow, { executionId, discard: true, payload: storedPayload })
					.pipe(
						Effect.as(true),
						Effect.tapCause((cause) => Effect.logWarning("translation fill enqueue failed", cause)),
						Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
					);
			});

			const admitExecution = Effect.fn("TranslationsService.admitExecution")(function* (
				payload: TranslateEntityWorkflowPayload,
			) {
				const pluginId = payload.entitySchemaPluginId;
				if (pluginId === null) {
					return yield* new SandboxRunError({
						kind: "invalid-input",
						message: "Translation entity is not owned by a plugin",
					});
				}
				const principal = payload.principal;
				return yield* session
					.transaction(
						Effect.gen(function* () {
							const owner = definitionOwner(payload.entitySchemaPluginId);
							const entity = yield* repository.findEntityForUser(payload);
							const provider = yield* runtime.findProviderAvailableToUser(
								payload.userId,
								payload.providerId,
							);
							const selectedKeys = principal.metadata.translationInputs?.[payload.entitySchemaSlug];
							if (
								!entity ||
								entity.populatedAt === null ||
								entity.contentGeneration !== payload.contentGeneration ||
								entity.userId !== payload.entityScopeUserId ||
								!entityMatchesPayload(entity, payload) ||
								!provider ||
								provider.pluginId !== entity.entitySchemaPluginId ||
								selectedKeys === undefined ||
								principal.pluginRevision?.id !== pluginId ||
								principal.providerId !== provider.id ||
								principal.subject.type !== "user" ||
								principal.subject.userId !== payload.userId ||
								principal.subject.accountGeneration.token !== payload.accountGeneration.token
							) {
								return yield* new SandboxRunError({
									kind: "invalid-input",
									message: "Translation entity or provider identity is unavailable",
								});
							}
							yield* checks.check({ writeContext: principal }, owner, entity.userId, true);
							yield* checks.check(payload.command, owner, entity.userId, true);
							for (const key of selectedKeys) {
								if (
									!Object.hasOwn(entity.properties, key) ||
									entity.properties[key] === undefined
								) {
									return yield* new SandboxRunError({
										kind: "invalid-input",
										message: `Translation input property '${key}' is unavailable`,
									});
								}
							}
							const selected = Object.fromEntries(
								selectedKeys.map((key) => [key, entity.properties[key]]),
							);
							const properties = yield* Schema.decodeUnknownEffect(
								Schema.Record(Schema.String, JsonValue),
							)(selected).pipe(
								Effect.mapError(
									() =>
										new SandboxRunError({
											kind: "invalid-input",
											message: "Translation input properties must be JSON",
										}),
								),
							);
							const contextError = sandboxContextError({
								properties,
								name: entity.name,
								language: payload.language,
								externalId: payload.externalId,
								entitySchemaSlug: payload.entitySchemaSlug,
							});
							if (contextError) {
								return yield* new SandboxRunError({ kind: "invalid-input", message: contextError });
							}
							return {
								principal,
								properties,
								name: entity.name,
								contentGeneration: entity.contentGeneration,
								entityScopeUserId: entity.userId === null ? null : UserId.make(entity.userId),
							} satisfies TranslationExecution;
						}),
					)
					.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
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
						yield* requests.lockTarget(
							`translation-commit:${payload.entityId}:${payload.language}`,
						);
						const entity = yield* repository.findEntityForUser(payload, true);
						const provider = yield* checks.checkProvider(payload.providerId, owner);
						if (
							!entity ||
							entity.userId !== execution.entityScopeUserId ||
							!entityMatchesPayload(entity, payload) ||
							provider.pluginId !== entity.entitySchemaPluginId ||
							execution.principal.pluginRevision?.id !== entity.entitySchemaPluginId ||
							execution.principal.metadata.translationInputs?.[entity.entitySchemaSlug] ===
								undefined ||
							execution.principal.providerId !== payload.providerId ||
							input.entityId !== payload.entityId ||
							input.language !== payload.language
						) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Translation commit entity or provider identity changed",
							});
						}
						if (
							entity.contentGeneration !== execution.contentGeneration ||
							execution.contentGeneration !== payload.contentGeneration ||
							input.sourceContentGeneration !== execution.contentGeneration
						) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Translation source content changed before commit",
							});
						}
						const requestId = payload.command.causation.rootExecutionId;
						if (!(yield* requests.latestTranslation(requestId))) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Translation request was superseded",
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
