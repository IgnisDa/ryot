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
	invalidPolicyItemReason,
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
import { slugify } from "#platform/slug";
import { trimToNull } from "#platform/validation";

import type { EntitySnapshotResult } from "./mutation-outcomes";
import {
	conflict,
	draftOf,
	makePersistMutation,
	type PersistItem,
	type PreparedMutation,
	same,
	snapshot,
} from "./mutation-persistence";
import { makePreparedEntityCreate, type PreparedEntityCreate } from "./prepared-entity-create";
import {
	ensureScopeKey,
	EntitiesRepository,
	type MutationEntity,
	providerEntityMutationLockKey,
} from "./repository";
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

/**
 * An existing entity of the user's scope: by ID, which must exist under the expected schema, or by
 * name. `scope` limits it to the user's or global entities.
 */
export type EntityMatch =
	EntityNameMatch | { readonly entityId: EntityId; readonly scope?: "user" | "global" };
type MatchLookup = EntityNameMatch & {
	readonly userId: UserId;
	readonly entitySchema: EntitySchemaReference;
};
/** The first entity with the name, optionally slug-normalized, and the properties. */
type EntityNameMatch = {
	readonly name: string;
	readonly scope?: "user" | "global";
	readonly nameNormalization: "slug" | "exact";
	readonly properties: Readonly<Record<string, unknown>>;
};
const preparedEntitySave = Symbol("PreparedEntitySave");
type PreparedEntitySave = PolicyItems & {
	readonly entityId: EntityId;
	readonly created: null | PreparedEntityCreate;
	readonly [preparedEntitySave]: {
		readonly matched: boolean;
		readonly userEditable: boolean;
		readonly kept: null | ListedEntity;
		readonly scopeUserId: null | UserId;
		readonly preservePopulatedAt: boolean;
		readonly unmatched: null | MatchLookup;
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
/**
 * The draft a prepared save writes once `accept` applies its policy decision; null when it keeps an
 * existing entity unchanged.
 */
export const entitySaveDraft = (
	saved: PreparedEntitySave,
	accept: EntityPolicyAcceptance = acceptPrepared,
) => {
	const { mutation } = saved[preparedEntitySave];
	return mutation === null
		? Effect.succeed(null)
		: Effect.map(accept(mutation), ({ draft }) => draft);
};
/** The deletes of the events referencing the deleted entities, by the user who owns them. */
export const entityDeleteEvents = (deletes: PreparedEntityDeletes) =>
	deletes[preparedEntityDeletes].events;

/**
 * An entity write in the user's scope or, without one, the global scope. A create with a provider
 * updates the entity its external ID already names when `updateExisting` or while that entity is an
 * unpopulated stub, and keeps it otherwise; a user entity names both or neither.
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
				/** A match that found no entity when prepared; the commit fails if one matches by then. */
				unmatched?: EntityNameMatch;
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
const matchLockKey = (lookup: MatchLookup) =>
	stableStringify([
		"entity-match",
		lookup.userId,
		lookup.scope ?? null,
		lookup.entitySchema,
		lookup.properties,
		lookup.nameNormalization === "slug" ? slugify(lookup.name) : lookup.name,
	]);
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
			return yield* new EntityBadRequest({ reason: invalidPolicyItemReason(decision.error) });
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
				pin: null | undefined | DomainWritePin,
			) {
				const decided = yield* accept(mutation);
				const { entitySchemaPluginId: _owner, ...draft } = decided.draft;
				const validated = yield* validateDraft(
					draft,
					decided.scopeUserId,
					definitionOwner(decided.entitySchemaPluginId),
					decided.lifecycle,
					true,
					pin,
				);
				if (
					validated.entitySchemaPluginId !== decided.entitySchemaPluginId ||
					!same(validated.entitySchemaFingerprint, decided.entitySchemaFingerprint)
				) {
					return yield* conflict("Entity schema changed after the write was prepared");
				}
				return {
					propertiesSchema: validated.propertiesSchema,
					mutation: { ...decided, draft: validated.draft },
					immutableProperties: validated.immutableProperties,
				};
			});
			const persistence = { keys, planner, admission, repository, validateDraft, assetReferences };
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

			/** Seals an entity lifecycle batch after the writer's authority is checked again. */
			const planEntityBatch = Effect.fn("EntitiesService.planEntityBatch")(function* (
				batch: EntityUpsertBatchScope,
			) {
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
			const savedToken = Effect.fnUntraced(function* (
				save: Omit<PreparedEntitySave[typeof preparedEntitySave], "matched" | "unmatched"> & {
					readonly unmatched?: MatchLookup;
					readonly propertiesSchema: AppSchema;
				},
			) {
				const { unmatched, propertiesSchema, ...fields } = save;
				const entry = { ...fields, matched: false, unmatched: unmatched ?? null };
				const { kept, mutation, scopeUserId } = entry;
				const entityId = mutation?.entityId ?? kept?.id;
				if (entityId === undefined) {
					return yield* Effect.die("A prepared entity save names no entity");
				}
				return Object.freeze({
					entityId,
					[preparedEntitySave]: entry,
					[policyItems]: mutation ? [yield* policyItem(mutation, propertiesSchema)] : [],
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
			/**
			 * Plans creates in the caller's transaction against the entities their provider identities
			 * already name. An existing entity is updated when `updateExisting` or while it is an unpopulated
			 * stub, and kept otherwise.
			 */
			const planCreates = Effect.fnUntraced(function* (
				inputs: ReadonlyArray<{
					readonly updateExisting: boolean;
					readonly scopeUserId: null | UserId;
					readonly lifecycle: DomainLifecycleCommand;
					readonly pin?: null | undefined | DomainWritePin;
					readonly validated: Pick<
						Effect.Success<ReturnType<typeof validateDraft>>,
						"draft" | "entitySchemaPluginId" | "entitySchemaFingerprint"
					>;
				}>,
			) {
				const identities = inputs.map(({ validated, scopeUserId }) => {
					const { draft, entitySchemaPluginId } = validated;
					return draft.externalId === null || draft.providerId === null
						? null
						: {
								entitySchemaPluginId,
								externalId: draft.externalId,
								providerId: draft.providerId,
								entitySchemaSlug: draft.entitySchemaSlug,
								...(scopeUserId === null
									? { scope: "global" as const }
									: { userId: scopeUserId, scope: "user" as const }),
							};
				});
				const named = identities.filter((identity) => identity !== null);
				if (named.length > 0) {
					yield* repository.lockProviderEntityMutations(named);
				}
				const found =
					named.length === 0
						? new Map<string, { readonly id: EntityId }>()
						: yield* repository.findEntitiesByExternalIds(named);
				const foundIdOf = (index: number) => {
					const identity = identities[index];
					return identity ? (found.get(providerEntityMutationLockKey(identity))?.id ?? null) : null;
				};
				const lockedIds = inputs.flatMap(({ lifecycle }, index) =>
					identities[index] ? [foundIdOf(index) ?? commandEntityId(lifecycle)] : [],
				);
				if (lockedIds.length > 0) {
					yield* repository.lockMutationKeys(lockedIds);
				}
				const rows =
					lockedIds.length === 0
						? new Map<EntityId, MutationEntity>()
						: yield* repository.getMutationEntities(lockedIds, true);
				return yield* Effect.forEach(inputs, (input, index) =>
					Effect.gen(function* () {
						const foundId = foundIdOf(index);
						const existing = foundId === null ? null : (rows.get(foundId)?.entity ?? null);
						if (existing) {
							yield* validateExistingEntity(
								existing,
								input.scopeUserId,
								input.lifecycle,
								input.pin,
							);
						}
						const entityId = commandEntityId(input.lifecycle);
						const replay = existing?.id === entityId;
						if (existing && !replay && !input.updateExisting && existing.populatedAt !== null) {
							return { kept: existing, mutation: null };
						}
						const before = existing && !replay ? yield* snapshot(existing) : null;
						const mutation: PreparedMutation = {
							before,
							lifecycle: input.lifecycle,
							draft: input.validated.draft,
							scopeUserId: input.scopeUserId,
							entityId: existing?.id ?? entityId,
							operation: before === null ? "create" : "update",
							entitySchemaPluginId: input.validated.entitySchemaPluginId,
							entitySchemaFingerprint: input.validated.entitySchemaFingerprint,
						};
						return { mutation, kept: null };
					}),
				);
			});
			const planCreate = Effect.fnUntraced(function* (
				input: Omit<PrepareEntitySaveInput, "target"> &
					Omit<Extract<PrepareEntitySaveInput["target"], { kind: "create" }>, "kind" | "unmatched">,
			) {
				const { provider, lifecycle, externalId, scopeUserId } = input;
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
					lifecycle,
				);
				const plan = planCreates([
					{ lifecycle, validated, scopeUserId, updateExisting: provider?.updateExisting ?? false },
				]);
				const [planned] = provider
					? yield* transaction(plan, mutationUserIds(lifecycle, scopeUserId))
					: yield* plan;
				if (!planned) {
					return yield* Effect.die("A planned entity create is missing");
				}
				return { ...planned, propertiesSchema: validated.propertiesSchema };
			});
			/**
			 * Persists prepared saves as one set in the caller's transaction, recording their changes in
			 * `batch` from `offset`; the batch's owner seals it with `planEntityBatch`. Each write's final
			 * draft is validated again under the catalog lock, a kept entity is rechecked unchanged (a
			 * matched one only present), and a create whose match found nothing fails if one matches now.
			 */
			const persistPreparedSaves = Effect.fn("EntitiesService.persistPreparedSaves")(function* (
				saves: ReadonlyArray<PreparedEntitySave>,
				accept: EntityPolicyAcceptance,
				batch: EntityUpsertBatchScope,
				offset: number,
			) {
				yield* assertActiveTransaction;
				const entries = saves.map((saved) => saved[preparedEntitySave]);
				yield* repository.lockSchemaCatalog(
					entries.flatMap(({ lifecycle, scopeUserId }) => mutationUserIds(lifecycle, scopeUserId)),
				);
				const decision = yield* planner.prepareBatch({
					...batch,
					resource: "entity",
					scopes: entries.map(({ scopeUserId }) => scopeUserId),
				});
				const pins = yield* verifyWrites(
					entries.flatMap(({ matched, mutation, lifecycle, scopeUserId }) => {
						if (mutation) {
							return [preparedWriteCheck(mutation)];
						}
						return matched
							? [{ scopeUserId, command: lifecycle, owner: principalOwner(lifecycle.writeContext) }]
							: [];
					}),
				);
				const unmatched = entries.flatMap((entry) => (entry.unmatched ? [entry.unmatched] : []));
				if (unmatched.length > 0) {
					yield* repository.lockMutationKeys(unmatched.map(matchLockKey));
					for (const lookup of unmatched) {
						if ((yield* repository.findImportMatch(lookup)) !== null) {
							return yield* conflict("An entity matching the create was written concurrently");
						}
					}
				}
				const decided = yield* Effect.forEach(entries, (entry) =>
					Effect.gen(function* () {
						const { mutation } = entry;
						return {
							entry,
							accepted:
								mutation === null
									? null
									: yield* accepted(mutation, accept, pins(preparedWriteCheck(mutation))),
						};
					}),
				);
				const rows = yield* persistSnapshots.lockRows(
					decided.flatMap((item) => (item.accepted ? [item.accepted.mutation] : [])),
					entries.flatMap(({ kept }) => (kept ? [kept.id] : [])),
				);
				const items: PersistItem[] = [];
				const outcomes: Array<{ readonly position: number } | { readonly kept: ListedEntity }> = [];
				for (const [index, { entry, accepted: write }] of decided.entries()) {
					if (write === null) {
						const { kept } = entry;
						const current = kept ? rows.get(kept.id) : undefined;
						if (
							!kept ||
							!current ||
							(!entry.matched && !same(yield* snapshot(current.entity), yield* snapshot(kept)))
						) {
							return yield* conflict("Entity changed before no-op was recorded");
						}
						yield* keys.recordImportItem(entry.lifecycle, entry.scopeUserId, "unchanged");
						outcomes.push({ kept: current.entity });
						continue;
					}
					const { mutation } = write;
					if (entry.userEditable) {
						const current = rows.get(mutation.entityId);
						if (
							!current ||
							current.userId !== entry.scopeUserId ||
							current.entity.providerId !== null
						) {
							return yield* new EntityNotFound({
								reason: { code: "entity-not-found", entityId: mutation.entityId },
							});
						}
						for (const property of write.immutableProperties) {
							const stored = mutation.before?.properties[property];
							if (stored !== undefined && !same(stored, mutation.draft.properties[property])) {
								return yield* new EntityBadRequest({
									reason: { property, code: "immutable-property" },
								});
							}
						}
					}
					outcomes.push({ position: items.length });
					items.push({
						input: mutation,
						batchIndex: offset + index,
						pin: pins(preparedWriteCheck(mutation)),
						propertiesSchema: write.propertiesSchema,
						...(entry.preservePopulatedAt ? { preservePopulatedAt: true } : {}),
					});
				}
				const written = yield* persistSnapshots.persistMany(items, decision, rows);
				const entities: ListedEntity[] = [];
				const dispatch: LifecycleDispatchPlan[] = [];
				for (const outcome of outcomes) {
					if ("kept" in outcome) {
						entities.push(outcome.kept);
						continue;
					}
					const work = written.results[outcome.position];
					if (!work) {
						return yield* Effect.die("A persisted entity save is missing its result");
					}
					entities.push(work.result.entity);
					dispatch.push(...work.dispatch);
				}
				return { entities, dispatch };
			});
			/**
			 * Plans and persists provider upserts in the caller's transaction through the save path, with
			 * no policies. Items repeating an identity must repeat its input and share its result.
			 */
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
				const pins = yield* verifyWrites(items.map(({ check }) => check));
				const representedItems = items.flatMap((entry, index) =>
					representatives[index] === index ? [{ ...entry, index }] : [],
				);
				const unique = yield* Effect.forEach(representedItems, (entry) =>
					Effect.gen(function* () {
						const pin = pins(entry.check);
						const lifecycle = yield* Schema.decodeEffect(DomainLifecycleCommand)(
							entry.item.lifecycle,
						).pipe(Effect.catch(() => conflict("Invalid lifecycle command")));
						const validated = yield* validateDraft(
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
							lifecycle,
							false,
							pin,
						);
						return {
							pin,
							lifecycle,
							validated,
							scopeUserId: entry.scopeUserId,
							updateExisting: entry.item.updateExisting,
							preservePopulatedAt: entry.item.preservePopulatedAt === true,
						};
					}),
				);
				const planned = yield* planCreates(unique);
				const saves = yield* Effect.forEach(unique, (entry, index) => {
					const plan = planned[index];
					return plan
						? savedToken({
								...plan,
								userEditable: false,
								lifecycle: entry.lifecycle,
								scopeUserId: entry.scopeUserId,
								preservePopulatedAt: entry.preservePopulatedAt,
								propertiesSchema: entry.validated.propertiesSchema,
							})
						: Effect.die("A planned provider upsert is missing");
				});
				const saved = yield* persistPreparedSaves(saves, acceptPrepared, input.batch, 0);
				const positions = new Map(representedItems.map(({ index }, position) => [index, position]));
				const results = yield* Effect.forEach(representatives, (representative) => {
					const entity = saved.entities[positions.get(representative) ?? -1];
					return entity
						? Effect.succeed({ entity })
						: Effect.die("Planned provider upsert is missing its result");
				});
				return { results, dispatch: [...saved.dispatch, ...(yield* planEntityBatch(input.batch))] };
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
			/**
			 * Prepares keeping the entity `match` finds unchanged, or null when it finds none. Committing it
			 * rechecks the entity unchanged and records its import item.
			 */
			const prepareMatch = Effect.fn("EntitiesService.prepareMatch")(function* (input: {
				readonly userId: UserId;
				readonly match: EntityMatch;
				readonly lifecycle: DomainLifecycleCommand;
				readonly entitySchema: EntitySchemaReference;
			}) {
				const { match, userId, entitySchema: reference } = input;
				const inScope = (owner: null | UserId) =>
					match.scope === undefined || (match.scope === "user" ? owner === userId : owner === null);
				let kept: null | ListedEntity = null;
				if ("entityId" in match) {
					const current = yield* repository.getMutationEntity(match.entityId);
					if (
						!current ||
						(current.userId !== null && current.userId !== userId) ||
						current.entity.entitySchemaSlug !== reference.slug ||
						(current.entity.entitySchemaPluginId ?? null) !==
							definitionOwnerPluginId(reference.owner)
					) {
						return yield* new EntityNotFound({
							reason: { code: "entity-not-found", entityId: match.entityId },
						});
					}
					kept = inScope(current.userId) ? current.entity : null;
				} else {
					const found = yield* repository.findImportMatch({
						...match,
						userId,
						entitySchema: reference,
					});
					kept =
						found === null ? null : ((yield* repository.getMutationEntity(found))?.entity ?? null);
				}
				if (kept === null) {
					return null;
				}
				return Object.freeze({
					created: null,
					entityId: kept.id,
					[policyItems]: [],
					[preparedEntitySave]: {
						kept,
						matched: true,
						mutation: null,
						unmatched: null,
						scopeUserId: userId,
						userEditable: false,
						preservePopulatedAt: false,
						lifecycle: input.lifecycle,
					},
				}) satisfies PreparedEntitySave;
			});
			/** Prepares an entity create or update outside the commit; its policies run with its batch. */
			const prepareSave = Effect.fn("EntitiesService.prepareSave")(function* (
				input: PrepareEntitySaveInput,
			) {
				yield* assertOwner;
				const { lifecycle, scopeUserId, entitySchema: reference } = input;
				const common = { lifecycle, scopeUserId, preservePopulatedAt: false };
				if (input.target.kind === "create") {
					const { unmatched, kind: _create, ...identity } = input.target;
					if (unmatched !== undefined && scopeUserId === null) {
						return yield* Effect.die("An entity match requires a user");
					}
					return yield* savedToken({
						...common,
						...(yield* planCreate({ ...input, ...identity })),
						userEditable: false,
						...(unmatched === undefined || scopeUserId === null
							? {}
							: { unmatched: { ...unmatched, userId: scopeUserId, entitySchema: reference } }),
					});
				}
				const { entityId, expected } = input.target;
				const current = yield* repository.getMutationEntity(entityId);
				if (
					!current ||
					current.userId !== scopeUserId ||
					(scopeUserId !== null && current.entity.providerId !== null) ||
					current.entity.entitySchemaSlug !== reference.slug ||
					(current.entity.entitySchemaPluginId ?? null) !== definitionOwnerPluginId(reference.owner)
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
				return yield* savedToken({
					...common,
					kept: null,
					userEditable: scopeUserId !== null,
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
				});
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
							const pins = yield* verifyWrites([
								{ scopeUserId, command: lifecycle, owner: principalOwner(lifecycle.writeContext) },
								...settled.map((item) => preparedWriteCheck(item.prepared)),
							]);
							const pending = yield* Effect.forEach(settled, (item, index) => {
								const pin = pins(preparedWriteCheck(item.prepared));
								return Effect.map(accepted(item.prepared, accept, pin), (decided) => ({
									...decided,
									pin,
									index,
								}));
							});
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
							const persisted = pending.map(({ pin, index, mutation, propertiesSchema }) => ({
								pin,
								input: mutation,
								propertiesSchema,
								batchIndex: index,
							}));
							yield* attachments.removeEntities(persisted.map(({ input }) => input.entityId));
							const written = yield* persistDeletes.persistMany(persisted, decision, rows);
							const batch = yield* planEntityBatch(batchScope);
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
							const pin = pins(preparedWriteCheck(entry.prepared));
							const decided = yield* accepted(entry.prepared, accept, pin);
							persisted.push({
								pin,
								input: decided.mutation,
								batchIndex: entry.index,
								propertiesSchema: decided.propertiesSchema,
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
						const batch = yield* planEntityBatch(batchScope);
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
				prepareMatch,
				prepareDeletes,
				prepareEnsures,
				planEntityBatch,
				persistPreparedSaves,
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
