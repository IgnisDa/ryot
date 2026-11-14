import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AutomationExecutionId, UserId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { sandboxContextError } from "@ryot-app/sandbox/protocol/limits";
import { Context, DateTime, Effect, Layer } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { EnrichmentRequestInput } from "#modules/entities/enrichment/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { selectProviderInputProperties } from "#modules/entities/provider-inputs";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import type * as schema from "#schema/tables/combined";

import { type TranslationOverlayInput, TranslationsRepository } from "./repository";
import {
	EntityTranslationJob,
	explicitTranslationExecutionId,
	translateEntityExecutionId,
	type TranslationExecution,
	type TranslationRequestPayload,
} from "./translation-request";

export type RequestFillInput = {
	readonly retryOf?: string;
	readonly inputHash?: string;
	readonly refreshKey?: string;
} & Omit<
	TranslationRequestPayload,
	"command" | "principal" | "executionId" | "contentGeneration" | "entityScopeUserId"
>;

const entityMatchesPayload = (
	entity: Pick<
		typeof schema.entity.$inferSelect,
		"externalId" | "providerId" | "entitySchemaSlug" | "entitySchemaPluginId"
	>,
	payload: Pick<
		TranslationRequestPayload,
		"externalId" | "providerId" | "entitySchemaSlug" | "entitySchemaPluginId"
	>,
) =>
	entity.providerId === payload.providerId &&
	entity.externalId === payload.externalId &&
	entity.entitySchemaPluginId === payload.entitySchemaPluginId &&
	entity.entitySchemaSlug === payload.entitySchemaSlug;

export class TranslationsService extends Context.Service<TranslationsService>()(
	"@ryot-app/kernel-backend/modules/entities/localization/service/TranslationsService",
	{
		make: Effect.gen(function* () {
			const jobs = yield* JobQueue;
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
					requester: input.userId,
					entityId: input.entityId,
					operation: "translation",
					language: input.language,
					inputHash: input.inputHash,
					providerId: input.providerId,
					externalId: input.externalId,
					entitySchemaSlug: input.entitySchemaSlug,
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
								return yield* requests.ensure({ ...requestInput, payload: {} });
							}),
						)
						.pipe(Effect.mapError((failure) => toSandboxRunError(failure, "infrastructure")));
					yield* requests.update(failed.id, { state: "failed", failureKind: error.kind });
					return false;
				});
				const command = {
					...rootLifecycleCommand({
						source: "api",
						lane: input.lane,
						itemIdentity: executionId,
						accountUserId: input.userId,
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
				return yield* sandbox
					.preRegisterPluginWorkflow({
						executionId,
						scriptId: script.id,
						accountUserId: input.userId,
						executingUserId: input.userId,
						pluginId: input.entitySchemaPluginId,
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

									contentGeneration: entity.contentGeneration,
									entitySchemaPluginId: input.entitySchemaPluginId,
									entityScopeUserId: entity.userId === null ? null : UserId.make(entity.userId),
								};
								const admitted = yield* requests.ensure({ ...requestInput, payload });
								if (admitted.id !== executionId || admitted.state !== "queued") {
									return yield* duplicate;
								}
								return yield* jobs
									.enqueue(
										EntityTranslationJob,
										{ requestId: executionId },
										{
											key: executionId,
											userId: input.userId,
											priority: input.lane === "interactive" ? 0 : 1,
										},
									)
									.pipe(Effect.asVoid);
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
			});

			const admitExecution = Effect.fn("TranslationsService.admitExecution")(function* (
				payload: TranslationRequestPayload,
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
								principal.subject.userId !== payload.userId
							) {
								return yield* new SandboxRunError({
									kind: "invalid-input",
									message: "Translation entity or provider identity is unavailable",
								});
							}
							yield* checks.check({ writeContext: principal }, owner, entity.userId, true);
							yield* checks.check(payload.command, owner, entity.userId, true);
							const properties = yield* selectProviderInputProperties(
								"Translation",
								entity.properties,
								selectedKeys,
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
				payload: TranslationRequestPayload,
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
