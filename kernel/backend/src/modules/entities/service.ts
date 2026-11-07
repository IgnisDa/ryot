import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	AutomationEntityRequestPayload,
	type AutomationPolicyPatch,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	definitionKey,
	type DefinitionOwner,
	definitionOwner,
	definitionOwnerPluginId,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { collectImmutableProperties } from "@ryot-app/contract/schema/property-schema";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type CommittedLifecycleWork,
	type LifecycleBatchInput,
	type LifecycleDispatchPlan,
	LifecyclePersistenceError,
	LifecyclePlannedPolicy,
	LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import {
	applyLifecyclePolicyPatch,
	canonicalLifecyclePolicyPatch,
} from "#modules/automations/lifecycle/policy-patch";
import {
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
	runLifecycleWriteInline,
} from "#modules/automations/lifecycle/write-step";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { EntityUserDataAttachments } from "#modules/entities/user-data/attachments";
import { EventsRepository } from "#modules/events/repository";
import { EventsService, type PreparedEventDelete } from "#modules/events/service";
import { AccountAdmission, mutationUserIds } from "#modules/mutations/account-admission";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";
import { principalOwner } from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import { runRootTransaction } from "#platform/db/transaction";
import { trimToNull } from "#platform/validation";

import { EntitySnapshotResult } from "./mutation-outcomes";
import {
	draftOf,
	isUnchangedUpdate,
	makePersistMutation,
	type PersistItem,
	PreparedEntityMutation,
	type PreparedMutation,
	same,
	snapshot,
} from "./mutation-persistence";
import { makePreparedEntityCreate, type PreparedEntityCreate } from "./prepared-entity-create";
import {
	ensureScopeKey,
	EntitiesRepository,
	provenanceScopeKey,
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

export type UpsertGlobalEntitiesOptions = { maximumTotal?: number };
export type EnsureUserEntityItem = {
	name: string;
	properties: unknown;
	entitySchema: EntitySchemaReference;
};
export type EntityUpsertBatchScope = Pick<LifecycleBatchInput, "identity"> & {
	command: DomainLifecycleCommand;
};
export type UpsertGlobalEntityItem = {
	name: string;
	externalId: string;
	properties: unknown;
	populatedAt: Date | null;
	entitySchema: EntitySchemaReference;
};
export type UpsertEntityInput = CreateEntityInput & {
	externalId: string;
	updateExisting: boolean;
	populatedAt: Date | null;
	preservePopulatedAt?: boolean;
	providerId: SandboxProviderId;
};
export type CreateEntityInput = Scope & {
	name: string;
	properties: unknown;
	populatedAt?: Date | null;
	externalId?: string | undefined;
	lifecycle: DomainLifecycleCommand;
	entitySchema: EntitySchemaReference;
	providerId?: undefined | SandboxProviderId;
};
export type UpdateEntityInput = Scope & {
	name: string;
	entityId: EntityId;
	properties: unknown;
	populatedAt?: Date | null;
	requireUserOwned?: boolean;
	lifecycle: DomainLifecycleCommand;
	expected?: Pick<EntitySnapshotResult["entity"], "name" | "updatedAt" | "properties">;
};
type Scope = { scope: "global" } | { scope: "user"; userId: UserId };
const preparedUserEntitySave = Symbol("PreparedUserEntitySave");
type PreparedUserEntitySave = {
	readonly entityId: EntityId;
	readonly created: null | PreparedEntityCreate;
	readonly [preparedUserEntitySave]: PreparedMutation;
};
export const userEntitySaveDraft = (saved: PreparedUserEntitySave) =>
	saved[preparedUserEntitySave].draft;

type PrepareUserEntitySaveInput = {
	name: string;
	userId: UserId;
	properties: unknown;
	lifecycle: DomainLifecycleCommand;
	entitySchema: EntitySchemaReference;
	target:
		| { kind: "create" }
		| {
				kind: "update";
				entityId: EntityId;
				expected: Pick<EntitySnapshotResult["entity"], "name" | "updatedAt" | "properties">;
		  };
};
export const PendingEntityMutation = Schema.Struct({
	...PreparedEntityMutation.fields,
	request: AutomationEntityRequestPayload,
	policies: Schema.Array(LifecyclePlannedPolicy),
});
export type PendingEntityMutation = typeof PendingEntityMutation.Type;
export const EntityMutationError = Schema.Union([EntityBadRequest, EntityNotFound, DbError]);
const PlannedGlobalEntity = Schema.Struct({
	externalId: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	prepared: Schema.NullOr(PreparedEntityMutation),
	entitySchemaPluginId: Schema.NullOr(Schema.String),
});
export const PendingGlobalEntityUpsert = Schema.Struct({
	pending: PendingEntityMutation,
	planned: Schema.Array(PlannedGlobalEntity),
});
export type PendingGlobalEntityUpsert = typeof PendingGlobalEntityUpsert.Type;
export const GlobalEntityUpsertResults = Schema.Array(
	Schema.Union([
		Schema.Struct({ status: Schema.Literal("skipped") }),
		Schema.Struct({
			entityId: EntityId,
			wasInserted: Schema.Boolean,
			status: Schema.Literal("upserted"),
		}),
	]),
);
export type GlobalEntityUpsertResults = typeof GlobalEntityUpsertResults.Type;
export type GlobalEntityUpsertCursor = {
	readonly accepted: null | PendingEntityMutation;
	readonly planned: PendingGlobalEntityUpsert["planned"];
};

const bad = (
	code:
		| "policy-rejected"
		| "automation-limit"
		| "mutation-conflict"
		| "enclosing-transaction"
		| "invalid-policy-transform",
	message: string,
) => new EntityBadRequest({ reason: { code, message } });
const enclosingTransaction = () =>
	bad(
		"enclosing-transaction",
		"EntitiesService must own the transaction and post-commit execution",
	);
const writeFailure = (error: DbError | DomainWriteConflict) =>
	error instanceof DomainWriteConflict
		? new EntityBadRequest({ reason: error.reason })
		: bad("mutation-conflict", error.message);
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
const cascadeEventChanged = () =>
	new DbError({ message: "Event changed while cascade deletion was prepared" });
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
			return yield* bad(
				"mutation-conflict",
				"Entity batch repeats an identity with different input",
			);
		}
		representatives.push(first);
	}
	return representatives;
});

export class EntitiesService extends Context.Service<EntitiesService>()(
	"@ryot-app/kernel-backend/modules/entities/service/EntitiesService",
	{
		make: Effect.gen(function* () {
			const events = yield* EventsService;
			const session = yield* DatabaseSession;
			const planner = yield* LifecyclePlanner;
			const repository = yield* EntitiesRepository;
			const writeChecks = yield* DomainWriteChecks;
			const admission = yield* AccountAdmission.make;
			const keys = yield* IdempotencyKeys.make;
			const eventsRepository = yield* EventsRepository;
			const attachments = yield* EntityUserDataAttachments;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const execution = yield* LifecycleExecution;
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
			const eventTransaction = <A, E, R>(
				work: Effect.Effect<A, E, R>,
				userIds: ReadonlyArray<UserId>,
				accounts: ReadonlyArray<Effect.Success<ReturnType<typeof admission.currentAccount>>>,
			) =>
				events
					.transaction(admitted(work, userIds, accounts))
					.pipe(
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
			const prepareReferenceStep = Effect.fn("EntitiesService.prepareReferenceStep")(
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
								.pipe(Effect.mapError(writeFailure));
							const entity = yield* repository.getByIdForUser(input);
							if (!entity) {
								return yield* new EntityNotFound({
									reason: { code: "entity-not-found", entityId: input.entityId },
								});
							}
							const result = yield* Schema.decodeEffect(EntitySnapshotResult)({ entity });
							yield* keys.recordImportItem(input.lifecycle, input.userId, "unchanged");
							return { result, dispatch: [], _tag: "Committed" as const };
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
								.pipe(Effect.mapError(writeFailure))
						: verified;
				const { pinned: pinnedDeclaration, active: activeDeclaration } =
					yield* writeChecks.resolvePinnedDeclaration("entity", pin, owner, draft.entitySchemaSlug);
				if (pin && !activeDeclaration) {
					return yield* bad(
						"mutation-conflict",
						"Pinned entity declaration has no active storage definition",
					);
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
						.pipe(Effect.mapError((error) => bad("mutation-conflict", error.message)));
					if (provider.ownerId !== scopeUserId) {
						return yield* new EntityBadRequest({ reason: { code: "provider-scope-mismatch" } });
					}
				}
				if (pin && !pinnedDeclaration) {
					return yield* bad(
						"mutation-conflict",
						"Entity schema is not declared by the pinned writer",
					);
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
						(reason) =>
							bad(
								"mutation-conflict",
								reason === "invalid"
									? "Pinned entity payload violates active storage constraints"
									: "Active entity constraints would change the pinned payload",
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
					Effect.mapError(() =>
						bad("mutation-conflict", "Current entity cannot be processed by the pinned writer"),
					),
				);
				if (!same(parsed.draft.properties, entity.properties)) {
					return yield* bad(
						"mutation-conflict",
						"Pinned entity constraints would change the current stored value",
					);
				}
				return yield* Effect.void;
			});
			const planMutationInTransaction = Effect.fnUntraced(function* (
				input: Omit<PreparedMutation, "requestId">,
			) {
				yield* writeChecks
					.check(
						input.lifecycle,
						definitionOwner(input.entitySchemaPluginId),
						input.scopeUserId,
						true,
					)
					.pipe(Effect.mapError(writeFailure));
				const lifecycle = yield* Schema.decodeEffect(DomainLifecycleCommand)(input.lifecycle).pipe(
					Effect.mapError(() => bad("mutation-conflict", "Invalid lifecycle command")),
				);
				let request: AutomationEntityRequestPayload;
				if (input.operation === "create") {
					request = {
						resource: "entity",
						draft: input.draft,
						operation: "create",
						category: "request",
					};
				} else {
					if (input.before === null) {
						return yield* bad(
							"mutation-conflict",
							"Mutation requires the persisted entity snapshot",
						);
					}
					if (input.operation === "update") {
						request = {
							resource: "entity",
							draft: input.draft,
							category: "request",
							operation: "update",
							before: input.before,
						};
					} else {
						request = {
							resource: "entity",
							operation: "delete",
							draft: input.before,
							category: "request",
						};
					}
				}
				const planned = yield* planner.plan({
					trigger: yield* lifecycleTrigger(lifecycle, input.scopeUserId, request),
				});
				if (planned.trigger?.blockedReason) {
					return { _tag: "Blocked" as const };
				}
				const pending: PendingEntityMutation = {
					...input,
					request,
					lifecycle,
					policies: planned.policies,
					requestId: planned.trigger?.id ?? null,
				};
				return pending;
			});
			const planMutation = (input: Parameters<typeof planMutationInTransaction>[0]) =>
				transaction(
					planMutationInTransaction(input),
					mutationUserIds(input.lifecycle, input.scopeUserId),
				).pipe(
					Effect.filterOrFail(
						(planned): planned is PendingEntityMutation => "request" in planned,
						() => bad("automation-limit", "Entity request exceeds automation limits"),
					),
				);
			const applyMutationPolicies = Effect.fn("EntitiesService.applyMutationPolicies")(function* (
				pending: PendingEntityMutation,
			) {
				let payload = pending.request;
				const acceptedPatches: AutomationPolicyPatch[] = [];
				const executePolicies = Effect.fnUntraced(function* () {
					for (const policy of pending.policies) {
						const output = yield* execution
							.executePolicy({ runId: policy.runId, acceptedPatches: [...acceptedPatches] })
							.pipe(
								Effect.catchTag("AutomationPolicyExecutionError", (error) =>
									Effect.fail(
										new EntityBadRequest({
											reason: { runId: error.runId, code: "policy-execution-failed" },
										}),
									),
								),
							);
						if (output.action === "reject") {
							return yield* bad("policy-rejected", output.reason);
						}
						if (output.action === "transform") {
							const patched = applyLifecyclePolicyPatch(payload, output.patch);
							if (!patched.ok || patched.request.operation === "delete") {
								return yield* bad(
									"invalid-policy-transform",
									patched.ok ? "Entity delete policies cannot transform requests" : patched.reason,
								);
							}
							const validated = yield* validateDraft(
								patched.request.draft,
								pending.scopeUserId,
								definitionOwner(pending.entitySchemaPluginId),
								pending.lifecycle,
							);
							const successor = { ...patched.request, draft: validated.draft };
							const acceptedPatch = canonicalLifecyclePolicyPatch(payload, successor);
							payload = successor;
							if (acceptedPatch) {
								acceptedPatches.push(acceptedPatch);
							}
						}
					}
					return undefined;
				});
				yield* executePolicies().pipe(
					Effect.catchCause((cause) =>
						pending.requestId === null
							? Effect.failCause(cause)
							: execution
									.skipQueuedPolicies({ triggerId: pending.requestId })
									.pipe(Effect.andThen(Effect.failCause(cause)), Effect.uninterruptible),
					),
				);
				return { ...pending, request: payload } satisfies PendingEntityMutation;
			});
			const acceptedMutation = Effect.fnUntraced(function* (pending: PendingEntityMutation) {
				const final = yield* validateDraft(
					pending.request.operation === "delete"
						? draftOf(pending.request.draft)
						: pending.request.draft,
					pending.scopeUserId,
					definitionOwner(pending.entitySchemaPluginId),
					pending.lifecycle,
				);
				if (
					final.entitySchemaPluginId !== pending.entitySchemaPluginId ||
					!same(final.entitySchemaFingerprint, pending.entitySchemaFingerprint)
				) {
					return yield* bad(
						"mutation-conflict",
						"Entity schema ownership changed while policies ran",
					);
				}
				const { request: _request, policies: _policies, ...prepared } = pending;
				return { ...prepared, draft: final.draft } satisfies PreparedMutation;
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
						.pipe(Effect.asVoid, Effect.mapError(writeFailure)),
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
				writeChecks.checkMany(checks).pipe(Effect.mapError(writeFailure));

			const entityBatchPlans = Effect.fnUntraced(function* (batch: EntityUpsertBatchScope) {
				const pin = batch.command.writeContext?.pluginRevision;
				yield* writeChecks
					.check(
						batch.command,
						definitionOwner(pin?.id ?? null),
						pin?.scope === "user" ? pin.ownerId : null,
						true,
					)
					.pipe(Effect.mapError(writeFailure));
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
			const persistAndBatch = Effect.fnUntraced(function* (pending: PendingEntityMutation) {
				const prepared = yield* acceptedMutation(pending);
				const batchScope = { identity: ["batch"], command: prepared.lifecycle };
				const decision = yield* planner.prepareBatch({
					...batchScope,
					resource: "entity",
					scopes: [prepared.scopeUserId],
				});
				const saved = yield* persistSnapshots.persistSave(prepared, { ...decision, index: 0 });
				const batch = yield* entityBatchPlans(batchScope);
				return {
					...saved,
					_tag: "Committed",
					dispatch: [...saved.dispatch, ...batch],
				} satisfies LifecycleCommittedStep<EntitySnapshotResult>;
			});
			const commitMutation = Effect.fn("EntitiesService.commitMutation")(
				(pending: PendingEntityMutation) =>
					transaction(
						persistAndBatch(pending),
						mutationUserIds(pending.lifecycle, pending.scopeUserId),
					),
			);
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
			const persistCheckedUpdate = Effect.fnUntraced(function* (
				pending: PendingEntityMutation,
				requireUserOwned: boolean,
			) {
				const prepared = yield* acceptedMutation(pending);
				if (requireUserOwned) {
					yield* assertUserEditable(prepared);
				}
				yield* assertImmutablePropertiesKept(prepared);
				return yield* persistAndBatch(pending);
			});
			const saveInline = <E, R>(
				step: Effect.Effect<
					LifecyclePreparedStep<EntitySnapshotResult, PendingEntityMutation>,
					E,
					R
				>,
				commit: typeof commitMutation = commitMutation,
			) =>
				runLifecycleWriteInline(execution, {
					commit,
					prepare: step,
					applyPolicies: applyMutationPolicies,
				}).pipe(Effect.map(({ result, warnings }) => ({ ...result, warnings })));
			const planCreate = Effect.fnUntraced(function* (
				input: CreateEntityInput,
				updateExisting?: boolean,
				deferPlanning?: boolean,
			) {
				if (
					input.scope === "user" &&
					(input.externalId !== undefined) !== (input.providerId !== undefined)
				) {
					return yield* new EntityBadRequest({
						reason: { code: "incomplete-provenance", fields: ["externalId", "providerId"] },
					});
				}
				const scopeUserId = input.scope === "user" ? input.userId : null;
				const validated = yield* validateDraft(
					{
						name: input.name,
						properties: input.properties,
						externalId: input.externalId ?? null,
						providerId: input.providerId ?? null,
						entitySchemaSlug: input.entitySchema.slug,
						populatedAt: input.populatedAt?.toISOString() ?? null,
					},
					scopeUserId,
					input.entitySchema.owner,
					input.lifecycle,
				);
				const { externalId, providerId } = input;
				const existing =
					externalId !== undefined && providerId !== undefined
						? yield* transaction(
								Effect.gen(function* () {
									const identity = {
										...input,
										externalId,
										providerId,
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
				if (
					existing &&
					!replay &&
					(updateExisting === undefined || (!updateExisting && existing.populatedAt !== null))
				) {
					return { existing, pending: null, preparedInput: null };
				}
				const preparedInput = {
					...validated,
					scopeUserId,
					lifecycle: input.lifecycle,
					entityId: existing?.id ?? commandEntityId(input.lifecycle),
					before: existing && !replay ? yield* snapshot(existing) : null,
					operation: existing && !replay ? ("update" as const) : ("create" as const),
				};
				return {
					preparedInput,
					existing: null,
					pending: deferPlanning ? null : yield* planMutation(preparedInput),
				};
			});
			const prepareCreateStep = Effect.fn("EntitiesService.prepareCreateStep")(function* (
				input: CreateEntityInput,
				updateExisting?: boolean,
			) {
				yield* assertOwner;
				yield* writeChecks
					.check(
						input.lifecycle,
						input.entitySchema.owner,
						input.scope === "user" ? input.userId : null,
					)
					.pipe(Effect.mapError(writeFailure));
				const planned = yield* planCreate(input, updateExisting, true);
				if (planned.existing) {
					const before = yield* snapshot(planned.existing);
					const result = { entity: planned.existing };
					return yield* transaction(
						Effect.gen(function* () {
							const current = yield* repository.getMutationEntity(planned.existing.id, true);
							if (!current || !same(yield* snapshot(current.entity), before)) {
								return yield* bad("mutation-conflict", "Entity changed before no-op was recorded");
							}
							const batchScope = { identity: ["batch"], command: input.lifecycle };
							yield* planner.prepareBatch({
								...batchScope,
								resource: "entity",
								scopes: [input.scope === "user" ? input.userId : null],
							});
							yield* keys.recordImportItem(
								input.lifecycle,
								input.scope === "user" ? input.userId : null,
								"unchanged",
							);
							yield* planner.planBatch({ ...batchScope, resource: "entity" });
							return { result, dispatch: [], _tag: "Committed" as const };
						}),
						mutationUserIds(input.lifecycle, input.scope === "user" ? input.userId : null),
					);
				}
				return yield* transaction(
					Effect.gen(function* () {
						const pending = yield* planMutationInTransaction(planned.preparedInput);
						if (!("request" in pending)) {
							return pending;
						}
						return pending.policies.length > 0
							? { pending, _tag: "PoliciesRequired" as const }
							: yield* persistAndBatch(pending);
					}),
					mutationUserIds(input.lifecycle, input.scope === "user" ? input.userId : null),
				).pipe(
					Effect.filterOrFail(
						(step) => step._tag !== "Blocked",
						() => bad("automation-limit", "Entity request exceeds automation limits"),
					),
				);
			});
			const saveCreate = (input: CreateEntityInput, updateExisting?: boolean) =>
				saveInline(prepareCreateStep(input, updateExisting));
			const create = Effect.fn("EntitiesService.create")(function* (input: CreateEntityInput) {
				const { entity, warnings } = yield* saveCreate(input);
				return { entity, warnings };
			});
			const createFromApi = Effect.fn("EntitiesService.createFromApi")(function* (
				input: CreateEntityInput,
			) {
				if (input.providerId !== undefined) {
					return yield* new EntityBadRequest({ reason: { code: "provider-owned" } });
				}
				if (input.entitySchema.owner.kind === "kernel") {
					return yield* new EntityBadRequest({ reason: { code: "kernel-owned-schema" } });
				}
				return yield* create(input);
			});
			const createGlobal = Effect.fn("EntitiesService.createGlobal")(function* (
				input: Omit<CreateEntityInput, "scope" | "userId">,
			) {
				return yield* create({ ...input, scope: "global" });
			});
			const upsert = Effect.fn("EntitiesService.upsert")(function* (input: UpsertEntityInput) {
				const { entity, warnings } = yield* saveCreate(input, input.updateExisting);
				return { entity, warnings };
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
							Effect.mapBoth({
								onSuccess: (lifecycle) => ({ ...entry, lifecycle }),
								onFailure: () => bad("mutation-conflict", "Invalid lifecycle command"),
							}),
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
						requestId: null,
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
			const update = Effect.fn("EntitiesService.update")(function* (input: UpdateEntityInput) {
				yield* assertOwner;
				const ownedCurrent = yield* repository.getMutationEntity(input.entityId);
				if (
					input.requireUserOwned &&
					(input.scope !== "user" ||
						(ownedCurrent &&
							(ownedCurrent.userId !== input.userId || ownedCurrent.entity.providerId !== null)))
				) {
					return yield* new EntityNotFound({
						reason: { code: "entity-not-found", entityId: input.entityId },
					});
				}
				if (ownedCurrent) {
					yield* writeChecks
						.check(
							input.lifecycle,
							definitionOwner(ownedCurrent.entity.entitySchemaPluginId),
							ownedCurrent.userId,
						)
						.pipe(Effect.mapError(writeFailure));
				}
				const current = yield* repository.getMutationEntity(input.entityId);
				if (
					!current ||
					(input.scope === "global"
						? current.userId !== null
						: current.userId !== input.userId &&
							(input.requireUserOwned || current.userId !== null)) ||
					(input.requireUserOwned && current.entity.providerId !== null)
				) {
					return yield* new EntityNotFound({
						reason: { code: "entity-not-found", entityId: input.entityId },
					});
				}
				const before = yield* snapshot(current.entity);
				if (
					input.expected &&
					!same(input.expected, {
						name: before.name,
						updatedAt: before.updatedAt,
						properties: before.properties,
					})
				) {
					return yield* new EntityStale({
						reason: { code: "entity-stale", entityId: input.entityId },
					});
				}
				yield* validateExistingEntity(current.entity, current.userId, input.lifecycle);
				const validated = yield* validateDraft(
					{
						...draftOf(before),
						name: input.name,
						properties: input.properties,
						populatedAt:
							input.populatedAt === undefined
								? before.populatedAt
								: (input.populatedAt?.toISOString() ?? null),
					},
					current.userId,
					definitionOwner(current.entity.entitySchemaPluginId),
					input.lifecycle,
				);
				const pendingInput = {
					...validated,
					before,
					entityId: input.entityId,
					lifecycle: input.lifecycle,
					scopeUserId: current.userId,
					operation: "update" as const,
				};
				const { entity, warnings } = yield* saveInline(
					transaction(
						Effect.gen(function* () {
							const pending = yield* planMutationInTransaction(pendingInput);
							if (!("request" in pending)) {
								return pending;
							}
							return pending.policies.length > 0
								? { pending, _tag: "PoliciesRequired" as const }
								: yield* persistCheckedUpdate(pending, input.requireUserOwned === true);
						}),
						mutationUserIds(input.lifecycle, current.userId),
					).pipe(
						Effect.filterOrFail(
							(step) => step._tag !== "Blocked",
							() => bad("automation-limit", "Entity request exceeds automation limits"),
						),
					),
					(pending) =>
						transaction(
							persistCheckedUpdate(pending, input.requireUserOwned === true),
							mutationUserIds(pending.lifecycle, pending.scopeUserId),
						),
				);
				return { entity, warnings };
			});
			const prepareUserSave = Effect.fn("EntitiesService.prepareUserSave")(function* (
				input: PrepareUserEntitySaveInput,
			) {
				yield* assertOwner;
				const { userId, lifecycle, entitySchema: reference } = input;
				let pendingInput: Parameters<typeof planMutation>[0];
				if (input.target.kind === "create") {
					const validated = yield* validateDraft(
						{
							providerId: null,
							externalId: null,
							name: input.name,
							populatedAt: null,
							properties: input.properties,
							entitySchemaSlug: reference.slug,
						},
						userId,
						reference.owner,
						lifecycle,
					);
					pendingInput = {
						...validated,
						lifecycle,
						before: null,
						scopeUserId: userId,
						operation: "create",
						entityId: commandEntityId(lifecycle),
					};
				} else {
					const { entityId, expected } = input.target;
					const current = yield* repository.getMutationEntity(entityId);
					if (
						!current ||
						current.userId !== userId ||
						current.entity.providerId !== null ||
						current.entity.entitySchemaSlug !== reference.slug ||
						(current.entity.entitySchemaPluginId ?? null) !==
							definitionOwnerPluginId(reference.owner)
					) {
						return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
					}
					yield* writeChecks
						.check(lifecycle, definitionOwner(current.entity.entitySchemaPluginId), current.userId)
						.pipe(Effect.mapError(writeFailure));
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
						{ ...draftOf(before), name: input.name, properties: input.properties },
						current.userId,
						definitionOwner(current.entity.entitySchemaPluginId),
						lifecycle,
					);
					pendingInput = {
						...validated,
						before,
						entityId,
						lifecycle,
						scopeUserId: userId,
						operation: "update",
					};
				}
				const prepared = yield* acceptedMutation(
					yield* applyMutationPolicies(yield* planMutation(pendingInput)),
				);
				return Object.freeze({
					entityId: prepared.entityId,
					[preparedUserEntitySave]: prepared,
					created:
						prepared.operation === "create"
							? makePreparedEntityCreate({
									userId,
									entityId: prepared.entityId,
									entitySchemaSlug: prepared.draft.entitySchemaSlug,
									entitySchemaPluginId: prepared.entitySchemaPluginId,
								})
							: null,
				});
			});
			const persistPreparedUserSave = Effect.fn("EntitiesService.persistPreparedUserSave")(
				function* (saved: PreparedUserEntitySave) {
					yield* assertActiveTransaction;
					const prepared = saved[preparedUserEntitySave];
					yield* assertUserEditable(prepared);
					yield* assertImmutablePropertiesKept(prepared);
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
				},
			);
			const deleteByIds = Effect.fn("EntitiesService.deleteByIds")(
				function* (
					ids: readonly [EntityId, ...EntityId[]],
					lifecycle: DomainLifecycleCommand,
					target?: {
						readonly userId: UserId;
						readonly preserveHistory?: boolean;
						readonly entitySchema: EntitySchemaReference;
					},
				) {
					yield* assertOwner;
					const orderedIds = [...new Set(ids)].sort();
					const matchesTarget = (
						current: NonNullable<Effect.Success<ReturnType<typeof repository.getMutationEntity>>>,
					) =>
						!target ||
						(current.userId === target.userId &&
							current.entity.entitySchemaSlug === target.entitySchema.slug &&
							current.entity.entitySchemaPluginId ===
								definitionOwnerPluginId(target.entitySchema.owner));
					for (const entityId of orderedIds) {
						const current = yield* repository.getMutationEntity(entityId);
						if (current) {
							if (!matchesTarget(current)) {
								return yield* new EntityNotFound({
									reason: { entityId, code: "entity-not-found" },
								});
							}
							yield* writeChecks
								.check(
									lifecycle,
									definitionOwner(current.entity.entitySchemaPluginId),
									current.userId,
								)
								.pipe(Effect.mapError(writeFailure));
						}
					}
					const eventIdentities =
						yield* eventsRepository.listEventIdentitiesForEntities(orderedIds);
					if (target?.preserveHistory === true && eventIdentities.length > 0) {
						return yield* new EntityBadRequest({ reason: { code: "entity-has-history" } });
					}
					const preparedEvents: PreparedEventDelete[] = [];
					const accounts = new Map<
						UserId,
						Effect.Success<ReturnType<typeof admission.currentAccount>>
					>();
					if (lifecycle.accountUserId !== null) {
						accounts.set(lifecycle.accountUserId, lifecycle.accountUserId);
					}
					for (const identity of eventIdentities) {
						let account = accounts.get(identity.userId);
						if (account === undefined) {
							account = yield* admission.currentAccount(identity.userId);
							accounts.set(identity.userId, account);
						}
						const eventCommand = itemCommand(
							{ ...lifecycle, accountUserId: account },
							`${identity.userId}:${identity.eventId}:cascade-delete`,
						);
						const preparedEvent = yield* events.prepareEntityCascadeDelete(
							identity,
							orderedIds,
							eventCommand,
						);
						if (!preparedEvent) {
							return yield* cascadeEventChanged();
						}
						preparedEvents.push(preparedEvent);
					}
					const prepared = yield* Effect.forEach(orderedIds, (entityId) =>
						Effect.gen(function* () {
							const command = itemCommand(lifecycle, entityId);
							const current = yield* repository.getMutationEntity(entityId);
							if (!current) {
								return null;
							}
							if (!matchesTarget(current)) {
								return yield* new EntityNotFound({
									reason: { entityId, code: "entity-not-found" },
								});
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
								.check(
									command,
									definitionOwner(current.entity.entitySchemaPluginId),
									current.userId,
								)
								.pipe(Effect.mapError(writeFailure));
							const pending = yield* planMutation({
								before,
								entityId,
								lifecycle: command,
								operation: "delete",
								draft: validated.draft,
								scopeUserId: current.userId,
								entitySchemaPluginId: validated.entitySchemaPluginId,
								entitySchemaFingerprint: validated.entitySchemaFingerprint,
							});
							return {
								scopeUserId: current.userId,
								prepared: yield* acceptedMutation(yield* applyMutationPolicies(pending)),
							};
						}),
					);
					const committed = yield* eventTransaction(
						Effect.gen(function* () {
							const writeContext = lifecycle.writeContext;
							let scopeUserId: null | UserId = null;
							if (writeContext?.pluginRevision?.scope === "user") {
								scopeUserId = writeContext.pluginRevision.ownerId;
							}
							const settled = prepared.filter((item) => item !== null);
							const pending = settled.map((item, index) => ({ index, input: item.prepared }));
							const pins = yield* verifyWrites([
								{ scopeUserId, command: lifecycle, owner: principalOwner(lifecycle.writeContext) },
								...pending.map(({ input }) => preparedWriteCheck(input)),
							]);
							yield* events.captureEventGroups({ items: preparedEvents, entityIds: orderedIds });
							yield* repository.lockMutationKeys(orderedIds);
							const rows = yield* repository.getMutationEntities(orderedIds, true);
							const currentEventIdentities =
								yield* eventsRepository.listEventIdentitiesForEntities(orderedIds);
							if (!same(eventIdentities, currentEventIdentities)) {
								return yield* new DbError({
									message: "Entity event references changed while deletion policies ran",
								});
							}
							const eventBatchScope = { command: lifecycle, identity: ["cascade-events"] };
							const eventDecision = yield* planner.prepareBatch({
								...eventBatchScope,
								resource: "event",
								scopes: [...new Set(eventIdentities.map(({ userId }) => userId))],
							});
							const batchScope = { command: lifecycle, identity: ["deletes"] };
							const decision = yield* planner.prepareBatch({
								...batchScope,
								resource: "entity",
								scopes: settled.map((item) => item.scopeUserId),
							});
							const eventSaved = yield* Effect.forEach(preparedEvents.entries(), ([index, item]) =>
								events.persistPreparedDelete(item, {
									...eventDecision,
									index,
									command: lifecycle,
									identity: eventBatchScope.identity,
								}),
							);
							const eventBatch = yield* planner.planBatch({
								...eventBatchScope,
								resource: "event",
							});
							const persisted = pending.map(({ index, input }) => ({
								input,
								batchIndex: index,
								pin: pins(preparedWriteCheck(input)),
							}));
							yield* attachments.removeEntities(persisted.map(({ input }) => input.entityId));
							const written = yield* persistDeletes.persistMany(persisted, decision, rows);
							const batch = yield* entityBatchPlans(batchScope);
							const dispatch = [
								...eventSaved.flatMap((item) => item.dispatch),
								...eventBatch,
								...written.results.flatMap((item) => item.dispatch),
								...batch,
							];
							return { dispatch, deletedCount: written.results.length };
						}),
						[
							...mutationUserIds(lifecycle, null),
							...prepared.flatMap((item) =>
								item === null ? [] : mutationUserIds(lifecycle, item.scopeUserId),
							),
						],
						[...accounts.values()],
					);
					const warnings = yield* execution.dispatch(committed.dispatch);
					return { warnings, deletedCount: committed.deletedCount };
				},
				(effect) =>
					effect.pipe(
						Effect.catchTags({
							EventBadRequest: Effect.die,
							LifecyclePersistenceError: Effect.die,
							EventStale: () => Effect.fail(cascadeEventChanged()),
						}),
					),
			);
			const commitUserEntities = Effect.fn("EntitiesService.commitUserEntities")(function* (
				userId: UserId,
				items: ReadonlyArray<EnsureUserEntityItem>,
				lifecycle: DomainLifecycleCommand,
			) {
				yield* assertOwner;
				yield* writeChecks
					.check(lifecycle, principalOwner(lifecycle.writeContext), userId)
					.pipe(Effect.mapError(writeFailure));
				for (const item of items) {
					yield* writeChecks
						.check(lifecycle, item.entitySchema.owner, userId)
						.pipe(Effect.mapError(writeFailure));
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
				const prepared = yield* Effect.forEach(entries, ({ item, command }) =>
					Effect.gen(function* () {
						const existing = yield* repository.findUserEntityWithoutProvenance({
							userId,
							entitySchemaSlug: item.entitySchema.slug,
							entitySchemaPluginId: definitionOwnerPluginId(item.entitySchema.owner),
						});
						if (existing) {
							return { item, existing, prepared: null };
						}
						const planned = yield* planCreate({
							...item,
							userId,
							scope: "user",
							lifecycle: command,
						});
						return {
							item,
							existing,
							prepared: planned.pending
								? yield* acceptedMutation(yield* applyMutationPolicies(planned.pending))
								: null,
						};
					}),
				);
				const committed = yield* transaction(
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
								return yield* bad(
									"mutation-conflict",
									"Ensured entity disappeared while policies ran",
								);
							}
							persisted.push({
								input: entry.prepared,
								batchIndex: entry.index,
								pin: pins(preparedWriteCheck(entry.prepared)),
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
				);
				return committed;
			});
			const ensureUserEntities = Effect.fn("EntitiesService.ensureUserEntities")(function* (
				userId: UserId,
				items: ReadonlyArray<EnsureUserEntityItem>,
				lifecycle: DomainLifecycleCommand,
			) {
				const committed = yield* commitUserEntities(userId, items, lifecycle);
				return yield* Effect.forEach(committed, (item) =>
					Effect.gen(function* () {
						return {
							entityId: item.entityId,
							wasInserted: item.wasInserted,
							warnings: item.dispatch.length
								? yield* execution
										.dispatch(item.dispatch)
										.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die))
								: [],
						};
					}),
				);
			});
			const commitGlobalEntities = Effect.fnUntraced(function* (
				planned: PendingGlobalEntityUpsert["planned"],
				providerId: SandboxProviderId,
				lifecycle: DomainLifecycleCommand,
				options?: UpsertGlobalEntitiesOptions,
			) {
				const scopeOf = (item: PendingGlobalEntityUpsert["planned"][number]) => ({
					providerId,
					entitySchemaSlug: item.entitySchemaSlug,
					entitySchemaPluginId: item.entitySchemaPluginId,
				});
				const identityOf = (item: PendingGlobalEntityUpsert["planned"][number]) => ({
					providerId,
					scope: "global" as const,
					externalId: item.externalId,
					entitySchemaSlug: item.entitySchemaSlug,
					entitySchemaPluginId: item.entitySchemaPluginId,
				});
				return yield* transaction(
					Effect.gen(function* () {
						const pins = yield* verifyWrites(
							planned.map((item) => ({
								scopeUserId: null,
								command: lifecycle,
								owner: definitionOwner(item.entitySchemaPluginId),
							})),
						);
						const batchScope = { command: lifecycle, identity: ["global-upsert"] };
						const decision = yield* planner.prepareBatch({
							...batchScope,
							scopes: [null],
							resource: "entity",
						});
						const representatives = yield* batchRepresentatives(
							planned,
							(item) => providerEntityMutationLockKey(identityOf(item)),
							(item) => ({ externalId: item.externalId, draft: item.prepared?.draft ?? null }),
						);
						const unique = planned.flatMap((item, index) =>
							representatives[index] === index ? [{ ...item, index }] : [],
						);
						const settled = new Map<
							number,
							GlobalEntityUpsertResults[number] & { dispatch: ReadonlyArray<LifecycleDispatchPlan> }
						>();
						const pending = unique;
						yield* repository.lockProviderEntityMutations(pending.map(identityOf));
						yield* repository.lockGlobalEntityProvenanceScopes(planned.map(scopeOf));
						const found = yield* repository.findEntitiesByExternalIds(pending.map(identityOf));
						const existingIdOf = (item: (typeof pending)[number]) =>
							found.get(providerEntityMutationLockKey(identityOf(item)))?.id ?? null;
						const entityIds = pending.flatMap((item) => {
							const id = existingIdOf(item) ?? item.prepared?.entityId;
							return id ? [id] : [];
						});
						yield* repository.lockMutationKeys(entityIds);
						const rows = yield* repository.getMutationEntities(entityIds, true);
						const creating = pending.filter((item) => existingIdOf(item) === null);
						const totals =
							options?.maximumTotal === undefined
								? new Map<string, number>()
								: yield* repository.countGlobalEntitiesByProvenanceScopes(creating.map(scopeOf));
						const ordinals = new Map<string, number>();
						const persisted: PersistItem[] = [];
						for (const item of pending) {
							const existingId = existingIdOf(item);
							if (existingId !== null) {
								settled.set(item.index, {
									dispatch: [],
									wasInserted: false,
									status: "upserted",
									entityId: existingId,
								});
								continue;
							}
							if (options?.maximumTotal !== undefined) {
								const scope = provenanceScopeKey(scopeOf(item));
								const ordinal = ordinals.get(scope) ?? 0;
								ordinals.set(scope, ordinal + 1);
								if ((totals.get(scope) ?? 0) + ordinal >= options.maximumTotal) {
									settled.set(item.index, { dispatch: [], status: "skipped" });
									continue;
								}
							}
							if (!item.prepared) {
								return yield* bad(
									"mutation-conflict",
									"Provider entity disappeared while policies ran",
								);
							}
							persisted.push({
								input: item.prepared,
								batchIndex: item.index,
								pin: pins(preparedWriteCheck(item.prepared)),
							});
						}
						const written = yield* persistEnsures.persistMany(persisted, decision, rows);
						for (const [position, { batchIndex }] of persisted.entries()) {
							const work = written.results[position];
							if (!work) {
								return yield* Effect.die("Global entity upsert is missing its result");
							}
							settled.set(batchIndex, {
								status: "upserted",
								dispatch: work.dispatch,
								entityId: work.result.entityId,
								wasInserted: work.result.wasInserted,
							});
						}
						const items = yield* Effect.forEach(representatives, (representative, index) => {
							const item = settled.get(representative);
							if (!item) {
								return Effect.die("Global entity upsert is missing its result");
							}
							return Effect.succeed({
								...item,
								dispatch: representative === index ? item.dispatch : [],
							});
						});
						const batch = yield* entityBatchPlans(batchScope);
						const dispatch = [...items.flatMap((item) => item.dispatch), ...batch];
						const result = items.map((item) =>
							item.status === "skipped"
								? { status: item.status }
								: { status: item.status, entityId: item.entityId, wasInserted: item.wasInserted },
						);
						return {
							result,
							dispatch,
							_tag: "Committed" as const,
						} satisfies LifecycleCommittedStep<GlobalEntityUpsertResults>;
					}),
					mutationUserIds(lifecycle, null),
				);
			});
			const prepareUpsertGlobalEntitiesStep = Effect.fn(
				"EntitiesService.prepareUpsertGlobalEntitiesStep",
			)(function* (
				items: ReadonlyArray<UpsertGlobalEntityItem>,
				providerId: SandboxProviderId,
				lifecycle: DomainLifecycleCommand,
				options: undefined | UpsertGlobalEntitiesOptions,
				cursor: GlobalEntityUpsertCursor,
			) {
				yield* assertOwner;
				yield* writeChecks
					.check(lifecycle, principalOwner(lifecycle.writeContext), null)
					.pipe(Effect.mapError(writeFailure));
				for (const item of items) {
					yield* writeChecks
						.check(lifecycle, item.entitySchema.owner, null)
						.pipe(Effect.mapError(writeFailure));
				}
				if (
					options?.maximumTotal !== undefined &&
					(!Number.isInteger(options.maximumTotal) || options.maximumTotal < 0)
				) {
					return yield* new EntityBadRequest({
						reason: { field: "maximumTotal", code: "invalid-maximum-total" },
					});
				}
				const entries = items.map((item) => {
					const command = itemCommand(
						lifecycle,
						stableStringify([item.entitySchema, providerId, item.externalId]),
					);
					return { item, command };
				});
				yield* batchRepresentatives(
					entries,
					({ item }) =>
						providerEntityMutationLockKey({
							providerId,
							scope: "global",
							externalId: item.externalId,
							entitySchemaSlug: item.entitySchema.slug,
							entitySchemaPluginId: definitionOwnerPluginId(item.entitySchema.owner),
						}),
					({ item }) => ({ ...item, name: item.name.trim() }),
				);
				const planned = [...cursor.planned];
				let accepted = cursor.accepted;
				for (let index = planned.length; index < items.length; index += 1) {
					const entry = entries[index];
					if (!entry) {
						return yield* Effect.die("Global entity upsert cursor is out of range");
					}
					const { item, command } = entry;
					let pending = accepted;
					accepted = null;
					if (!pending) {
						const result = yield* planCreate({
							...item,
							providerId,
							scope: "global",
							lifecycle: command,
						});
						if (result.pending?.policies.length) {
							return {
								_tag: "PoliciesRequired",
								pending: { planned, pending: result.pending },
							} satisfies LifecyclePreparedStep<
								GlobalEntityUpsertResults,
								PendingGlobalEntityUpsert
							>;
						}
						pending = result.pending;
					}
					const prepared = pending ? yield* acceptedMutation(pending) : null;
					const definition = yield* entitySchema(null, item.entitySchema);
					planned.push({
						prepared,
						externalId: item.externalId,
						entitySchemaSlug: item.entitySchema.slug,
						entitySchemaPluginId: definition.pluginId ?? null,
					});
				}
				return yield* commitGlobalEntities(planned, providerId, lifecycle, options);
			});
			const applyGlobalEntityPolicies = (cursor: PendingGlobalEntityUpsert) =>
				applyMutationPolicies(cursor.pending).pipe(
					Effect.map((pending) => ({ ...cursor, pending })),
				);
			const upsertGlobalEntities = Effect.fn("EntitiesService.upsertGlobalEntities")(function* (
				items: ReadonlyArray<UpsertGlobalEntityItem>,
				providerId: SandboxProviderId,
				lifecycle: DomainLifecycleCommand,
				options?: UpsertGlobalEntitiesOptions,
			) {
				const prepare = (cursor: GlobalEntityUpsertCursor) =>
					prepareUpsertGlobalEntitiesStep(items, providerId, lifecycle, options, cursor);
				const { result, warnings } = yield* runLifecycleWriteInline(execution, {
					applyPolicies: applyGlobalEntityPolicies,
					prepare: prepare({ planned: [], accepted: null }),
					commit: (cursor) => prepare({ planned: cursor.planned, accepted: cursor.pending }),
				});
				return { warnings, results: result };
			});
			const getByIdAnyScope = Effect.fn("EntitiesService.getByIdAnyScope")(function* (
				entityId: EntityId,
			) {
				const entity = yield* repository.getById(entityId);
				if (!entity) {
					return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
				}
				return entity;
			});
			return {
				create,
				upsert,
				update,
				deleteByIds,
				createGlobal,
				createFromApi,
				commitMutation,
				prepareUserSave,
				getByIdAnyScope,
				prepareCreateStep,
				commitUserEntities,
				ensureUserEntities,
				prepareReferenceStep,
				upsertGlobalEntities,
				applyMutationPolicies,
				persistPreparedUserSave,
				applyGlobalEntityPolicies,
				persistPlannedProviderUpsert,
				persistPlannedProviderUpserts,
				prepareUpsertGlobalEntitiesStep,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
	static readonly layerRuntime = Layer.effect(this, this.make);
	static readonly layerMigration = Layer.effect(this, this.make);
}
