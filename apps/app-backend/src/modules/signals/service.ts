import { DbError, badRequest, notFound } from "@ryot/contract/errors";
import {
	AutomationOrigin,
	type AutomationOrigin as AutomationOriginValue,
} from "@ryot/contract/modules/automations/schemas";
import type { EntityId, UserId } from "@ryot/contract/schema/brands";
import { SignalId } from "@ryot/contract/schema/brands";
import { sha256Base64Url } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { SignalDispatch } from "./dispatch";
import { SignalsRepository, type StoredSignal } from "./repository";
import {
	SignalSchemasRepository,
	type BuiltinSignalSchemaInput,
	type SignalSchemaScope,
} from "./signal-schemas-repository";

type AutomationPrincipal = { kind: "user"; userId: UserId } | { kind: "system" };

export type EmitSignalInput = {
	occurredAt: Date;
	schemaSlug: string;
	executionId: string;
	properties: unknown;
	discriminator: string;
	origin: AutomationOriginValue;
	principal: AutomationPrincipal;
	subjectEntityId?: EntityId | undefined;
};

export class SignalSchemaContractDrift extends Schema.TaggedError<SignalSchemaContractDrift>()(
	"SignalSchemaContractDrift",
	{ message: Schema.String },
) {}

const signalSchemaSlugPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const makeSignalId = (
	input: Pick<EmitSignalInput, "discriminator" | "executionId" | "schemaSlug">,
) =>
	SignalId.make(
		`signal_${sha256Base64Url(
			stableStringify([input.executionId, input.schemaSlug, input.discriminator]),
		)}`,
	);

const toEmissionResult = (
	signal: StoredSignal,
	signalSchema: SignalSchemaScope,
	recipientUserIds: ReadonlyArray<UserId>,
	wasCreated: boolean,
) => ({ wasCreated, recipientUserIds, signal: { ...signal, schemaSlug: signalSchema.slug } });

export class SignalSchemasService extends Context.Service<SignalSchemasService>()(
	"SignalSchemasService",
	{
		make: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* SignalSchemasRepository;
			const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

			const getBuiltinBySlug = Effect.fn("SignalSchemasService.getBuiltinBySlug")(function* (
				slug: string,
			) {
				const signalSchema = yield* runWithDb(repository.findGlobalBySlug(slug));
				if (!signalSchema) {
					return yield* notFound("Signal schema not found");
				}
				return signalSchema;
			});

			const ensureBuiltin = Effect.fn("SignalSchemasService.ensureBuiltin")(function* (
				input: BuiltinSignalSchemaInput,
			) {
				if (!signalSchemaSlugPattern.test(input.slug)) {
					return yield* new SignalSchemaContractDrift({
						message: `Invalid built-in signal schema slug: ${input.slug}`,
					});
				}

				if (input.audiencePolicy.kind === "related_users") {
					const relationshipSchema = yield* runWithDb(
						relationshipSchemasRepository.findById(
							input.audiencePolicy.relationshipSchemaSlug,
							null,
						),
					);
					if (!relationshipSchema) {
						return yield* new SignalSchemaContractDrift({
							message: `Built-in signal schema ${input.slug} references an invalid relationship schema`,
						});
					}
				}

				const existing = yield* runWithDb(repository.findGlobalBySlug(input.slug));
				if (!existing) {
					return yield* runWithDb(repository.insertBuiltin(input));
				}

				const propertiesChanged =
					stableStringify(existing.propertiesSchema) !== stableStringify(input.propertiesSchema);
				const audienceChanged =
					stableStringify(existing.audiencePolicy) !== stableStringify(input.audiencePolicy);
				if (existing.slug !== input.slug || propertiesChanged || audienceChanged) {
					return yield* new SignalSchemaContractDrift({
						message: `Built-in signal schema contract drifted: ${input.slug}`,
					});
				}

				if (existing.name !== input.name || existing.catalogState !== input.catalogState) {
					return yield* runWithDb(
						repository.updateBuiltinDisplay({
							id: existing.id,
							name: input.name,
							catalogState: input.catalogState,
						}),
					);
				}

				return existing;
			});

			return { ensureBuiltin, getBuiltinBySlug };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export type SignalListFilter = {
	schemaSlug: string;
	actorUserId?: UserId | undefined;
	subjectEntityId?: EntityId | undefined;
};

export class SignalsService extends Context.Service<SignalsService>()("SignalsService", {
	make: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SignalsRepository;

		const list = Effect.fn("SignalsService.list")(function* (filter: SignalListFilter) {
			return yield* runWithDb(
				Effect.gen(function* () {
					const signals = yield* repository.listBySchemaSlug(filter);
					return yield* Effect.forEach(signals, (signal) =>
						Effect.gen(function* () {
							const recipientUserIds = yield* repository.listRecipientUserIds(signal.id);
							return {
								id: signal.id,
								recipientUserIds,
								createdAt: signal.createdAt,
								actorUserId: signal.actorUserId,
								subjectEntityId: signal.subjectEntityId,
							};
						}),
					);
				}),
			);
		});

		return { list };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export class SignalEmissionService extends Context.Service<SignalEmissionService>()(
	"SignalEmissionService",
	{
		make: Effect.gen(function* () {
			const dispatch = yield* SignalDispatch;
			const repository = yield* SignalsRepository;
			const runInTransaction = yield* TransactionRunner;
			const entitiesRepository = yield* EntitiesRepository;
			const signalSchemasRepository = yield* SignalSchemasRepository;
			const relationshipsRepository = yield* RelationshipsRepository;
			const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

			const validateSubject = Effect.fn("SignalEmissionService.validateSubject")(function* (
				principal: AutomationPrincipal,
				subjectEntityId: EntityId,
			) {
				const subject = yield* principal.kind === "user"
					? entitiesRepository.getEntityScopeForUser({
							userId: principal.userId,
							entityId: subjectEntityId,
						})
					: entitiesRepository.findGlobalEntityById(subjectEntityId);
				if (!subject) {
					return yield* notFound("Entity not found");
				}
				return subject;
			});

			const emit = Effect.fn("SignalEmissionService.emit")(function* (input: EmitSignalInput) {
				if (!input.executionId || !input.discriminator || !input.schemaSlug) {
					return yield* badRequest("Signal identity fields must be non-empty");
				}

				const origin = yield* Schema.decodeUnknownEffect(AutomationOrigin)(input.origin).pipe(
					Effect.mapError(() => badRequest("Invalid signal origin")),
				);

				const result = yield* runInTransaction(
					Effect.gen(function* () {
						const principalUserId = input.principal.kind === "user" ? input.principal.userId : null;
						const signalSchema = yield* signalSchemasRepository.findVisibleBySlug({
							userId: principalUserId,
							slug: input.schemaSlug,
						});
						if (!signalSchema) {
							return yield* notFound("Signal schema not found");
						}

						const properties = yield* parseAppSchemaProperties({
							kind: "Signal",
							properties: input.properties,
							propertiesSchema: signalSchema.propertiesSchema,
						}).pipe(Effect.mapError((error) => badRequest(error.message)));

						let actorUserId: UserId | null = null;
						if (signalSchema.audiencePolicy.kind === "actor") {
							if (input.principal.kind !== "user") {
								return yield* badRequest("Actor audience requires a user principal");
							}
							actorUserId = input.principal.userId;
						}
						const subjectEntityId = input.subjectEntityId ?? null;
						if (signalSchema.audiencePolicy.kind === "related_users" && !subjectEntityId) {
							return yield* badRequest("Related-users audience requires a subject entity");
						}

						const id = makeSignalId(input);
						const replayed = yield* repository.findById(id);
						if (replayed) {
							const recipientUserIds = yield* repository.listRecipientUserIds(id);
							return toEmissionResult(replayed, signalSchema, recipientUserIds, false);
						}
						if (subjectEntityId) {
							yield* validateSubject(input.principal, subjectEntityId);
						}

						const inserted = yield* repository.insert({
							id,
							origin,
							properties,
							actorUserId,
							subjectEntityId,
							occurredAt: input.occurredAt,
							signalSchemaSlug: signalSchema.id,
						});

						if (!inserted) {
							const existing = yield* repository.findById(id);
							if (!existing) {
								return yield* new DbError({ message: "Signal insert conflict but not found" });
							}
							const recipientUserIds = yield* repository.listRecipientUserIds(id);
							return toEmissionResult(existing, signalSchema, recipientUserIds, false);
						}
						let recipientUserIds: ReadonlyArray<UserId>;
						if (signalSchema.audiencePolicy.kind === "actor") {
							if (input.principal.kind !== "user") {
								return yield* new DbError({ message: "Actor signal lost its user principal" });
							}
							const enabled = yield* repository.isUserEnabled(input.principal.userId);
							recipientUserIds = enabled ? [input.principal.userId] : [];
						} else {
							if (!subjectEntityId) {
								return yield* new DbError({ message: "Related-users signal lost its subject" });
							}
							const policy = signalSchema.audiencePolicy;
							const relationshipSchema = yield* relationshipSchemasRepository.findById(
								policy.relationshipSchemaSlug,
								principalUserId,
							);
							if (!relationshipSchema) {
								return yield* new DbError({
									message: `Invalid audience policy for signal schema ${signalSchema.id}`,
								});
							}
							recipientUserIds = yield* relationshipsRepository.listEnabledOwnersForSubject({
								subjectEntityId,
								subjectSide: policy.subjectSide,
								relationshipSchemaSlug: policy.relationshipSchemaSlug,
							});
						}

						yield* repository.insertRecipients({ signalId: id, userIds: recipientUserIds });
						return toEmissionResult(inserted, signalSchema, recipientUserIds, true);
					}),
				);
				yield* dispatch.dispatch({
					id: result.signal.id,
					origin: result.signal.origin,
					properties: result.signal.properties,
					occurredAt: result.signal.occurredAt,
					actorUserId: result.signal.actorUserId,
					recipientUserIds: result.recipientUserIds,
					signalSchemaSlug: result.signal.signalSchemaSlug,
				});
				return result;
			});

			return { emit };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
