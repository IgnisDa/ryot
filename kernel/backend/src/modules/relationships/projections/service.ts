import { DbError } from "@ryot-app/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { RelationshipProjectionRequest } from "@ryot-app/contract/modules/relationships/projections";
import {
	RelationshipProjectionStepInput,
	RelationshipProjectionStepOutput,
} from "@ryot-app/contract/modules/relationships/projections";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	EntityId,
	RelationshipSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import {
	type BackgroundWorkInput,
	ProjectionBindings,
	ProjectionInputReadiness,
} from "#modules/background-work/model";
import { BackgroundWorkService } from "#modules/background-work/service";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { sameRevisionPin, ScriptPluginRevision } from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import { redisKeys, RedisService } from "#platform/redis";
import { makeActivity } from "#platform/workflow/scope";
import * as tables from "#schema/tables/combined";

import { type RelationshipProjectionKey, RelationshipProjectionRepository } from "./repository";

const RelationshipProjectionClaim = Schema.Struct({
	id: Schema.String,
	jobId: Schema.String,
	outputSchema: AppSchema,
	inputRepairRevision: Schema.Int,
	pluginPin: ScriptPluginRevision,
	processorScriptId: SandboxScriptId,
	accountGeneration: AccountGeneration,
	input: RelationshipProjectionStepInput,
	revisions: Schema.Record(Schema.String, Schema.Int),
});

export class RelationshipProjectionService extends Context.Service<RelationshipProjectionService>()(
	"@ryot-app/kernel-backend/modules/relationships/projections/service/RelationshipProjectionService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const writes = yield* DomainWriteChecks;
			const repository = yield* RelationshipProjectionRepository;
			const relationshipSchemas = yield* RelationshipSchemaReader;
			const background = yield* BackgroundWorkService;
			const bindings = yield* ProjectionBindings;
			const inputs = yield* ProjectionInputReadiness;
			const redis = yield* RedisService;
			const assets = yield* ManagedAssetReferenceLocker.make;

			const publishUpdates = (entityIds: ReadonlyArray<string>, userId: UserId) =>
				Effect.forEach(
					entityIds,
					(entityId) =>
						redis
							.publish(
								redisKeys.entityUpdatedChannel,
								encodeEntityUpdatedMessage(EntityId.make(entityId), "projection-updated", userId),
							)
							.pipe(
								Effect.catchCause((cause) =>
									Effect.logWarning("Projection refresh publication failed", cause),
								),
							),
					{ discard: true },
				);

			const currentBinding = Effect.fn("RelationshipProjectionService.currentBinding")(function* (
				key: RelationshipProjectionKey,
			) {
				const definition = yield* relationshipSchemas.findByReference(
					{
						owner: definitionOwner(key.relationshipSchemaPluginId),
						slug: RelationshipSchemaSlug.make(key.relationshipSchemaSlug),
					},
					UserId.make(key.userId),
				);
				if (!definition?.projection || definition.pluginId !== key.relationshipSchemaPluginId) {
					return null;
				}
				const binding = yield* bindings.resolve({
					userId: UserId.make(key.userId),
					pluginId: key.relationshipSchemaPluginId,
					scriptSlug: definition.projection.scriptSlug,
				});
				if (!binding) {
					return null;
				}
				return {
					pluginPin: binding.pluginPin,
					accountGeneration: binding.accountGeneration,
					persisted: {
						processorScriptId: binding.principal.scriptId,
						accountToken: binding.accountGeneration.token,
						pluginRevisionId: binding.pluginPin.revisionId,
						outputSchema: definition.projection.propertiesSchema,
						pluginPin: yield* Schema.encodeUnknownEffect(JsonValue)(binding.pluginPin).pipe(
							Effect.mapError(() => new DbError({ message: "Invalid projection binding" })),
						),
					},
				};
			});

			const arrange = Effect.fn("RelationshipProjectionService.arrange")(function* (
				id: string,
				retry?: boolean,
				fillMissing?: boolean,
			) {
				const candidate = yield* repository.get(id);
				if (!candidate) {
					return null;
				}
				const account = { token: candidate.accountToken, userId: UserId.make(candidate.userId) };
				yield* background.lockAccount(account);
				yield* repository.lockInputs(account.userId);
				let work = yield* repository.prepare(id);
				if (!work) {
					return null;
				}
				const key = {
					userId: work.userId,
					relationshipSchemaSlug: work.relationshipSchemaSlug,
					relationshipSchemaPluginId: work.relationshipSchemaPluginId,
				};
				const binding = yield* currentBinding(key);
				if (
					!binding ||
					binding.accountGeneration.token !== account.token ||
					!(yield* inputs.ready(account))
				) {
					return null;
				}
				if (
					work.processorScriptId !== binding.persisted.processorScriptId ||
					stableStringify(work.pluginPin) !== stableStringify(binding.persisted.pluginPin) ||
					stableStringify(work.outputSchema) !== stableStringify(binding.persisted.outputSchema)
				) {
					yield* repository.bind(key, binding.persisted);
					work = yield* repository.get(id);
					if (!work) {
						return null;
					}
				}
				const openInputs = work.inputRepairRevision !== work.preparedInputRepairRevision;
				if (openInputs) {
					yield* repository.prepareInputs(id);
					work = yield* repository.get(id);
				}
				if (work && (fillMissing || openInputs)) {
					yield* repository.fillMissing(key);
				}
				if (
					!work ||
					(work.currentJobId !== null &&
						work.status !== "succeeded" &&
						!(retry && work.status === "failed"))
				) {
					return work?.currentJobId ?? null;
				}
				const claimed = yield* repository.claimable(id, 100);
				if (claimed.length === 0) {
					return null;
				}
				const pin = yield* Schema.decodeUnknownEffect(ScriptPluginRevision)(work.pluginPin).pipe(
					Effect.mapError(
						() => new DbError({ message: "Invalid persisted relationship projection binding" }),
					),
				);
				const jobId = `relationship-projection-${sha256Hex(stableStringify([account, id, work.step + 1]))}`;
				const claim = yield* Schema.decodeEffect(RelationshipProjectionClaim)({
					id,
					jobId,
					pluginPin: pin,
					accountGeneration: account,
					outputSchema: work.outputSchema,
					processorScriptId: work.processorScriptId,
					inputRepairRevision: work.inputRepairRevision,
					revisions: Object.fromEntries(
						claimed.map((item) => [item.relationshipId, item.revision]),
					),
					input: {
						relationshipSchemaSlug: work.relationshipSchemaSlug,
						relationships: claimed.map(({ revision: _, ...item }) => item),
					},
				}).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid relationship projection step" })),
				);
				const [target] = yield* session.run((db) =>
					db
						.select({
							slug: tables.sandboxScript.slug,
							contentHash: tables.sandboxScript.contentHash,
						})
						.from(tables.sandboxScript)
						.where(eq(tables.sandboxScript.id, work.processorScriptId)),
				);
				if (!target || pin.compiledHashes[target.slug] !== target.contentHash) {
					return yield* new DbError({ message: "Projection executable pin is unavailable" });
				}
				yield* background.admit({
					id: jobId,
					scope: id,
					key: jobId,
					accountGeneration: account,
					contentHash: target.contentHash,
					purpose: "relationship-projection",
					featureInput: yield* Schema.encodeUnknownEffect(JsonValue)(claim).pipe(Effect.orDie),
					execution: {
						lane: "background",
						input: claim.input,
						pluginRevision: pin,
						resolutionMode: "exact",
						executionId: `${jobId}-script`,
						scriptId: claim.processorScriptId,
						subject: { type: "projection", userId: account.userId, accountGeneration: account },
					},
				});
				yield* repository.reserve(id, jobId);
				return jobId;
			});

			const enqueue = Effect.fn("RelationshipProjectionService.enqueue")(function* (
				key: RelationshipProjectionKey,
				sourceEntityIds: null | ReadonlyArray<string>,
				authorize: Effect.Effect<void, DbError>,
			) {
				const binding = yield* currentBinding(key);
				if (!binding) {
					return yield* new DbError({ message: "Relationship projection binding is unavailable" });
				}
				const admitted = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* background.lockAccount(binding.accountGeneration);
							yield* authorize;
							yield* repository.lockInputs(key.userId);
							const id = yield* repository.bind(key, binding.persisted);
							if (sourceEntityIds !== null) {
								yield* repository.mark(key, sourceEntityIds);
							}
							return { id, jobId: yield* arrange(id, true, sourceEntityIds === null) };
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
				if (admitted.jobId) {
					yield* background.dispatch(admitted.jobId);
				}
				return admitted.id;
			});

			const request = Effect.fn("RelationshipProjectionService.request")(function* (input: {
				pluginPin: ScriptPluginRevision;
				command: DomainLifecycleCommand;
				accountGeneration: AccountGeneration;
				request: typeof RelationshipProjectionRequest.Type;
			}) {
				if (
					!input.command.writeContext?.pluginRevision ||
					input.command.writeContext.pluginRevision.id !== input.pluginPin.id ||
					!sameRevisionPin(input.command.writeContext.pluginRevision, input.pluginPin)
				) {
					return yield* new DbError({
						message: "Relationship projection request requires its exact execution authority",
					});
				}
				return yield* enqueue(
					{
						userId: input.accountGeneration.userId,
						relationshipSchemaPluginId: input.pluginPin.id,
						relationshipSchemaSlug: input.request.relationshipSchemaSlug,
					},
					input.request.sourceEntityIds,
					Effect.gen(function* () {
						yield* background.lockAccount(input.accountGeneration);
						yield* writes
							.check(
								input.command,
								definitionOwner(input.pluginPin.id),
								input.accountGeneration.userId,
								true,
							)
							.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
					}),
				);
			});

			const requestForAllUsers = Effect.fn("RelationshipProjectionService.requestForAllUsers")(
				function* (input: {
					pluginPin: ScriptPluginRevision;
					request: typeof RelationshipProjectionRequest.Type;
				}) {
					const userIds = yield* repository.usersWithRelationships(
						input.pluginPin.id,
						input.request.relationshipSchemaSlug,
						input.request.sourceEntityIds,
					);
					for (const userId of userIds) {
						yield* enqueue(
							{
								userId,
								relationshipSchemaPluginId: input.pluginPin.id,
								relationshipSchemaSlug: input.request.relationshipSchemaSlug,
							},
							input.request.sourceEntityIds,
							Effect.void,
						).pipe(
							Effect.catchTag("DbError", (error) =>
								Effect.logWarning("Relationship projection fan-out skipped a user", {
									userId,
									reason: error.message,
								}),
							),
						);
					}
					return userIds.length;
				},
			);

			const process = Effect.fn("RelationshipProjectionService.process")(function* (
				job: BackgroundWorkInput,
				rawOutput: unknown,
			) {
				const claim = yield* Schema.decodeUnknownEffect(RelationshipProjectionClaim)(
					job.featureInput,
				).pipe(
					Effect.mapError(
						() => new DbError({ message: "Invalid persisted relationship projection claim" }),
					),
				);
				const output = yield* Schema.decodeUnknownEffect(RelationshipProjectionStepOutput)(
					rawOutput,
				).pipe(
					Effect.mapError(
						() =>
							new DbError({ message: "Relationship projection processor returned invalid output" }),
					),
				);
				const claimedIds = Object.keys(claim.revisions);
				const outputIds = new Set<string>(
					output.updates.map(({ relationshipId }) => relationshipId),
				);
				if (
					outputIds.size !== output.updates.length ||
					outputIds.size !== claimedIds.length ||
					claimedIds.some((relationshipId) => !outputIds.has(relationshipId))
				) {
					return yield* new DbError({
						message: "Relationship projection processor must return each claimed relationship once",
					});
				}
				const updates = yield* Effect.forEach(output.updates, (item) =>
					parseAppSchemaProperties({
						kind: "Projection",
						properties: item.properties,
						propertiesSchema: claim.outputSchema,
					}).pipe(
						Effect.flatMap((properties) =>
							Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))(properties),
						),
						Effect.mapBoth({
							onFailure: () =>
								new DbError({ message: "Projection output does not match its declared schema" }),
							onSuccess: (properties) => ({
								properties,
								relationshipId: item.relationshipId,
								revision: claim.revisions[item.relationshipId] ?? 0,
							}),
						}),
					),
				);
				const key = {
					userId: claim.accountGeneration.userId,
					relationshipSchemaPluginId: claim.pluginPin.id,
					relationshipSchemaSlug: claim.input.relationshipSchemaSlug,
				};
				const published = yield* makeActivity({
					error: DbError,
					success: Schema.Array(Schema.String),
					name: "publish-relationship-projection",
					execute: session
						.transaction(
							Effect.gen(function* () {
								yield* background.lockAccount(claim.accountGeneration);
								yield* repository.lockInputs(claim.accountGeneration.userId);
								if (
									!(yield* repository.currentClaim(
										claim.id,
										claim.jobId,
										claim.inputRepairRevision,
									)) ||
									!(yield* inputs.ready(claim.accountGeneration))
								) {
									yield* repository.release(claim.id, claim.jobId);
									yield* background.settle(job.id, "succeeded");
									yield* arrange(claim.id);
									return [];
								}
								const binding = yield* currentBinding(key);
								if (!binding) {
									return yield* new DbError({ message: "Projection binding is unavailable" });
								}
								if (
									!sameRevisionPin(binding.pluginPin, claim.pluginPin) ||
									binding.persisted.processorScriptId !== claim.processorScriptId
								) {
									yield* repository.bind(key, binding.persisted);
									yield* background.settle(job.id, "succeeded");
									yield* arrange(claim.id);
									return [];
								}
								yield* assets
									.lock(
										updates.map((item) => ({
											properties: item.properties,
											propertiesSchema: claim.outputSchema,
											ownerUserId: claim.accountGeneration.userId,
										})),
									)
									.pipe(
										Effect.mapError(
											() =>
												new DbError({ message: "Projection output contains an unavailable asset" }),
										),
									);
								const entityIds = yield* repository.publish(claim.id, updates);
								yield* repository.release(claim.id, claim.jobId);
								yield* background.settle(job.id, "succeeded");
								yield* arrange(claim.id);
								return entityIds;
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
				});
				yield* publishUpdates(published, claim.accountGeneration.userId);
				return undefined;
			});

			const failed = Effect.fn("RelationshipProjectionService.failed")(function* (
				job: BackgroundWorkInput,
			) {
				const claim = yield* Schema.decodeUnknownEffect(RelationshipProjectionClaim)(
					job.featureInput,
				).pipe(
					Effect.mapError(
						() => new DbError({ message: "Invalid persisted relationship projection claim" }),
					),
				);
				yield* publishUpdates(
					[...new Set(claim.input.relationships.map(({ sourceEntityId }) => sourceEntityId))],
					claim.accountGeneration.userId,
				);
			});

			const reconcile = Effect.fn("RelationshipProjectionService.reconcile")(function* (
				userId?: string,
			) {
				let after: undefined | RelationshipProjectionKey;
				for (;;) {
					const candidates = yield* repository.bindingCandidates({
						limit: 100,
						...(userId === undefined ? {} : { userId }),
						...(after === undefined ? {} : { after }),
					});
					for (const candidate of candidates) {
						yield* enqueue(candidate, null, Effect.void).pipe(
							Effect.catchTag("DbError", (error) =>
								Effect.logWarning("Relationship projection reconciliation skipped a schema", {
									reason: error.message,
									userId: candidate.userId,
									relationshipSchemaSlug: candidate.relationshipSchemaSlug,
								}),
							),
						);
					}
					after = candidates[candidates.length - 1];
					if (candidates.length < 100 || after === undefined) {
						break;
					}
				}
				let afterWork: string | undefined;
				for (;;) {
					const candidates = yield* repository.listCandidates(100, afterWork, userId);
					for (const work of candidates) {
						const jobId = yield* session
							.transaction(arrange(work.id))
							.pipe(
								Effect.catchTags({
									DatabaseSessionStateError: Effect.die,
									DbError: (error) =>
										repository
											.postponeCandidate(work.id)
											.pipe(
												Effect.andThen(
													Effect.logWarning("Relationship projection admission failed", {
														workId: work.id,
														reason: error.message,
													}),
												),
												Effect.as(null),
											),
								}),
							);
						if (jobId) {
							yield* background
								.dispatch(jobId)
								.pipe(
									Effect.catchTag("DbError", (error) =>
										Effect.logWarning("Relationship projection dispatch failed", {
											jobId,
											reason: error.message,
										}),
									),
								);
						}
					}
					if (candidates.length < 100) {
						break;
					}
					afterWork = candidates.at(-1)?.id;
					if (afterWork === undefined) {
						break;
					}
				}
			});

			return { failed, process, request, reconcile, requestForAllUsers };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
