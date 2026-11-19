import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	type AutomationEntityRequestPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
	type ListedEntity,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	definitionKey,
	type DefinitionOwner,
	definitionOwner,
	definitionOwnerPluginId,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EntityId, type SandboxProviderId, type UserId } from "@ryot-app/contract/schema/brands";
import {
	type AppSchema,
	collectImmutableProperties,
} from "@ryot-app/contract/schema/property-schema";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import {
	type CommittedLifecycleWork,
	type LifecycleBatchInput,
	type LifecycleDispatchPlan,
	LifecyclePersistenceError,
	LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import {
	applyPolicyChunks,
	matchPolicyChunks,
	type PolicyBatchResult,
	subjectChunks,
} from "#modules/automations/lifecycle/policies";
import { EntityUserDataAttachments } from "#modules/entities/user-data/attachments";
import type { EventMutation } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { AccountAdmission, mutationUserIds } from "#modules/mutations/account-admission";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";
import { principalOwner } from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import { runRootTransaction } from "#platform/db/transaction";
import { trimToNull } from "#platform/validation";

import { EntitySnapshotResult } from "./mutation-outcomes";
import {
	conflict,
	draftOf,
	isUnchangedUpdate,
	makePersistMutation,
	type PersistItem,
	type PreparedMutation,
	same,
	snapshot,
} from "./mutation-persistence";
import { makePreparedEntityCreate, type PreparedEntityCreate } from "./prepared-entity-create";
import { ensureScopeKey, EntitiesRepository, providerEntityMutationLockKey } from "./repository";
import {
	assertStableUnder,
	DomainLifecycleCommand,
	type DomainWriteCheck,
	DomainWriteChecks,
	DomainWriteConflict,
	type DomainWritePin,
	writerPropertiesSchema,
} from "./write-context";

export type EnsureUserEntityItem = {
	name: string;
	properties: unknown;
	entitySchema: EntitySchemaReference;
};
export type EntityUpsertBatchScope = Pick<LifecycleBatchInput, "identity"> & {
	command: DomainLifecycleCommand;
};
/** A prepared entity write with the request its policies receive. */
export type EntityPolicyItem = {
	readonly mutation: PreparedMutation;
	readonly propertiesSchema: AppSchema;
	readonly request: AutomationEntityRequestPayload;
};
export type UpsertEntityInput = Scope & {
	name: string;
	externalId: string;
	properties: unknown;
	updateExisting: boolean;
	populatedAt: Date | null;
	preservePopulatedAt?: boolean;
	providerId: SandboxProviderId;
	lifecycle: DomainLifecycleCommand;
	entitySchema: EntitySchemaReference;
};

type Scope = { scope: "global" } | { scope: "user"; userId: UserId };
const policyItems = Symbol("EntityPolicyItems");
type PolicyItems = { readonly [policyItems]: ReadonlyArray<EntityPolicyItem> };
/** The entity writes a prepared token asks its policies to decide. */
export const entityPolicyItems = (token: PolicyItems) => token[policyItems];

/**
 * A policy decision applied to a prepared write; writes outside the decided items stand as prepared.
 * Persisting validates the result again under the catalog lock.
 */
export type EntityPolicyAcceptance = (
	mutation: PreparedMutation,
) => Effect.Effect<PreparedMutation, DbError | EntityNotFound | EntityBadRequest>;
export const acceptPrepared: EntityPolicyAcceptance = Effect.succeed;

const preparedEntitySave = Symbol("PreparedEntitySave");
type PreparedEntitySave = PolicyItems & {
	readonly entityId: EntityId;
	readonly created: null | PreparedEntityCreate;
	readonly [preparedEntitySave]: {
		readonly userEditable: boolean;
		readonly scopeUserId: null | UserId;
		readonly existing: null | ListedEntity;
		readonly lifecycle: DomainLifecycleCommand;
		readonly mutation: null | PreparedMutation;
	};
};
const preparedEntityEnsures = Symbol("PreparedEntityEnsures");
type PreparedEntityEnsures = PolicyItems & {
	readonly [preparedEntityEnsures]: {
		readonly userId: UserId;
		readonly lifecycle: DomainLifecycleCommand;
		readonly representatives: ReadonlyArray<number>;
		readonly items: ReadonlyArray<EnsureUserEntityItem>;
		readonly prepared: ReadonlyArray<{
			readonly item: EnsureUserEntityItem;
			readonly prepared: null | PreparedMutation;
			readonly existing: null | { readonly id: EntityId };
		}>;
	};
};
const preparedEntityDeletes = Symbol("PreparedEntityDeletes");
type PreparedEntityDeletes = PolicyItems & {
	readonly [preparedEntityDeletes]: {
		readonly accounts: ReadonlyArray<UserId>;
		readonly lifecycle: DomainLifecycleCommand;
		readonly orderedIds: ReadonlyArray<EntityId>;
		readonly prepared: ReadonlyArray<null | {
			readonly scopeUserId: null | UserId;
			readonly prepared: PreparedMutation;
		}>;
		readonly events: ReadonlyArray<{
			readonly userId: UserId;
			readonly command: DomainLifecycleCommand;
			readonly changes: ReadonlyArray<EventMutation>;
		}>;
	};
};
/** The draft a prepared save proposes; null when it keeps an existing entity unchanged. */
export const entitySaveDraft = (saved: PreparedEntitySave) =>
	saved[preparedEntitySave].mutation?.draft ?? null;
/** The deletes of the events referencing the deleted entities, by the user who owns them. */
export const entityDeleteEvents = (deletes: PreparedEntityDeletes) =>
	deletes[preparedEntityDeletes].events;

/**
 * An entity write in the user's scope or, without one, the global scope. A create with a provider
 * keeps the entity its external ID already names unless `updateExisting`; a user entity names both or
 * neither.
 */
export type PrepareEntitySaveInput = {
	name: string;
	properties: unknown;
	scopeUserId: null | UserId;
	populatedAt?: null | string;
	lifecycle: DomainLifecycleCommand;
	entitySchema: EntitySchemaReference;
	target:
		| { kind: "update"; entityId: EntityId; expected: EntityExpected }
		| {
				kind: "create";
				externalId?: string;
				provider?: { updateExisting: boolean; providerId: SandboxProviderId };
		  };
};
type EntityExpected = Pick<EntitySnapshotResult["entity"], "name" | "updatedAt" | "properties">;
const bad = (code: "enclosing-transaction" | "invalid-policy-transform") =>
	new EntityBadRequest({ reason: { code } });
const enclosingTransaction = () => bad("enclosing-transaction");
const writeFailure = (error: DbError | DomainWriteConflict) =>
	error instanceof DomainWriteConflict
		? Effect.fail(new EntityBadRequest({ reason: error.reason }))
		: conflict(error.message);
const itemCommand = (
	lifecycle: DomainLifecycleCommand,
	identity: string,
): DomainLifecycleCommand => ({
	...lifecycle,
	itemIdentity: stableStringify([lifecycle.itemIdentity, identity]),
});
const commandEntityId = (lifecycle: DomainLifecycleCommand) =>
	EntityId.make(
		`ent_${sha256Base64Url(stableStringify([lifecycle.causation.executionId, lifecycle.itemIdentity]))}`,
	);

const preparedWriteCheck = (input: PreparedMutation): DomainWriteCheck => ({
	command: input.lifecycle,
	scopeUserId: input.scopeUserId,
	owner: definitionOwner(input.entitySchemaPluginId),
});
const ensureScopeOf = (item: EnsureUserEntityItem) => ({
	entitySchemaSlug: item.entitySchema.slug,
	entitySchemaPluginId: definitionOwnerPluginId(item.entitySchema.owner),
});
const batchRepresentatives = Effect.fnUntraced(function* <T>(
	items: ReadonlyArray<T>,
	identityKey: (item: T) => string,
	inputOf: (item: T) => unknown,
) {
	const byIdentity = new Map<string, number>();
	const representatives: number[] = [];
	for (const [index, item] of items.entries()) {
		const key = identityKey(item);
		const first = byIdentity.get(key);
		if (first === undefined) {
			byIdentity.set(key, index);
			representatives.push(index);
			continue;
		}
		const firstItem = items[first];
		if (
			firstItem === undefined ||
			stableStringify(inputOf(firstItem)) !== stableStringify(inputOf(item))
		) {
			return yield* conflict("Entity batch repeats an identity with different input");
		}
		representatives.push(first);
	}
	return representatives;
});

const requestOf = (input: PreparedMutation): Effect.Effect<AutomationEntityRequestPayload> => {
	if (input.operation === "create") {
		return Effect.succeed({
			resource: "entity",
			draft: input.draft,
			operation: "create",
			category: "request",
		});
	}
	if (input.before === null) {
		return Effect.die("An entity mutation is missing its persisted snapshot");
	}
	return Effect.succeed(
		input.operation === "update"
			? {
					resource: "entity",
					draft: input.draft,
					category: "request",
					operation: "update",
					before: input.before,
				}
			: { resource: "entity", operation: "delete", draft: input.before, category: "request" },
	);
};

const policyItem = (mutation: PreparedMutation, propertiesSchema: AppSchema) =>
	Effect.map(requestOf(mutation), (request) => ({ request, mutation, propertiesSchema }));

const schemaKeyOf = (mutation: PreparedMutation) =>
	definitionKey(
		"entity",
		definitionOwner(mutation.entitySchemaPluginId),
		mutation.draft.entitySchemaSlug,
	);

/** Matches the policies of every prepared entity write in one scope, in the caller's transaction. */
export const matchEntityPolicies = (input: {
	readonly userId: null | UserId;
	readonly command: DomainLifecycleCommand;
	readonly items: ReadonlyArray<EntityPolicyItem>;
}) =>
	matchPolicyChunks(
		subjectChunks(input.items, (item) => item.mutation.entityId),
		(items, index) =>
			Effect.succeed({
				references: {},
				userId: input.userId,
				resource: "entity" as const,
				command: {
					...input.command,
					itemIdentity: `${input.command.itemIdentity}:entity-policies:${index}`,
				},
				propertiesSchemas: Object.fromEntries(
					items.map(({ mutation, propertiesSchema }) => [schemaKeyOf(mutation), propertiesSchema]),
				),
				items: items.map(({ request, mutation }) => ({
					request,
					schemaKey: schemaKeyOf(mutation),
					itemIdentity: mutation.lifecycle.itemIdentity,
				})),
			}),
	);

/** Runs the matched entity policies, outside any transaction. */
export const applyEntityPolicies = (
	chunks: Effect.Success<ReturnType<typeof matchEntityPolicies>>,
) =>
	applyPolicyChunks(chunks).pipe(
		Effect.catchTag("AutomationPolicyExecutionError", (error) =>
			Effect.fail(
				new EntityBadRequest({ reason: { runId: error.runId, code: "policy-execution-failed" } }),
			),
		),
	);

/**
 * Accepts each matched policy decision: a rejection or invalid result fails, and a transform
 * replaces the draft.
 */
export const acceptEntityPolicies = (
	chunks: Effect.Success<ReturnType<typeof applyEntityPolicies>>,
): EntityPolicyAcceptance => {
	const decided = new Map<string, PolicyBatchResult["items"][number]>();
	for (const chunk of chunks) {
		for (const item of chunk.validated.items) {
			decided.set(item.itemIdentity, item);
		}
	}
	return Effect.fnUntraced(function* (mutation: PreparedMutation) {
		const decision = decided.get(mutation.lifecycle.itemIdentity);
		if (!decision) {
			return mutation;
		}
		if (decision.rejected !== null) {
			return yield* new EntityBadRequest({
				reason: { code: "policy-rejected", message: decision.rejected },
			});
		}
		if (decision.error !== null) {
			return yield* decision.error.code === "invalid-properties"
				? new EntityBadRequest({ reason: { paths: [], code: "invalid-properties" } })
				: bad("invalid-policy-transform");
		}
		if (decision.patches.length === 0) {
			return mutation;
		}
		const { request } = decision;
		if (request.resource !== "entity" || request.operation === "delete") {
			return yield* bad("invalid-policy-transform");
		}
		return { ...mutation, draft: request.draft };
	});
};

export class EntitiesService extends Context.Service<EntitiesService>()(
	"@ryot-app/kernel-backend/modules/entities/service/EntitiesService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const planner = yield* LifecyclePlanner;
			const repository = yield* EntitiesRepository;
			const writeChecks = yield* DomainWriteChecks;
			const admission = yield* AccountAdmission.make;
			const keys = yield* IdempotencyKeys.make;
			const eventsRepository = yield* EventsRepository;
			const attachments = yield* EntityUserDataAttachments;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const assertOwner = session.requireRoot.pipe(Effect.mapError(enclosingTransaction));
			const assertActiveTransaction = session.requireTransaction.pipe(
				Effect.mapError(
					() => new LifecyclePersistenceError({ code: "active-transaction-required" }),
				),
			);
			const admitted = <A, E, R>(
				work: Effect.Effect<A, E, R>,
				userIds: ReadonlyArray<UserId>,
				accounts: ReadonlyArray<Effect.Success<ReturnType<typeof admission.currentAccount>>>,
			) =>
				Effect.gen(function* () {
					for (const account of [...accounts].sort((left, right) => left.localeCompare(right))) {
						yield* admission.admitAccount(account);
					}
					yield* repository.lockSchemaCatalog([...userIds, ...accounts]);
					return yield* work;
				});
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>, userIds: ReadonlyArray<UserId>) =>
				runRootTransaction(session, admitted(work, userIds, [])).pipe(
					Effect.catchTag("DatabaseSessionStateError", () => Effect.fail(enclosingTransaction())),
				);

			const entitySchema = Effect.fnUntraced(function* (
				scopeUserId: null | UserId,
				reference: EntitySchemaReference,
			) {
				const definition = yield* scopeUserId === null
					? repository.findSystemEntitySchemaByReference(reference)
					: repository.findEntitySchemaForUser({ userId: scopeUserId, entitySchema: reference });
				if (!definition) {
					return yield* new EntityNotFound({
						reason: { schema: reference, code: "entity-schema-not-found" },
					});
				}
				return definition;
			});
			/** Records an import's reference to an existing user entity as unchanged. */
			const recordImportReference = Effect.fn("EntitiesService.recordImportReference")(
				function* (input: {
					userId: UserId;
					entityId: EntityId;
					lifecycle: DomainLifecycleCommand;
				}) {
					return yield* transaction(
						Effect.gen(function* () {
							yield* writeChecks
								.check(
									input.lifecycle,
									principalOwner(input.lifecycle.writeContext),
									input.userId,
									true,
								)
								.pipe(Effect.catch(writeFailure));
							const entity = yield* repository.getByIdForUser(input);
							if (!entity) {
								return yield* new EntityNotFound({
									reason: { code: "entity-not-found", entityId: input.entityId },
								});
							}
							const result = yield* Schema.decodeEffect(EntitySnapshotResult)({ entity });
							yield* keys.recordImportItem(input.lifecycle, input.userId, "unchanged");
							return result;
						}),
						mutationUserIds(input.lifecycle, input.userId),
					);
				},
			);
			const validateDraft = Effect.fnUntraced(function* (
				draft: { properties: unknown } & Omit<
					AutomationEntityDraft,
					"properties" | "entitySchemaPluginId"
				>,
				scopeUserId: null | UserId,
				owner: DefinitionOwner,
				lifecycle: DomainLifecycleCommand,
				commit?: boolean,
				verified?: null | DomainWritePin,
			) {
				const entitySchemaPluginId = definitionOwnerPluginId(owner);
				if (
					lifecycle.writeContext?.pluginRevision &&
					lifecycle.kernelCollection === true &&
					entitySchemaPluginId === null &&
					draft.entitySchemaSlug !== "collection"
				) {
					return yield* new EntityBadRequest({
						reason: {
							code: "owner-mismatch",
							actual: { kind: "kernel" },
							expected: definitionOwner(lifecycle.writeContext.pluginRevision.id),
						},
					});
				}
				const pin =
					verified === undefined
						? yield* writeChecks
								.check(lifecycle, owner, scopeUserId, commit)
								.pipe(Effect.catch(writeFailure))
						: verified;
				const { pinned: pinnedDeclaration, active: activeDeclaration } =
					yield* writeChecks.resolvePinnedDeclaration("entity", pin, owner, draft.entitySchemaSlug);
				if (pin && !activeDeclaration) {
					return yield* conflict("Pinned entity declaration has no active storage definition");
				}
				const activeDefinition = activeDeclaration
					? {
							slug: draft.entitySchemaSlug,
							pluginId: entitySchemaPluginId,
							propertiesSchema: activeDeclaration.propertiesSchema,
						}
					: yield* entitySchema(scopeUserId, { owner, slug: draft.entitySchemaSlug });
				if (draft.providerId !== null) {
					const provider = yield* writeChecks
						.checkProvider(draft.providerId, owner)
						.pipe(Effect.catch((error) => conflict(error.message)));
					if (provider.ownerId !== scopeUserId) {
						return yield* new EntityBadRequest({ reason: { code: "provider-scope-mismatch" } });
					}
				}
				if (pin && !pinnedDeclaration) {
					return yield* conflict("Entity schema is not declared by the pinned writer");
				}
				const definition = pinnedDeclaration
					? { ...activeDefinition, propertiesSchema: pinnedDeclaration.propertiesSchema }
					: activeDefinition;
				const name = trimToNull(draft.name);
				if (!name) {
					return yield* new EntityBadRequest({ reason: { field: "name", code: "name-required" } });
				}
				const properties = yield* parseAppSchemaProperties({
					kind: "Entity",
					properties: draft.properties,
					propertiesSchema: pinnedDeclaration
						? writerPropertiesSchema(definition.propertiesSchema)
						: definition.propertiesSchema,
				}).pipe(
					Effect.mapError(
						(error) =>
							new EntityBadRequest({
								reason: { code: "invalid-properties", paths: error.issues.map(({ path }) => path) },
							}),
					),
				);
				if (commit && pinnedDeclaration) {
					yield* assertStableUnder(
						"Entity",
						writerPropertiesSchema(activeDefinition.propertiesSchema),
						properties,
						(reason) => reason,
					).pipe(
						Effect.catch((reason) =>
							conflict(
								reason === "invalid"
									? "Pinned entity payload violates active storage constraints"
									: "Active entity constraints would change the pinned payload",
							),
						),
					);
				}
				const validated = yield* Schema.decodeUnknownEffect(AutomationEntityDraft)({
					...draft,
					name,
					properties,
					entitySchemaPluginId,
				}).pipe(
					Effect.mapError(
						() => new EntityBadRequest({ reason: { paths: [], code: "invalid-properties" } }),
					),
				);
				return {
					draft: validated,
					propertiesSchema: definition.propertiesSchema,
					entitySchemaPluginId: definition.pluginId ?? null,
					entitySchemaFingerprint: catalogDefinitionFingerprint(definition),
					immutableProperties: [
						...new Set([
							...collectImmutableProperties(definition.propertiesSchema),
							...collectImmutableProperties(activeDefinition.propertiesSchema),
						]),
					],
				};
			});
			const validateExistingEntity = Effect.fnUntraced(function* (
				entity: EntitySnapshotResult["entity"],
				scopeUserId: null | UserId,
				lifecycle: DomainLifecycleCommand,
				pin?: null | DomainWritePin,
			) {
				if (!lifecycle.writeContext?.pluginRevision) {
					return yield* Effect.void;
				}
				const parsed = yield* validateDraft(
					draftOf(yield* snapshot(entity)),
					scopeUserId,
					definitionOwner(entity.entitySchemaPluginId),
					lifecycle,
					false,
					pin,
				).pipe(
					Effect.catch(() => conflict("Current entity cannot be processed by the pinned writer")),
				);
				if (!same(parsed.draft.properties, entity.properties)) {
					return yield* conflict("Pinned entity constraints would change the current stored value");
				}
				return yield* Effect.void;
			});
			const accepted = Effect.fnUntraced(function* (
				mutation: PreparedMutation,
				accept: EntityPolicyAcceptance,
			) {
				const decided = yield* accept(mutation);
				const { entitySchemaPluginId: _owner, ...draft } = decided.draft;
				const validated = yield* validateDraft(
					draft,
					decided.scopeUserId,
					definitionOwner(decided.entitySchemaPluginId),
					decided.lifecycle,
					true,
				);
				if (
					validated.entitySchemaPluginId !== decided.entitySchemaPluginId ||
					!same(validated.entitySchemaFingerprint, decided.entitySchemaFingerprint)
				) {
					return yield* conflict("Entity schema ownership changed while policies ran");
				}
				return { ...decided, draft: validated.draft };
			});
			const persistence = {
				keys,
				planner,
				admission,
				repository,
				validateDraft,
				assetReferences,
				authorizeMutation: (input: PreparedMutation) =>
					writeChecks
						.check(
							input.lifecycle,
							definitionOwner(input.entitySchemaPluginId),
							input.scopeUserId,
							true,
						)
						.pipe(Effect.asVoid, Effect.catch(writeFailure)),
			};
			const persistSnapshots = makePersistMutation({
				...persistence,
				resultOf: (entity) => ({ entity }),
			});
			const persistDeletes = makePersistMutation({ ...persistence, resultOf: () => null });
			const persistEnsures = makePersistMutation({
				...persistence,
				resultOf: (entity, wasInserted) => ({ wasInserted, entityId: entity.id }),
			});
			const verifyWrites = (checks: ReadonlyArray<DomainWriteCheck>) =>
				writeChecks.checkMany(checks).pipe(Effect.catch(writeFailure));

			const entityBatchPlans = Effect.fnUntraced(function* (batch: EntityUpsertBatchScope) {
				const pin = batch.command.writeContext?.pluginRevision;
				yield* writeChecks
					.check(
						batch.command,
						definitionOwner(pin?.id ?? null),
						pin?.scope === "user" ? pin.ownerId : null,
						true,
					)
					.pipe(Effect.catch(writeFailure));
				return yield* planner.planBatch({ ...batch, resource: "entity" });
			});
			const assertImmutablePropertiesKept = Effect.fnUntraced(function* (
				prepared: PreparedMutation,
			) {
				if (
					prepared.operation !== "update" ||
					prepared.before === null ||
					prepared.scopeUserId === null
				) {
					return yield* Effect.void;
				}
				const { immutableProperties } = yield* validateDraft(
					prepared.draft,
					prepared.scopeUserId,
					definitionOwner(prepared.entitySchemaPluginId),
					prepared.lifecycle,
				);
				for (const property of immutableProperties) {
					const stored = prepared.before.properties[property];
					if (stored !== undefined && !same(stored, prepared.draft.properties[property])) {
						return yield* new EntityBadRequest({
							reason: { property, code: "immutable-property" },
						});
					}
				}
				return yield* Effect.void;
			});
			const assertUserEditable = Effect.fnUntraced(function* (prepared: PreparedMutation) {
				if (prepared.operation !== "update") {
					return yield* Effect.void;
				}
				yield* repository.lockMutationKeys([prepared.entityId]);
				const current = yield* repository.getMutationEntity(prepared.entityId, true);
				if (
					!current ||
					prepared.scopeUserId === null ||
					current.userId !== prepared.scopeUserId ||
					current.entity.providerId !== null
				) {
					return yield* new EntityNotFound({
						reason: { code: "entity-not-found", entityId: prepared.entityId },
					});
				}
				return yield* Effect.void;
			});
			const planCreate = Effect.fnUntraced(function* (
				input: Omit<PrepareEntitySaveInput, "target"> &
					Omit<Extract<PrepareEntitySaveInput["target"], { kind: "create" }>, "kind">,
			) {
				const { provider, externalId, scopeUserId } = input;
				if (
					(provider !== undefined || scopeUserId !== null) &&
					(externalId !== undefined) !== (provider !== undefined)
				) {
					return yield* new EntityBadRequest({
						reason: { code: "incomplete-provenance", fields: ["externalId", "providerId"] },
					});
				}
				const validated = yield* validateDraft(
					{
						name: input.name,
						properties: input.properties,
						externalId: externalId ?? null,
						populatedAt: input.populatedAt ?? null,
						providerId: provider?.providerId ?? null,
						entitySchemaSlug: input.entitySchema.slug,
					},
					scopeUserId,
					input.entitySchema.owner,
					input.lifecycle,
				);
				const existing =
					provider && externalId !== undefined
						? yield* transaction(
								Effect.gen(function* () {
									const identity = {
										externalId,
										providerId: provider.providerId,
										...(scopeUserId === null
											? { scope: "global" as const }
											: { userId: scopeUserId, scope: "user" as const }),
										entitySchemaSlug: input.entitySchema.slug,
										entitySchemaPluginId: validated.entitySchemaPluginId,
									};
									yield* repository.lockProviderEntityMutations([identity]);
									const entity = yield* repository.findEntityByExternalId(identity);
									return entity
										? ((yield* repository.getMutationEntity(entity.id, true))?.entity ?? null)
										: null;
								}),
								mutationUserIds(input.lifecycle, scopeUserId),
							)
						: null;
				if (existing) {
					yield* validateExistingEntity(existing, scopeUserId, input.lifecycle);
				}
				const replay = existing?.id === commandEntityId(input.lifecycle);
				if (existing && !replay && !provider?.updateExisting) {
					return { existing, mutation: null, propertiesSchema: validated.propertiesSchema };
				}
				const mutation: PreparedMutation = {
					scopeUserId,
					draft: validated.draft,
					lifecycle: input.lifecycle,
					entitySchemaPluginId: validated.entitySchemaPluginId,
					operation: existing && !replay ? "update" : "create",
					entityId: existing?.id ?? commandEntityId(input.lifecycle),
					entitySchemaFingerprint: validated.entitySchemaFingerprint,
					before: existing && !replay ? yield* snapshot(existing) : null,
				};
				return { mutation, existing: null, propertiesSchema: validated.propertiesSchema };
			});
			const persistPlannedProviderUpserts = Effect.fn(
				"EntitiesService.persistPlannedProviderUpserts",
			)(function* (input: {
				readonly batch: EntityUpsertBatchScope;
				readonly items: ReadonlyArray<UpsertEntityInput>;
			}) {
				yield* assertActiveTransaction;
				const items = input.items.map((item) => {
					const scopeUserId = item.scope === "user" ? item.userId : null;
					return {
						item,
						scopeUserId,
						check: { scopeUserId, command: item.lifecycle, owner: item.entitySchema.owner },
						identity: {
							...item,
							entitySchemaSlug: item.entitySchema.slug,
							entitySchemaPluginId: definitionOwnerPluginId(item.entitySchema.owner),
						},
					};
				});
				const representatives = yield* batchRepresentatives(
					items,
					({ identity }) => providerEntityMutationLockKey(identity),
					({ item }) => ({ ...item, name: item.name.trim() }),
				);
				yield* repository.lockSchemaCatalog(
					items.flatMap(({ item, scopeUserId }) => mutationUserIds(item.lifecycle, scopeUserId)),
				);
				const decision = yield* planner.prepareBatch({
					...input.batch,
					resource: "entity",
					scopes: items.map(({ scopeUserId }) => scopeUserId),
				});
				const pins = yield* verifyWrites(items.map(({ check }) => check));
				const unique = yield* Effect.forEach(
					items.flatMap((entry, index) =>
						representatives[index] === index ? [{ ...entry, index, pin: pins(entry.check) }] : [],
					),
					(entry) =>
						Schema.decodeEffect(DomainLifecycleCommand)(entry.item.lifecycle).pipe(
							Effect.map((lifecycle) => ({ ...entry, lifecycle })),
							Effect.catch(() => conflict("Invalid lifecycle command")),
						),
				);
				const pending = yield* Effect.forEach(unique, (entry) =>
					validateDraft(
						{
							name: entry.item.name,
							properties: entry.item.properties,
							externalId: entry.item.externalId,
							providerId: entry.item.providerId,
							entitySchemaSlug: entry.item.entitySchema.slug,
							populatedAt: entry.item.populatedAt?.toISOString() ?? null,
						},
						entry.scopeUserId,
						entry.item.entitySchema.owner,
						entry.item.lifecycle,
						false,
						entry.pin,
					).pipe(Effect.map((validated) => ({ ...entry, validated }))),
				);
				yield* repository.lockProviderEntityMutations(pending.map(({ identity }) => identity));
				const found = yield* repository.findEntitiesByExternalIds(
					pending.map(({ identity }) => identity),
				);
				const foundIdOf = (entry: (typeof pending)[number]) =>
					found.get(providerEntityMutationLockKey(entry.identity))?.id ?? null;
				const entityIds = pending.map(
					(entry) => foundIdOf(entry) ?? commandEntityId(entry.lifecycle),
				);
				yield* repository.lockMutationKeys(entityIds);
				const rows = yield* repository.getMutationEntities(entityIds, true);
				const settled = new Map<number, CommittedLifecycleWork<EntitySnapshotResult>>();
				const persisted: PersistItem[] = [];
				for (const entry of pending) {
					const foundId = foundIdOf(entry);
					const existing = foundId === null ? null : (rows.get(foundId)?.entity ?? null);
					if (existing) {
						yield* validateExistingEntity(
							existing,
							entry.scopeUserId,
							entry.item.lifecycle,
							pins({
								command: entry.item.lifecycle,
								scopeUserId: entry.scopeUserId,
								owner: definitionOwner(existing.entitySchemaPluginId),
							}),
						);
					}
					const replay = existing?.id === commandEntityId(entry.lifecycle);
					if (existing && !replay && !entry.item.updateExisting && existing.populatedAt !== null) {
						settled.set(entry.index, { dispatch: [], result: { entity: existing } });
						continue;
					}
					const before = existing && !replay ? yield* snapshot(existing) : null;
					const prepared: PreparedMutation = {
						before,
						lifecycle: entry.lifecycle,
						draft: entry.validated.draft,
						scopeUserId: entry.scopeUserId,
						operation: before === null ? "create" : "update",
						entityId: existing?.id ?? commandEntityId(entry.lifecycle),
						entitySchemaPluginId: entry.validated.entitySchemaPluginId,
						entitySchemaFingerprint: entry.validated.entitySchemaFingerprint,
					};
					persisted.push({
						input: prepared,
						batchIndex: entry.index,
						pin: pins(preparedWriteCheck(prepared)),
						...(entry.item.preservePopulatedAt ? { preservePopulatedAt: true } : {}),
					});
				}
				const saved = yield* persistSnapshots.persistMany(persisted, decision, rows);
				for (const [position, item] of persisted.entries()) {
					const work = saved.results[position];
					if (!work) {
						return yield* Effect.die("Planned provider upsert is missing its result");
					}
					settled.set(item.batchIndex, work);
				}
				const results: EntitySnapshotResult[] = [];
				const itemDispatch: LifecycleDispatchPlan[] = [];
				for (const [index, representative] of representatives.entries()) {
					const work = settled.get(representative);
					if (!work) {
						return yield* Effect.die("Planned provider upsert is missing its result");
					}
					results.push(work.result);
					if (representative === index) {
						itemDispatch.push(...work.dispatch);
					}
				}
				const batchDispatch = yield* entityBatchPlans(input.batch);
				return { results, dispatch: [...itemDispatch, ...batchDispatch] };
			});
			const persistPlannedProviderUpsert = Effect.fn(
				"EntitiesService.persistPlannedProviderUpsert",
			)(function* (input: UpsertEntityInput) {
				const work = yield* persistPlannedProviderUpserts({
					items: [input],
					batch: { identity: ["batch"], command: input.lifecycle },
				});
				const [result] = work.results;
				if (!result) {
					return yield* Effect.die("Planned provider upsert is missing its result");
				}
				return {
					result,
					dispatch: work.dispatch,
				} satisfies CommittedLifecycleWork<EntitySnapshotResult>;
			});
			/** Prepares an entity create or update outside the commit; its policies run with its batch. */
			const prepareSave = Effect.fn("EntitiesService.prepareSave")(function* (
				input: PrepareEntitySaveInput,
			) {
				yield* assertOwner;
				const { lifecycle, scopeUserId, entitySchema: reference } = input;
				let planned: {
					readonly propertiesSchema: AppSchema;
					readonly existing: null | ListedEntity;
					readonly mutation: null | PreparedMutation;
				};
				if (input.target.kind === "create") {
					const { kind: _create, ...identity } = input.target;
					planned = yield* planCreate({ ...input, ...identity });
				} else {
					const { entityId, expected } = input.target;
					const current = yield* repository.getMutationEntity(entityId);
					if (
						!current ||
						current.userId !== scopeUserId ||
						(scopeUserId !== null && current.entity.providerId !== null) ||
						current.entity.entitySchemaSlug !== reference.slug ||
						(current.entity.entitySchemaPluginId ?? null) !==
							definitionOwnerPluginId(reference.owner)
					) {
						return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
					}
					yield* writeChecks
						.check(lifecycle, definitionOwner(current.entity.entitySchemaPluginId), current.userId)
						.pipe(Effect.catch(writeFailure));
					const before = yield* snapshot(current.entity);
					if (
						!same(expected, {
							name: before.name,
							updatedAt: before.updatedAt,
							properties: before.properties,
						})
					) {
						return yield* new EntityStale({ reason: { entityId, code: "entity-stale" } });
					}
					yield* validateExistingEntity(current.entity, current.userId, lifecycle);
					const validated = yield* validateDraft(
						{
							...draftOf(before),
							name: input.name,
							properties: input.properties,
							populatedAt: input.populatedAt === undefined ? before.populatedAt : input.populatedAt,
						},
						current.userId,
						definitionOwner(current.entity.entitySchemaPluginId),
						lifecycle,
					);
					planned = {
						existing: null,
						propertiesSchema: validated.propertiesSchema,
						mutation: {
							before,
							entityId,
							lifecycle,
							scopeUserId,
							operation: "update",
							draft: validated.draft,
							entitySchemaPluginId: validated.entitySchemaPluginId,
							entitySchemaFingerprint: validated.entitySchemaFingerprint,
						},
					};
				}
				const { mutation, existing } = planned;
				const entityId = mutation?.entityId ?? existing?.id;
				if (entityId === undefined) {
					return yield* Effect.die("A prepared entity save names no entity");
				}
				return Object.freeze({
					entityId,
					[policyItems]: mutation ? [yield* policyItem(mutation, planned.propertiesSchema)] : [],
					[preparedEntitySave]: {
						existing,
						mutation,
						lifecycle,
						scopeUserId,
						userEditable: input.target.kind === "update" && scopeUserId !== null,
					},
					created:
						mutation?.operation === "create" && scopeUserId !== null
							? makePreparedEntityCreate({
									entityId,
									userId: scopeUserId,
									entitySchemaSlug: mutation.draft.entitySchemaSlug,
									entitySchemaPluginId: mutation.entitySchemaPluginId,
								})
							: null,
				}) satisfies PreparedEntitySave;
			});
			const persistPreparedSave = Effect.fn("EntitiesService.persistPreparedSave")(function* (
				saved: PreparedEntitySave,
				accept: EntityPolicyAcceptance = acceptPrepared,
			) {
				yield* assertActiveTransaction;
				const { mutation, existing, lifecycle, scopeUserId, userEditable } =
					saved[preparedEntitySave];
				return yield* admitted(
					Effect.gen(function* () {
						if (mutation === null) {
							if (existing === null) {
								return yield* Effect.die("A prepared entity save keeps no entity");
							}
							yield* repository.lockMutationKeys([existing.id]);
							const current = yield* repository.getMutationEntity(existing.id, true);
							if (!current || !same(yield* snapshot(current.entity), yield* snapshot(existing))) {
								return yield* conflict("Entity changed before no-op was recorded");
							}
							yield* keys.recordImportItem(lifecycle, scopeUserId, "unchanged");
							return { dispatch: [], entity: current.entity };
						}
						const prepared = yield* accepted(mutation, accept);
						if (userEditable) {
							yield* assertUserEditable(prepared);
							yield* assertImmutablePropertiesKept(prepared);
						}
						if (isUnchangedUpdate(prepared)) {
							const persisted = yield* persistSnapshots.persistSave(prepared);
							return { dispatch: persisted.dispatch, entity: persisted.result.entity };
						}
						const batchScope = { identity: ["batch"], command: prepared.lifecycle };
						const decision = yield* planner.prepareBatch({
							...batchScope,
							resource: "entity",
							scopes: [prepared.scopeUserId],
						});
						const persisted = yield* persistSnapshots.persistSave(prepared, {
							...decision,
							index: 0,
						});
						const batch = yield* entityBatchPlans(batchScope);
						return { entity: persisted.result.entity, dispatch: [...persisted.dispatch, ...batch] };
					}),
					mutationUserIds(lifecycle, scopeUserId),
					[],
				);
			});
			/**
			 * Prepares deleting entities of one schema in the user's scope or, without one, the global scope,
			 * with the deletes of the events that reference them.
			 */
			const prepareDeletes = Effect.fn("EntitiesService.prepareDeletes")(function* (
				ids: readonly [EntityId, ...EntityId[]],
				lifecycle: DomainLifecycleCommand,
				target: {
					readonly preserveHistory?: boolean;
					readonly scopeUserId: null | UserId;
					readonly entitySchema: EntitySchemaReference;
				},
			) {
				yield* assertOwner;
				const orderedIds = [...new Set(ids)].sort();
				const matchesTarget = (
					current: NonNullable<Effect.Success<ReturnType<typeof repository.getMutationEntity>>>,
				) =>
					current.userId === target.scopeUserId &&
					current.entity.entitySchemaSlug === target.entitySchema.slug &&
					current.entity.entitySchemaPluginId ===
						definitionOwnerPluginId(target.entitySchema.owner);
				for (const entityId of orderedIds) {
					const current = yield* repository.getMutationEntity(entityId);
					if (current) {
						if (!matchesTarget(current)) {
							return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
						}
						yield* writeChecks
							.check(
								lifecycle,
								definitionOwner(current.entity.entitySchemaPluginId),
								current.userId,
							)
							.pipe(Effect.catch(writeFailure));
					}
				}
				const eventIdentities = yield* eventsRepository.listEventIdentitiesForEntities(orderedIds);
				if (target.preserveHistory === true && eventIdentities.length > 0) {
					return yield* new EntityBadRequest({ reason: { code: "entity-has-history" } });
				}
				const accounts = new Map<
					UserId,
					Effect.Success<ReturnType<typeof admission.currentAccount>>
				>();
				if (lifecycle.accountUserId !== null) {
					accounts.set(lifecycle.accountUserId, lifecycle.accountUserId);
				}
				const cascades = new Map<UserId, EventMutation[]>();
				for (const identity of eventIdentities) {
					if (!accounts.has(identity.userId)) {
						accounts.set(identity.userId, yield* admission.currentAccount(identity.userId));
					}
					cascades.set(identity.userId, [
						...(cascades.get(identity.userId) ?? []),
						{
							kind: "delete",
							kernelCollection: true,
							eventId: identity.eventId,
							cascadeEntityIds: orderedIds,
							itemIdentity: `cascade:${identity.eventId}`,
						},
					]);
				}
				const events = [...cascades].map(([userId, changes]) => ({
					userId,
					changes,
					command: { ...lifecycle, accountUserId: accounts.get(userId) ?? null },
				}));
				const prepared = yield* Effect.forEach(orderedIds, (entityId) =>
					Effect.gen(function* () {
						const command = itemCommand(lifecycle, entityId);
						const current = yield* repository.getMutationEntity(entityId);
						if (!current) {
							return null;
						}
						if (!matchesTarget(current)) {
							return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
						}
						const before = yield* snapshot(current.entity);
						yield* validateExistingEntity(current.entity, current.userId, command);
						const validated = yield* validateDraft(
							draftOf(before),
							current.userId,
							definitionOwner(current.entity.entitySchemaPluginId),
							command,
						);
						yield* writeChecks
							.check(command, definitionOwner(current.entity.entitySchemaPluginId), current.userId)
							.pipe(Effect.catch(writeFailure));
						const mutation: PreparedMutation = {
							before,
							entityId,
							lifecycle: command,
							operation: "delete",
							draft: validated.draft,
							scopeUserId: current.userId,
							entitySchemaPluginId: validated.entitySchemaPluginId,
							entitySchemaFingerprint: validated.entitySchemaFingerprint,
						};
						return {
							prepared: mutation,
							scopeUserId: current.userId,
							item: yield* policyItem(mutation, validated.propertiesSchema),
						};
					}),
				);
				return Object.freeze({
					[policyItems]: prepared.flatMap((entry) => (entry === null ? [] : [entry.item])),
					[preparedEntityDeletes]: {
						events,
						lifecycle,
						orderedIds,
						accounts: [...accounts.values()],
						prepared: prepared.map((entry) =>
							entry === null ? null : { prepared: entry.prepared, scopeUserId: entry.scopeUserId },
						),
					},
				}) satisfies PreparedEntityDeletes;
			});
			const persistPreparedDeletes = Effect.fn("EntitiesService.persistPreparedDeletes")(
				function* (
					deletes: PreparedEntityDeletes,
					accept: EntityPolicyAcceptance = acceptPrepared,
				) {
					yield* assertActiveTransaction;
					const { prepared, accounts, lifecycle, orderedIds } = deletes[preparedEntityDeletes];
					return yield* admitted(
						Effect.gen(function* () {
							const writeContext = lifecycle.writeContext;
							let scopeUserId: null | UserId = null;
							if (writeContext?.pluginRevision?.scope === "user") {
								scopeUserId = writeContext.pluginRevision.ownerId;
							}
							const settled = prepared.filter((item) => item !== null);
							const pending = yield* Effect.forEach(settled, (item, index) =>
								Effect.map(accepted(item.prepared, accept), (input) => ({ index, input })),
							);
							const pins = yield* verifyWrites([
								{ scopeUserId, command: lifecycle, owner: principalOwner(lifecycle.writeContext) },
								...pending.map(({ input }) => preparedWriteCheck(input)),
							]);
							yield* repository.lockMutationKeys(orderedIds);
							const rows = yield* repository.getMutationEntities(orderedIds, true);
							if ((yield* eventsRepository.listEventIdentitiesForEntities(orderedIds)).length > 0) {
								return yield* new DbError({
									message: "Entity event references changed while deletion policies ran",
								});
							}
							const batchScope = { command: lifecycle, identity: ["deletes"] };
							const decision = yield* planner.prepareBatch({
								...batchScope,
								resource: "entity",
								scopes: settled.map((item) => item.scopeUserId),
							});
							const persisted = pending.map(({ index, input }) => ({
								input,
								batchIndex: index,
								pin: pins(preparedWriteCheck(input)),
							}));
							yield* attachments.removeEntities(persisted.map(({ input }) => input.entityId));
							const written = yield* persistDeletes.persistMany(persisted, decision, rows);
							const batch = yield* entityBatchPlans(batchScope);
							const dispatch = [...written.results.flatMap((item) => item.dispatch), ...batch];
							return { dispatch, deleted: persisted.map(({ input }) => input.entityId) };
						}),
						[
							...mutationUserIds(lifecycle, null),
							...prepared.flatMap((item) =>
								item === null ? [] : mutationUserIds(lifecycle, item.scopeUserId),
							),
						],
						accounts,
					);
				},
				(effect) => effect.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die)),
			);
			const prepareEnsures = Effect.fn("EntitiesService.prepareEnsures")(function* (
				userId: UserId,
				items: ReadonlyArray<EnsureUserEntityItem>,
				lifecycle: DomainLifecycleCommand,
			) {
				yield* assertOwner;
				yield* writeChecks
					.check(lifecycle, principalOwner(lifecycle.writeContext), userId)
					.pipe(Effect.catch(writeFailure));
				for (const item of items) {
					yield* writeChecks
						.check(lifecycle, item.entitySchema.owner, userId)
						.pipe(Effect.catch(writeFailure));
				}
				const entries = items.map((item) => {
					const command = itemCommand(
						lifecycle,
						definitionKey("entity", item.entitySchema.owner, item.entitySchema.slug),
					);
					return { item, command };
				});
				const representatives = yield* batchRepresentatives(
					entries,
					({ item }) => definitionKey("entity", item.entitySchema.owner, item.entitySchema.slug),
					({ item }) => ({ ...item, name: item.name.trim() }),
				);
				const prepared = yield* Effect.forEach(entries, ({ item, command }, index) =>
					Effect.gen(function* () {
						const existing = yield* repository.findUserEntityWithoutProvenance({
							userId,
							entitySchemaSlug: item.entitySchema.slug,
							entitySchemaPluginId: definitionOwnerPluginId(item.entitySchema.owner),
						});
						if (existing || representatives[index] !== index) {
							return { item, existing, prepared: null, policyItem: null };
						}
						const planned = yield* planCreate({ ...item, lifecycle: command, scopeUserId: userId });
						return {
							item,
							existing,
							prepared: planned.mutation,
							policyItem: planned.mutation
								? yield* policyItem(planned.mutation, planned.propertiesSchema)
								: null,
						};
					}),
				);
				return Object.freeze({
					[policyItems]: prepared.flatMap((entry) =>
						entry.policyItem === null ? [] : [entry.policyItem],
					),
					[preparedEntityEnsures]: {
						items,
						userId,
						lifecycle,
						representatives,
						prepared: prepared.map(({ item, existing, prepared: mutation }) => ({
							item,
							existing,
							prepared: mutation,
						})),
					},
				}) satisfies PreparedEntityEnsures;
			});
			const persistPreparedEnsures = Effect.fn("EntitiesService.persistPreparedEnsures")(function* (
				ensures: PreparedEntityEnsures,
				accept: EntityPolicyAcceptance = acceptPrepared,
			) {
				yield* assertActiveTransaction;
				const { items, userId, prepared, lifecycle, representatives } =
					ensures[preparedEntityEnsures];
				return yield* admitted(
					Effect.gen(function* () {
						const pins = yield* verifyWrites(
							items.map((item) => ({
								command: lifecycle,
								scopeUserId: userId,
								owner: item.entitySchema.owner,
							})),
						);
						const batchScope = { command: lifecycle, identity: ["ensure"] };
						const decision = yield* planner.prepareBatch({
							...batchScope,
							scopes: [userId],
							resource: "entity",
						});
						const unique = prepared.flatMap((entry, index) =>
							representatives[index] === index ? [{ ...entry, index }] : [],
						);
						yield* repository.lockUserEntityEnsureScopes({
							userId,
							entitySchemas: items.map((item) => item.entitySchema),
						});
						const settled = new Map<
							number,
							{
								entityId: EntityId;
								wasInserted: boolean;
								dispatch: ReadonlyArray<LifecycleDispatchPlan>;
							}
						>();
						const existing = yield* repository.findUserEntitiesWithoutProvenance({
							userId,
							scopes: unique.map(({ item }) => ensureScopeOf(item)),
						});
						const persisted: PersistItem[] = [];
						for (const entry of unique) {
							const found = existing.get(ensureScopeKey(ensureScopeOf(entry.item)));
							if (found) {
								settled.set(entry.index, { dispatch: [], wasInserted: false, entityId: found.id });
								continue;
							}
							if (!entry.prepared) {
								return yield* conflict("Ensured entity disappeared while policies ran");
							}
							const input = yield* accepted(entry.prepared, accept);
							persisted.push({
								input,
								batchIndex: entry.index,
								pin: pins(preparedWriteCheck(input)),
							});
						}
						const written = yield* persistEnsures.persistMany(persisted, decision);
						for (const [position, { batchIndex }] of persisted.entries()) {
							const work = written.results[position];
							if (!work) {
								return yield* Effect.die("Ensured entity is missing its result");
							}
							settled.set(batchIndex, { ...work.result, dispatch: work.dispatch });
						}
						const batch = yield* entityBatchPlans(batchScope);
						return yield* Effect.forEach(representatives, (representative, index) => {
							const saved = settled.get(representative);
							if (!saved) {
								return Effect.die("Ensured entity is missing its result");
							}
							return Effect.succeed({
								entityId: saved.entityId,
								wasInserted: saved.wasInserted,
								dispatch: [
									...(representative === index ? saved.dispatch : []),
									...(index === representatives.length - 1 ? batch : []),
								],
							});
						});
					}),
					mutationUserIds(lifecycle, userId),
					[],
				);
			});
			return {
				prepareSave,
				prepareDeletes,
				prepareEnsures,
				persistPreparedSave,
				recordImportReference,
				persistPreparedDeletes,
				persistPreparedEnsures,
				persistPlannedProviderUpsert,
				persistPlannedProviderUpserts,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
	static readonly layerRuntime = Layer.effect(this, this.make);
	static readonly layerMigration = Layer.effect(this, this.make);
}
