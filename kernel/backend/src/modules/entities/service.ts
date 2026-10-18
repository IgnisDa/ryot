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
	LifecycleDispatchPlan,
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
import { EventsRepository } from "#modules/events/repository";
import { EventsService, type PreparedEventDelete } from "#modules/events/service";
import {
	MutationReceiptIdentity,
	mutationReceiptIdentity,
	MutationReceiptIdentityConflict,
	mutationReceiptOwner,
	MutationReceipts,
} from "#modules/mutations/receipts";
import { catalogDefinitionFingerprint } from "#modules/plugins/catalog/runtime-resolver";
import { principalOwner } from "#modules/scripts/authorization/principal";
import { DatabaseSession, DatabaseSessionStateError } from "#platform/db/session";
import { runRootTransaction } from "#platform/db/transaction";
import { trimToNull } from "#platform/validation";

import { EntityDeleteResult, EntityEnsureResult, EntitySnapshotResult } from "./mutation-outcomes";
import {
	draftOf,
	makePersistMutation,
	makeReceiptBatches,
	type MutationReceiptRecord,
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

type Scope = { scope: "global" } | { scope: "user"; userId: UserId };
export type CreateEntityInput = Scope & {
	name: string;
	entitySchema: EntitySchemaReference;
	properties: unknown;
	externalId?: string | undefined;
	populatedAt?: Date | null;
	lifecycle: DomainLifecycleCommand;
	providerId?: SandboxProviderId | undefined;
};
export type UpdateEntityInput = Scope & {
	name: string;
	entityId: EntityId;
	properties: unknown;
	populatedAt?: Date | null;
	requireUserOwned?: boolean;
	lifecycle: DomainLifecycleCommand;
	expected?: Pick<EntitySnapshotResult["entity"], "name" | "properties" | "updatedAt">;
};
export type UpsertEntityInput = CreateEntityInput & {
	externalId: string;
	updateExisting: boolean;
	populatedAt: Date | null;
	preservePopulatedAt?: boolean;
	providerId: SandboxProviderId;
};
export type UpsertGlobalEntityItem = {
	entitySchema: EntitySchemaReference;
	name: string;
	externalId: string;
	properties: unknown;
	populatedAt: Date | null;
};
export type UpsertGlobalEntitiesOptions = { maximumTotal?: number };
export type EntityUpsertBatchScope = Pick<LifecycleBatchInput, "identity"> & {
	command: DomainLifecycleCommand;
};
export type EnsureUserEntityItem = {
	entitySchema: EntitySchemaReference;
	name: string;
	properties: unknown;
};
const preparedUserEntitySave = Symbol("PreparedUserEntitySave");
type PreparedUserEntitySave = {
	readonly entityId: EntityId;
	readonly created: PreparedEntityCreate | null;
	readonly [preparedUserEntitySave]: PreparedMutation;
};
export const SerializedUserEntitySave = Schema.Struct({
	entityId: EntityId,
	mutation: PreparedEntityMutation,
});
export type SerializedUserEntitySave = typeof SerializedUserEntitySave.Type;

export const serializeUserEntitySave = (
	saved: PreparedUserEntitySave,
): SerializedUserEntitySave => ({
	entityId: saved.entityId,
	mutation: saved[preparedUserEntitySave],
});

export const restoreUserEntitySave = Effect.fnUntraced(function* (saved: SerializedUserEntitySave) {
	const decoded = yield* Schema.decodeEffect(SerializedUserEntitySave)(saved).pipe(
		Effect.mapError(() => new DbError({ message: "Invalid serialized user entity save" })),
	);
	if (decoded.entityId !== decoded.mutation.entityId) {
		return yield* new DbError({
			message: "Serialized user entity save ID does not match its mutation",
		});
	}
	const userId = decoded.mutation.scopeUserId;
	if (userId === null) {
		return yield* new DbError({ message: "Serialized user entity save has no user scope" });
	}
	return Object.freeze({
		entityId: decoded.entityId,
		[preparedUserEntitySave]: decoded.mutation,
		created:
			decoded.mutation.operation === "create"
				? makePreparedEntityCreate({
						userId,
						entityId: decoded.entityId,
						entitySchemaSlug: decoded.mutation.draft.entitySchemaSlug,
						entitySchemaPluginId: decoded.mutation.entitySchemaPluginId,
					})
				: null,
	});
});

type PrepareUserEntitySaveInput = {
	userId: UserId;
	name: string;
	properties: unknown;
	entitySchema: EntitySchemaReference;
	lifecycle: DomainLifecycleCommand;
	target:
		| { kind: "create" }
		| {
				kind: "update";
				entityId: EntityId;
				expected: Pick<EntitySnapshotResult["entity"], "name" | "properties" | "updatedAt">;
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
	recorded: Schema.Boolean,
	externalId: Schema.String,
	receipt: MutationReceiptIdentity,
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
const GlobalEntityItemReceipt = Schema.Union([
	EntityEnsureResult,
	Schema.Struct({ status: Schema.Literal("skipped") }),
]);
export type GlobalEntityUpsertResults = typeof GlobalEntityUpsertResults.Type;
export type GlobalEntityUpsertCursor = {
	readonly accepted: PendingEntityMutation | null;
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
const createReceiptInput = (input: CreateEntityInput, updateExisting?: boolean) => ({
	scope: input.scope,
	name: input.name.trim(),
	properties: input.properties,
	entitySchema: input.entitySchema,
	externalId: input.externalId ?? null,
	providerId: input.providerId ?? null,
	writeContext: input.lifecycle.writeContext,
	populatedAt: input.populatedAt?.toISOString() ?? null,
	...(input.scope === "user" ? { userId: input.userId } : {}),
	...(updateExisting === undefined ? {} : { updateExisting }),
});
const createReceipt = (input: CreateEntityInput, updateExisting?: boolean) =>
	mutationReceiptIdentity({
		command: input.lifecycle,
		input: createReceiptInput(input, updateExisting),
		scopeUserId: input.scope === "user" ? input.userId : null,
		commandKind: updateExisting === undefined ? "entity:create" : "entity:upsert",
		ownerUserId: mutationReceiptOwner(
			input.lifecycle,
			input.scope === "user" ? input.userId : null,
		),
	});
const globalUpsertReceipt = (
	items: ReadonlyArray<UpsertGlobalEntityItem>,
	providerId: SandboxProviderId,
	lifecycle: DomainLifecycleCommand,
	options?: UpsertGlobalEntitiesOptions,
) =>
	mutationReceiptIdentity({
		scopeUserId: null,
		command: lifecycle,
		commandKind: "entity:upsert-global-batch",
		ownerUserId: mutationReceiptOwner(lifecycle, null),
		input: {
			providerId,
			writeContext: lifecycle.writeContext,
			maximumTotal: options?.maximumTotal ?? null,
			items: items.map((item) => ({
				...item,
				name: item.name.trim(),
				populatedAt: item.populatedAt?.toISOString() ?? null,
			})),
		},
	});
const receiptConflict = (error: DbError | MutationReceiptIdentityConflict) =>
	error instanceof MutationReceiptIdentityConflict
		? bad("mutation-conflict", "Command identity was reused with different entity input")
		: error;
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
	receiptOf: (item: T) => MutationReceiptIdentity,
) {
	const byIdentity = new Map<string, number>();
	const byReceipt = new Map<string, number>();
	const representatives: number[] = [];
	for (const [index, item] of items.entries()) {
		const key = identityKey(item);
		const receipt = receiptOf(item);
		const first = byIdentity.get(key) ?? byReceipt.get(receipt.id);
		if (first === undefined) {
			byIdentity.set(key, index);
			byReceipt.set(receipt.id, index);
			representatives.push(index);
			continue;
		}
		const firstItem = items[first];
		const firstReceipt = firstItem === undefined ? null : receiptOf(firstItem);
		if (
			firstItem === undefined ||
			identityKey(firstItem) !== key ||
			firstReceipt?.id !== receipt.id ||
			firstReceipt.inputFingerprint !== receipt.inputFingerprint
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

export class EntitiesService extends Context.Service<EntitiesService>()("EntitiesService", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const assetReferences = yield* ManagedAssetReferenceLocker.make;
		const writeChecks = yield* DomainWriteChecks;
		const planner = yield* LifecyclePlanner;
		const repository = yield* EntitiesRepository;
		const eventsRepository = yield* EventsRepository;
		const events = yield* EventsService;
		const receipts = yield* MutationReceipts.make;
		const lookupEntityReceipt = (identity: ReturnType<typeof mutationReceiptIdentity>) =>
			receipts.lookup(identity, EntitySnapshotResult).pipe(Effect.mapError(receiptConflict));
		const peekEntityReceipt = (identity: ReturnType<typeof mutationReceiptIdentity>) =>
			receipts.peek(identity, EntitySnapshotResult).pipe(Effect.mapError(receiptConflict));
		const { lookupReceipts, insertReceipts } = makeReceiptBatches(receipts);
		const execution = yield* LifecycleExecution;
		const replayCreateStep = Effect.fn("EntitiesService.replayCreateStep")(function* (
			input: CreateEntityInput,
		) {
			const replay = yield* peekEntityReceipt(createReceipt(input));
			return replay
				? { result: replay.result, dispatch: replay.dispatch, _tag: "Committed" as const }
				: null;
		});

		const assertOwner = session.requireRoot.pipe(Effect.mapError(enclosingTransaction));
		const assertActiveTransaction = session.requireTransaction.pipe(
			Effect.mapError(() => new LifecyclePersistenceError({ code: "active-transaction-required" })),
		);
		const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
			runRootTransaction(session, repository.lockSchemaCatalog().pipe(Effect.andThen(work))).pipe(
				Effect.mapError((error) =>
					error instanceof DatabaseSessionStateError ? enclosingTransaction() : error,
				),
			);

		const entitySchema = Effect.fnUntraced(function* (
			scopeUserId: UserId | null,
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
			function* (input: { userId: UserId; entityId: EntityId; lifecycle: DomainLifecycleCommand }) {
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
						const identity = mutationReceiptIdentity({
							command: input.lifecycle,
							ownerUserId: input.userId,
							scopeUserId: input.userId,
							commandKind: "entity:reference",
							input: { entityId: input.entityId, writeContext: input.lifecycle.writeContext },
						});
						const replay = yield* lookupEntityReceipt(identity);
						if (replay) {
							return {
								result: replay.result,
								dispatch: replay.dispatch,
								_tag: "Committed" as const,
							};
						}
						const entity = yield* repository.getByIdForUser(input);
						if (!entity) {
							return yield* new EntityNotFound({
								reason: { code: "entity-not-found", entityId: input.entityId },
							});
						}
						const result = yield* Schema.decodeEffect(EntitySnapshotResult)({ entity });
						yield* receipts.insert({ result, identity, dispatch: [] });
						return { result, dispatch: [], _tag: "Committed" as const };
					}),
				);
			},
		);
		const validateDraft = Effect.fnUntraced(function* (
			draft: Omit<AutomationEntityDraft, "properties" | "entitySchemaPluginId"> & {
				properties: unknown;
			},
			scopeUserId: UserId | null,
			owner: DefinitionOwner,
			lifecycle: DomainLifecycleCommand,
			commit = false,
			verified?: DomainWritePin | null,
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
			scopeUserId: UserId | null,
			lifecycle: DomainLifecycleCommand,
			pin?: DomainWritePin | null,
		) {
			if (!lifecycle.writeContext?.pluginRevision) {
				return yield* Effect.void;
			}
			const parsed = yield* validateDraft(
				draftOf(snapshot(entity)),
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
			input: Omit<PreparedMutation, "requestId" | "receipt"> & {
				receiptKind: string;
				receiptInput: unknown;
			},
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
					return yield* bad("mutation-conflict", "Mutation requires the persisted entity snapshot");
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
				trigger: lifecycleTrigger(lifecycle, input.scopeUserId, request),
			});
			if (planned.trigger?.blockedReason) {
				return { _tag: "Blocked" as const };
			}
			const { receiptKind: _kind, receiptInput: _input, ...preparedInput } = input;
			const pending: PendingEntityMutation = {
				...preparedInput,
				request,
				lifecycle,
				policies: planned.policies,
				requestId: planned.trigger?.id ?? null,
				receipt: mutationReceiptIdentity({
					command: lifecycle,
					input: input.receiptInput,
					commandKind: input.receiptKind,
					scopeUserId: input.scopeUserId,
					ownerUserId: mutationReceiptOwner(lifecycle, input.scopeUserId),
				}),
			};
			return pending;
		});
		const planMutation = (input: Parameters<typeof planMutationInTransaction>[0]) =>
			transaction(planMutationInTransaction(input)).pipe(
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
			planner,
			receipts,
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
			resultCodec: EntitySnapshotResult,
			resultOf: (entity) => ({ entity }),
		});
		const persistDeletes = makePersistMutation({
			...persistence,
			resultOf: () => null,
			resultCodec: EntityDeleteResult,
		});
		const persistEnsures = makePersistMutation({
			...persistence,
			resultCodec: EntityEnsureResult,
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
		const assertImmutablePropertiesKept = Effect.fnUntraced(function* (prepared: PreparedMutation) {
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
					return yield* new EntityBadRequest({ reason: { property, code: "immutable-property" } });
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
			(pending: PendingEntityMutation) => transaction(persistAndBatch(pending)),
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
			step: Effect.Effect<LifecyclePreparedStep<EntitySnapshotResult, PendingEntityMutation>, E, R>,
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
			receiptKind = updateExisting === undefined ? "entity:create" : "entity:upsert",
			receiptInput: unknown = createReceiptInput(input, updateExisting),
			deferPlanning = false,
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
				receiptKind,
				scopeUserId,
				receiptInput,
				lifecycle: input.lifecycle,
				before: existing && !replay ? snapshot(existing) : null,
				entityId: existing?.id ?? commandEntityId(input.lifecycle),
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
			const identity = createReceipt(input, updateExisting);
			const replay = yield* peekEntityReceipt(identity);
			if (replay) {
				const batch = yield* transaction(
					entityBatchPlans({ identity: ["batch"], command: input.lifecycle }),
				);
				return {
					_tag: "Committed",
					result: replay.result,
					dispatch: [...replay.dispatch, ...batch],
				} satisfies LifecycleCommittedStep<EntitySnapshotResult>;
			}
			const planned = yield* planCreate(input, updateExisting, undefined, undefined, true);
			if (planned.existing) {
				const before = snapshot(planned.existing);
				const result = { entity: planned.existing };
				return yield* transaction(
					Effect.gen(function* () {
						const recorded = yield* lookupEntityReceipt(identity);
						if (recorded) {
							const batch = yield* entityBatchPlans({
								identity: ["batch"],
								command: input.lifecycle,
							});
							return {
								result: recorded.result,
								_tag: "Committed" as const,
								dispatch: [...recorded.dispatch, ...batch],
							};
						}
						const current = yield* repository.getMutationEntity(planned.existing.id, true);
						if (!current || !same(snapshot(current.entity), before)) {
							return yield* bad("mutation-conflict", "Entity changed before no-op was recorded");
						}
						const batchScope = { identity: ["batch"], command: input.lifecycle };
						const decision = yield* planner.prepareBatch({
							...batchScope,
							resource: "entity",
							scopes: [input.scope === "user" ? input.userId : null],
						});
						yield* receipts.insert({ result, identity, dispatch: [], batchId: decision.id });
						yield* planner.planBatch({ ...batchScope, resource: "entity" });
						return { result, dispatch: [], _tag: "Committed" as const };
					}),
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
					receipt: createReceipt(item, item.updateExisting),
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
				({ receipt }) => receipt,
			);
			yield* repository.lockSchemaCatalog();
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
						Effect.mapError(() => bad("mutation-conflict", "Invalid lifecycle command")),
						Effect.map((lifecycle) => ({ ...entry, lifecycle })),
					),
			);
			const recorded = yield* lookupReceipts(
				unique.map(({ receipt }) => receipt),
				EntitySnapshotResult,
			).pipe(Effect.mapError(receiptConflict));
			const pending = yield* Effect.forEach(
				unique.filter((_, position) => !recorded[position]),
				(entry) =>
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
			for (const [position, entry] of unique.entries()) {
				const replay = recorded[position];
				if (replay) {
					settled.set(entry.index, { result: replay.result, dispatch: replay.dispatch });
				}
			}
			const records: MutationReceiptRecord[] = [];
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
					const result = { entity: existing };
					records.push({
						result,
						dispatch: [],
						batchId: decision.id,
						batchIndex: entry.index,
						identity: entry.receipt,
					});
					settled.set(entry.index, { result, dispatch: [] });
					continue;
				}
				const before = existing && !replay ? snapshot(existing) : null;
				const prepared: PreparedMutation = {
					before,
					requestId: null,
					receipt: entry.receipt,
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
			yield* insertReceipts([...records, ...saved.records]);
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
		const persistPlannedProviderUpsert = Effect.fn("EntitiesService.persistPlannedProviderUpsert")(
			function* (input: UpsertEntityInput) {
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
			},
		);
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
			const receiptInput = {
				scope: input.scope,
				name: input.name.trim(),
				entityId: input.entityId,
				properties: input.properties,
				writeContext: input.lifecycle.writeContext,
				...(input.populatedAt === undefined
					? {}
					: { populatedAt: input.populatedAt?.toISOString() ?? null }),
				...(input.expected === undefined ? {} : { expected: input.expected }),
				...(input.requireUserOwned === undefined
					? {}
					: { requireUserOwned: input.requireUserOwned }),
				...(input.scope === "user" ? { userId: input.userId } : {}),
			};
			for (const scopeUserId of input.scope === "user" ? [null, input.userId] : [null]) {
				const recorded = yield* receipts
					.peek(
						mutationReceiptIdentity({
							scopeUserId,
							input: receiptInput,
							command: input.lifecycle,
							commandKind: "entity:update",
							ownerUserId: mutationReceiptOwner(input.lifecycle, scopeUserId),
						}),
						EntitySnapshotResult,
					)
					.pipe(Effect.mapError(receiptConflict));
				if (recorded) {
					const batch = yield* transaction(
						entityBatchPlans({ identity: ["batch"], command: input.lifecycle }),
					);
					return {
						entity: recorded.result.entity,
						warnings: yield* execution.dispatch([...recorded.dispatch, ...batch]),
					};
				}
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
			const before = snapshot(current.entity);
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
				receiptInput,
				entityId: input.entityId,
				lifecycle: input.lifecycle,
				scopeUserId: current.userId,
				receiptKind: "entity:update",
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
				).pipe(
					Effect.filterOrFail(
						(step) => step._tag !== "Blocked",
						() => bad("automation-limit", "Entity request exceeds automation limits"),
					),
				),
				(pending) => transaction(persistCheckedUpdate(pending, input.requireUserOwned === true)),
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
					receiptKind: "entity:create",
					entityId: commandEntityId(lifecycle),
					receiptInput: createReceiptInput({
						userId,
						lifecycle,
						scope: "user",
						name: input.name,
						entitySchema: reference,
						properties: input.properties,
					}),
				};
			} else {
				const { entityId, expected } = input.target;
				const current = yield* repository.getMutationEntity(entityId);
				if (
					!current ||
					current.userId !== userId ||
					current.entity.providerId !== null ||
					current.entity.entitySchemaSlug !== reference.slug ||
					(current.entity.entitySchemaPluginId ?? null) !== definitionOwnerPluginId(reference.owner)
				) {
					return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
				}
				yield* writeChecks
					.check(lifecycle, definitionOwner(current.entity.entitySchemaPluginId), current.userId)
					.pipe(Effect.mapError(writeFailure));
				const before = snapshot(current.entity);
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
					receiptKind: "entity:update",
					receiptInput: {
						userId,
						entityId,
						expected,
						scope: "user",
						requireUserOwned: true,
						name: input.name.trim(),
						properties: input.properties,
						writeContext: lifecycle.writeContext,
					},
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
		const persistPreparedUserSave = Effect.fn("EntitiesService.persistPreparedUserSave")(function* (
			saved: PreparedUserEntitySave,
		) {
			yield* assertActiveTransaction;
			const prepared = saved[preparedUserEntitySave];
			yield* assertUserEditable(prepared);
			yield* assertImmutablePropertiesKept(prepared);
			const batchScope = { identity: ["batch"], command: prepared.lifecycle };
			const decision = yield* planner.prepareBatch({
				...batchScope,
				resource: "entity",
				scopes: [prepared.scopeUserId],
			});
			const persisted = yield* persistSnapshots.persistSave(prepared, { ...decision, index: 0 });
			const batch = yield* entityBatchPlans(batchScope);
			return { entity: persisted.result.entity, dispatch: [...persisted.dispatch, ...batch] };
		});
		const deleteByIds = Effect.fn("EntitiesService.deleteByIds")(function* (
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
						return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
					}
					yield* writeChecks
						.check(lifecycle, definitionOwner(current.entity.entitySchemaPluginId), current.userId)
						.pipe(Effect.mapError(writeFailure));
				}
			}
			const aggregateReceipt = mutationReceiptIdentity({
				scopeUserId: null,
				command: lifecycle,
				commandKind: "entity:delete-batch",
				ownerUserId: mutationReceiptOwner(lifecycle, null),
				input: {
					entityIds: orderedIds,
					target: target ?? null,
					writeContext: lifecycle.writeContext,
				},
			});
			const aggregateResult = Schema.Struct({ deletedCount: Schema.Finite });
			const existingBatch = yield* receipts
				.peek(aggregateReceipt, aggregateResult)
				.pipe(Effect.mapError(receiptConflict));
			if (existingBatch) {
				return {
					deletedCount: existingBatch.result.deletedCount,
					warnings: yield* execution.dispatch(existingBatch.dispatch),
				};
			}
			const eventIdentities = yield* eventsRepository.listEventIdentitiesForEntities(orderedIds);
			if (target?.preserveHistory === true && eventIdentities.length > 0) {
				return yield* new EntityBadRequest({ reason: { code: "entity-has-history" } });
			}
			const preparedEvents: PreparedEventDelete[] = [];
			for (const identity of eventIdentities) {
				const eventCommand = itemCommand(
					{ ...lifecycle, accountGeneration: yield* receipts.currentAccount(identity.userId) },
					`${identity.userId}:${identity.eventId}:cascade-delete`,
				);
				const preparedEvent = yield* events.prepareEntityCascadeDelete(
					identity,
					orderedIds,
					eventCommand,
				);
				if (!preparedEvent) {
					return yield* new DbError({
						message: "Event changed while cascade deletion was prepared",
					});
				}
				preparedEvents.push(preparedEvent);
			}
			const prepared = yield* Effect.forEach(orderedIds, (entityId) =>
				Effect.gen(function* () {
					const command = itemCommand(lifecycle, entityId);
					const receiptInput = {
						entityId,
						target: target ?? null,
						requestedIds: orderedIds,
						writeContext: lifecycle.writeContext,
					};
					for (const scopeUserId of lifecycle.causation.initiator.kind === "user"
						? [null, lifecycle.causation.initiator.id]
						: [null]) {
						const replay = yield* receipts
							.peek(
								mutationReceiptIdentity({
									command,
									scopeUserId,
									input: receiptInput,
									commandKind: "entity:delete",
									ownerUserId: mutationReceiptOwner(command, scopeUserId),
								}),
								EntityDeleteResult,
							)
							.pipe(Effect.mapError(receiptConflict));
						if (replay) {
							return { replay, scopeUserId, prepared: null };
						}
					}
					const current = yield* repository.getMutationEntity(entityId);
					if (!current) {
						return null;
					}
					if (!matchesTarget(current)) {
						return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
					}
					const before = snapshot(current.entity);
					yield* validateExistingEntity(current.entity, current.userId, command);
					const validated = yield* validateDraft(
						draftOf(before),
						current.userId,
						definitionOwner(current.entity.entitySchemaPluginId),
						command,
					);
					yield* writeChecks
						.check(command, definitionOwner(current.entity.entitySchemaPluginId), current.userId)
						.pipe(Effect.mapError(writeFailure));
					const pending = yield* planMutation({
						before,
						entityId,
						receiptInput,
						lifecycle: command,
						operation: "delete",
						draft: validated.draft,
						scopeUserId: current.userId,
						receiptKind: "entity:delete",
						entitySchemaPluginId: validated.entitySchemaPluginId,
						entitySchemaFingerprint: validated.entitySchemaFingerprint,
					});
					return {
						replay: null,
						scopeUserId: current.userId,
						prepared: yield* acceptedMutation(yield* applyMutationPolicies(pending)),
					};
				}),
			);
			const committed = yield* transaction(
				Effect.gen(function* () {
					const writeContext = lifecycle.writeContext;
					let scopeUserId: UserId | null = null;
					if (writeContext?.pluginRevision?.scope === "user") {
						scopeUserId = writeContext.pluginRevision.ownerId;
					}
					const settled = prepared.filter((item) => item !== null);
					const pending = settled.flatMap((item, index) =>
						item.replay ? [] : [{ index, input: item.prepared }],
					);
					const pins = yield* verifyWrites([
						{ scopeUserId, command: lifecycle, owner: principalOwner(lifecycle.writeContext) },
						...pending.map(({ input }) => preparedWriteCheck(input)),
					]);
					const previous = yield* receipts
						.lookup(aggregateReceipt, aggregateResult)
						.pipe(Effect.mapError(receiptConflict));
					if (previous) {
						return { dispatch: previous.dispatch, deletedCount: previous.result.deletedCount };
					}
					const recorded = yield* lookupReceipts(
						pending.map(({ input }) => input.receipt),
						EntityDeleteResult,
					).pipe(
						Effect.mapError((error) =>
							error instanceof MutationReceiptIdentityConflict
								? bad(
										"mutation-conflict",
										"Command identity was reused with a different entity payload",
									)
								: error,
						),
					);
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
					const eventBatch = yield* planner.planBatch({ ...eventBatchScope, resource: "event" });
					const persisted = pending.flatMap(({ index, input }, position) =>
						recorded[position]
							? []
							: [{ input, batchIndex: index, pin: pins(preparedWriteCheck(input)) }],
					);
					const written = yield* persistDeletes.persistMany(persisted, decision, rows);
					yield* insertReceipts(written.records);
					const results = new Map<number, CommittedLifecycleWork<null>>();
					for (const [position, { index }] of pending.entries()) {
						const replay = recorded[position];
						if (replay) {
							results.set(index, { result: replay.result, dispatch: replay.dispatch });
						}
					}
					for (const [position, { batchIndex }] of persisted.entries()) {
						const work = written.results[position];
						if (work) {
							results.set(batchIndex, work);
						}
					}
					const saved = yield* Effect.forEach(settled, (item, index) => {
						const work = item.replay
							? { result: item.replay.result, dispatch: item.replay.dispatch }
							: results.get(index);
						return work ? Effect.succeed(work) : Effect.die("Entity delete is missing its result");
					});
					const batch = yield* entityBatchPlans(batchScope);
					const dispatch = [
						...eventSaved.flatMap((item) => item.dispatch),
						...eventBatch,
						...saved.flatMap((item) => item.dispatch),
						...batch,
					];
					const deletedCount = saved.length;
					yield* receipts.insert({
						dispatch,
						result: { deletedCount },
						identity: aggregateReceipt,
					});
					return { dispatch, deletedCount };
				}),
			);
			const warnings = yield* execution
				.dispatch(committed.dispatch)
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
			return { warnings, deletedCount: committed.deletedCount };
		});
		const ensureUserEntities = Effect.fn("EntitiesService.ensureUserEntities")(function* (
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
			const aggregateReceipt = mutationReceiptIdentity({
				command: lifecycle,
				scopeUserId: userId,
				commandKind: "entity:ensure-batch",
				ownerUserId: mutationReceiptOwner(lifecycle, userId),
				input: {
					writeContext: lifecycle.writeContext,
					items: items.map((item) => ({ ...item, name: item.name.trim() })),
				},
			});
			const aggregateResult = Schema.Array(
				Schema.Struct({
					entityId: EntityId,
					wasInserted: Schema.Boolean,
					dispatch: Schema.Array(LifecycleDispatchPlan),
				}),
			);
			const recordedBatch = yield* receipts
				.peek(aggregateReceipt, aggregateResult)
				.pipe(Effect.mapError(receiptConflict));
			if (recordedBatch) {
				return yield* Effect.forEach(recordedBatch.result, (item) =>
					execution
						.dispatch(item.dispatch)
						.pipe(
							Effect.map((warnings) => ({
								warnings,
								entityId: item.entityId,
								wasInserted: item.wasInserted,
							})),
						),
				);
			}
			const entries = items.map((item) => {
				const command = itemCommand(
					lifecycle,
					definitionKey("entity", item.entitySchema.owner, item.entitySchema.slug),
				);
				const receiptInput = {
					...item,
					userId,
					name: item.name.trim(),
					writeContext: lifecycle.writeContext,
				};
				return {
					item,
					command,
					receiptInput,
					receipt: mutationReceiptIdentity({
						command,
						scopeUserId: userId,
						input: receiptInput,
						commandKind: "entity:ensure",
						ownerUserId: mutationReceiptOwner(command, userId),
					}),
				};
			});
			const representatives = yield* batchRepresentatives(
				entries,
				({ item }) => definitionKey("entity", item.entitySchema.owner, item.entitySchema.slug),
				({ receipt }) => receipt,
			);
			const prepared = yield* Effect.forEach(entries, ({ item, command, receipt, receiptInput }) =>
				Effect.gen(function* () {
					const recorded = yield* receipts
						.peek(receipt, EntityEnsureResult)
						.pipe(Effect.mapError(receiptConflict));
					if (recorded) {
						return { item, receipt, recorded, existing: null, prepared: null };
					}
					const existing = yield* repository.findUserEntityWithoutProvenance({
						userId,
						entitySchemaSlug: item.entitySchema.slug,
						entitySchemaPluginId: definitionOwnerPluginId(item.entitySchema.owner),
					});
					if (existing) {
						return { item, receipt, existing, prepared: null, recorded: null };
					}
					const planned = yield* planCreate(
						{ ...item, userId, scope: "user", lifecycle: command },
						undefined,
						"entity:ensure",
						receiptInput,
					);
					return {
						item,
						receipt,
						existing,
						recorded: null,
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
					const previous = yield* receipts
						.lookup(aggregateReceipt, aggregateResult)
						.pipe(Effect.mapError(receiptConflict));
					if (previous) {
						return previous.result;
					}
					const batchScope = { command: lifecycle, identity: ["ensure"] };
					const decision = yield* planner.prepareBatch({
						...batchScope,
						scopes: [userId],
						resource: "entity",
					});
					const unique = prepared.flatMap((entry, index) =>
						representatives[index] === index ? [{ ...entry, index }] : [],
					);
					const prior = yield* lookupReceipts(
						unique.map(({ receipt }) => receipt),
						EntityEnsureResult,
					).pipe(Effect.mapError(receiptConflict));
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
					const pending = unique.filter((entry, position) => {
						const recorded = entry.recorded ?? prior[position];
						if (recorded) {
							settled.set(entry.index, { ...recorded.result, dispatch: recorded.dispatch });
						}
						return !recorded;
					});
					const existing = yield* repository.findUserEntitiesWithoutProvenance({
						userId,
						scopes: pending.map(({ item }) => ensureScopeOf(item)),
					});
					const records: MutationReceiptRecord[] = [];
					const persisted: PersistItem[] = [];
					for (const entry of pending) {
						const found = existing.get(ensureScopeKey(ensureScopeOf(entry.item)));
						if (found) {
							const result = { wasInserted: false, entityId: found.id };
							records.push({
								result,
								dispatch: [],
								batchId: decision.id,
								batchIndex: entry.index,
								identity: entry.receipt,
							});
							settled.set(entry.index, { ...result, dispatch: [] });
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
					yield* insertReceipts([...records, ...written.records]);
					const batch = yield* entityBatchPlans(batchScope);
					const result = yield* Effect.forEach(representatives, (representative, index) => {
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
					yield* receipts.insert({
						result,
						identity: aggregateReceipt,
						dispatch: result.flatMap((item) => item.dispatch),
					});
					return result;
				}),
			);
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
			aggregateReceipt: ReturnType<typeof mutationReceiptIdentity>,
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
					const previous = yield* receipts
						.lookup(aggregateReceipt, GlobalEntityUpsertResults)
						.pipe(Effect.mapError(receiptConflict));
					if (previous) {
						return {
							result: previous.result,
							_tag: "Committed" as const,
							dispatch: previous.dispatch,
						};
					}
					const batchScope = { command: lifecycle, identity: ["global-upsert"] };
					const decision = yield* planner.prepareBatch({
						...batchScope,
						scopes: [null],
						resource: "entity",
					});
					const representatives = yield* batchRepresentatives(
						planned,
						(item) => providerEntityMutationLockKey(identityOf(item)),
						({ receipt }) => receipt,
					);
					const unique = planned.flatMap((item, index) =>
						representatives[index] === index ? [{ ...item, index }] : [],
					);
					const recorded = yield* lookupReceipts(
						unique.map(({ receipt }) => receipt),
						GlobalEntityItemReceipt,
					).pipe(
						Effect.mapError((error) =>
							error instanceof MutationReceiptIdentityConflict
								? bad(
										"mutation-conflict",
										"Command identity was reused with different global upsert input",
									)
								: error,
						),
					);
					const settled = new Map<
						number,
						{ dispatch: ReadonlyArray<LifecycleDispatchPlan> } & GlobalEntityUpsertResults[number]
					>();
					const pending = unique.filter((item, position) => {
						const prior = recorded[position];
						if (prior) {
							settled.set(
								item.index,
								"status" in prior.result
									? { status: "skipped", dispatch: prior.dispatch }
									: {
											status: "upserted",
											dispatch: prior.dispatch,
											entityId: prior.result.entityId,
											wasInserted: prior.result.wasInserted,
										},
							);
						}
						return !prior;
					});
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
					const records: MutationReceiptRecord[] = [];
					const persisted: PersistItem[] = [];
					for (const item of pending) {
						const existingId = existingIdOf(item);
						if (existingId !== null) {
							const result = { wasInserted: false, entityId: existingId };
							records.push({
								result,
								dispatch: [],
								batchId: decision.id,
								batchIndex: item.index,
								identity: item.receipt,
							});
							settled.set(item.index, { ...result, dispatch: [], status: "upserted" });
							continue;
						}
						if (options?.maximumTotal !== undefined) {
							const scope = provenanceScopeKey(scopeOf(item));
							const ordinal = ordinals.get(scope) ?? 0;
							ordinals.set(scope, ordinal + 1);
							if ((totals.get(scope) ?? 0) + ordinal >= options.maximumTotal) {
								records.push({
									dispatch: [],
									batchId: decision.id,
									batchIndex: item.index,
									identity: item.receipt,
									result: { status: "skipped" },
								});
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
					yield* insertReceipts([...records, ...written.records]);
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
					yield* receipts.insert({ result, dispatch, identity: aggregateReceipt });
					return {
						result,
						dispatch,
						_tag: "Committed" as const,
					} satisfies LifecycleCommittedStep<GlobalEntityUpsertResults>;
				}),
			);
		});
		const prepareUpsertGlobalEntitiesStep = Effect.fn(
			"EntitiesService.prepareUpsertGlobalEntitiesStep",
		)(function* (
			items: ReadonlyArray<UpsertGlobalEntityItem>,
			providerId: SandboxProviderId,
			lifecycle: DomainLifecycleCommand,
			options: UpsertGlobalEntitiesOptions | undefined,
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
			const aggregateReceipt = globalUpsertReceipt(items, providerId, lifecycle, options);
			const replay = yield* receipts
				.peek(aggregateReceipt, GlobalEntityUpsertResults)
				.pipe(Effect.mapError(receiptConflict));
			if (replay) {
				return { result: replay.result, dispatch: replay.dispatch, _tag: "Committed" as const };
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
				const receiptInput = {
					providerId,
					writeContext: lifecycle.writeContext,
					item: { ...item, name: item.name.trim() },
					maximumTotal: options?.maximumTotal ?? null,
				};
				return {
					item,
					command,
					receiptInput,
					receipt: mutationReceiptIdentity({
						command,
						scopeUserId: null,
						input: receiptInput,
						commandKind: "entity:upsert-global",
						ownerUserId: mutationReceiptOwner(command, null),
					}),
				};
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
				({ receipt }) => receipt,
			);
			const planned = [...cursor.planned];
			let accepted = cursor.accepted;
			for (let index = planned.length; index < items.length; index += 1) {
				const entry = entries[index];
				if (!entry) {
					return yield* Effect.die("Global entity upsert cursor is out of range");
				}
				const { item, command, receipt, receiptInput } = entry;
				const itemReplay = yield* receipts
					.peek(receipt, GlobalEntityItemReceipt)
					.pipe(
						Effect.mapError((error) =>
							error instanceof MutationReceiptIdentityConflict
								? bad(
										"mutation-conflict",
										"Command identity was reused with different global upsert input",
									)
								: error,
						),
					);
				if (itemReplay) {
					planned.push({
						receipt,
						recorded: true,
						prepared: null,
						externalId: item.externalId,
						entitySchemaSlug: item.entitySchema.slug,
						entitySchemaPluginId: definitionOwnerPluginId(item.entitySchema.owner),
					});
					continue;
				}
				let pending = accepted;
				accepted = null;
				if (!pending) {
					const result = yield* planCreate(
						{ ...item, providerId, scope: "global", lifecycle: command },
						undefined,
						"entity:upsert-global",
						receiptInput,
					);
					if (result.pending?.policies.length) {
						return {
							_tag: "PoliciesRequired",
							pending: { planned, pending: result.pending },
						} satisfies LifecyclePreparedStep<GlobalEntityUpsertResults, PendingGlobalEntityUpsert>;
					}
					pending = result.pending;
				}
				const prepared = pending ? yield* acceptedMutation(pending) : null;
				const definition = yield* entitySchema(null, item.entitySchema);
				planned.push({
					receipt,
					prepared,
					recorded: false,
					externalId: item.externalId,
					entitySchemaSlug: item.entitySchema.slug,
					entitySchemaPluginId: definition.pluginId ?? null,
				});
			}
			return yield* commitGlobalEntities(planned, providerId, lifecycle, aggregateReceipt, options);
		});
		const applyGlobalEntityPolicies = (cursor: PendingGlobalEntityUpsert) =>
			applyMutationPolicies(cursor.pending).pipe(Effect.map((pending) => ({ ...cursor, pending })));
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
			replayCreateStep,
			prepareCreateStep,
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
}) {
	static readonly layer = Layer.effect(this, this.make);
	static readonly layerRuntime = Layer.effect(this, this.make);
	static readonly layerMigration = Layer.effect(this, this.make);
}
