import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	AutomationEntityRequestPayload,
	type AutomationPolicyPatch,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { EntityBadRequest, EntityNotFound } from "@ryot-app/contract/modules/entities/schemas";
import {
	type UserId,
	EntityId,
	EntitySchemaSlug,
	type SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import {
	type CommittedLifecycleWork,
	type LifecycleBatchInput,
	LifecycleDispatchPlan,
	LifecyclePersistenceError,
	LifecyclePlannedPolicy,
	LifecyclePlanner,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	applyLifecyclePolicyPatch,
	canonicalLifecyclePolicyPatch,
} from "#lib/domain/lifecycle-policy-patch";
import { DatabaseSession, DatabaseSessionStateError } from "#lib/infrastructure/db/session";
import { runRootTransaction } from "#lib/infrastructure/db/transaction";
import {
	runLifecycleWriteInline,
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { trimToNull } from "#lib/shared/validation";
import { EventsRepository } from "#modules/events/repository";
import { EventsService, type PreparedEventDelete } from "#modules/events/service";
import {
	mutationReceiptIdentity,
	mutationReceiptOwner,
	MutationReceiptIdentity,
	MutationReceiptIdentityConflict,
	MutationReceipts,
} from "#modules/mutations/receipts";
import { catalogDefinitionFingerprint } from "#modules/plugins/runtime-resolver";

import { EntityDeleteResult, EntityEnsureResult, EntitySnapshotResult } from "./mutation-outcomes";
import {
	draftOf,
	makePersistMutation,
	PreparedEntityMutation,
	same,
	snapshot,
	type PreparedMutation,
} from "./mutation-persistence";
import { EntitiesRepository } from "./repository";

type Scope = { scope: "global" } | { scope: "user"; userId: UserId };
export type CreateEntityInput = Scope & {
	name: string;
	entitySchemaSlug: EntitySchemaSlug;
	properties: unknown;
	externalId?: string | undefined;
	populatedAt?: Date | null;
	lifecycle: LifecycleCommand;
	providerId?: SandboxProviderId | undefined;
};
export type UpdateEntityInput = Scope & {
	name: string;
	entityId: EntityId;
	properties: unknown;
	populatedAt: Date | null;
	lifecycle: LifecycleCommand;
};
export type UpsertEntityInput = CreateEntityInput & {
	externalId: string;
	updateExisting: boolean;
	populatedAt: Date | null;
	providerId: SandboxProviderId;
};
export type UpsertGlobalEntityItem = {
	name: string;
	externalId: string;
	properties: unknown;
	populatedAt: Date | null;
	entitySchemaSlug: EntitySchemaSlug;
};
export type UpsertGlobalEntitiesOptions = { maximumTotal?: number };
export type EntityUpsertBatchScope = Pick<LifecycleBatchInput, "command" | "identity">;
export type EnsureUserEntityItem = {
	name: string;
	properties: unknown;
	entitySchemaSlug: EntitySchemaSlug;
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
const itemCommand = (lifecycle: LifecycleCommand, identity: string): LifecycleCommand => ({
	...lifecycle,
	itemIdentity: stableStringify([lifecycle.itemIdentity, identity]),
});
const commandEntityId = (lifecycle: LifecycleCommand) =>
	EntityId.make(
		`ent_${sha256Base64Url(stableStringify([lifecycle.causation.executionId, lifecycle.itemIdentity]))}`,
	);
const createReceiptInput = (input: CreateEntityInput, updateExisting?: boolean) => ({
	scope: input.scope,
	name: input.name.trim(),
	properties: input.properties,
	externalId: input.externalId ?? null,
	providerId: input.providerId ?? null,
	entitySchemaSlug: input.entitySchemaSlug,
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
	lifecycle: LifecycleCommand,
	options?: UpsertGlobalEntitiesOptions,
) =>
	mutationReceiptIdentity({
		scopeUserId: null,
		command: lifecycle,
		commandKind: "entity:upsert-global-batch",
		ownerUserId: mutationReceiptOwner(lifecycle, null),
		input: {
			providerId,
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

export class EntitiesService extends Context.Service<EntitiesService>()("EntitiesService", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const planner = yield* LifecyclePlanner;
		const repository = yield* EntitiesRepository;
		const eventsRepository = yield* EventsRepository;
		const events = yield* EventsService;
		const receipts = yield* MutationReceipts.make;
		const lookupEntityReceipt = (identity: ReturnType<typeof mutationReceiptIdentity>) =>
			receipts.lookup(identity, EntitySnapshotResult).pipe(Effect.mapError(receiptConflict));
		const peekEntityReceipt = (identity: ReturnType<typeof mutationReceiptIdentity>) =>
			receipts.peek(identity, EntitySnapshotResult).pipe(Effect.mapError(receiptConflict));
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
			runRootTransaction(session, work).pipe(
				Effect.mapError((error) =>
					error instanceof DatabaseSessionStateError ? enclosingTransaction() : error,
				),
			);

		const entitySchema = Effect.fnUntraced(function* (
			scopeUserId: UserId | null,
			entitySchemaSlug: EntitySchemaSlug,
		) {
			const definition = yield* scopeUserId === null
				? repository.findSystemEntitySchemaById(entitySchemaSlug)
				: repository.findEntitySchemaForUser({ entitySchemaSlug, userId: scopeUserId });
			if (!definition) {
				return yield* new EntityNotFound({
					reason: { entitySchemaSlug, code: "entity-schema-not-found" },
				});
			}
			return definition;
		});
		const prepareReferenceStep = Effect.fn("EntitiesService.prepareReferenceStep")(
			function* (input: { userId: UserId; entityId: EntityId; lifecycle: LifecycleCommand }) {
				return yield* transaction(
					Effect.gen(function* () {
						const identity = mutationReceiptIdentity({
							command: input.lifecycle,
							ownerUserId: input.userId,
							scopeUserId: input.userId,
							commandKind: "entity:reference",
							input: { entityId: input.entityId },
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
			draft: Omit<AutomationEntityDraft, "properties"> & { properties: unknown },
			scopeUserId: UserId | null,
		) {
			const definition = yield* entitySchema(scopeUserId, draft.entitySchemaSlug);
			const name = trimToNull(draft.name);
			if (!name) {
				return yield* new EntityBadRequest({ reason: { field: "name", code: "name-required" } });
			}
			const properties = yield* parseAppSchemaProperties({
				kind: "Entity",
				properties: draft.properties,
				propertiesSchema: definition.propertiesSchema,
			}).pipe(
				Effect.mapError(
					(error) =>
						new EntityBadRequest({
							reason: { code: "invalid-properties", paths: error.issues.map(({ path }) => path) },
						}),
				),
			);
			const validated = yield* Schema.decodeUnknownEffect(AutomationEntityDraft)({
				...draft,
				name,
				properties,
			}).pipe(
				Effect.mapError(
					() => new EntityBadRequest({ reason: { paths: [], code: "invalid-properties" } }),
				),
			);
			return {
				draft: validated,
				entitySchemaPluginId: definition.pluginId ?? null,
				entitySchemaFingerprint: catalogDefinitionFingerprint(definition),
			};
		});
		const planMutationInTransaction = Effect.fnUntraced(function* (
			input: Omit<PreparedMutation, "requestId" | "receipt"> & {
				receiptKind: string;
				receiptInput: unknown;
			},
		) {
			let dependentEvents: PreparedMutation["dependentEvents"] = [];
			const lifecycle = yield* Schema.decodeEffect(LifecycleCommand)(input.lifecycle).pipe(
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
					const capturedDependencies = yield* repository.listEventDependencies(input.entityId);
					dependentEvents = capturedDependencies;
					request = {
						resource: "entity",
						draft: input.draft,
						category: "request",
						operation: "update",
						before: input.before,
						dependentEvents: capturedDependencies,
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
				dependentEvents,
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
						const validated = yield* validateDraft(patched.request.draft, pending.scopeUserId);
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
		const persistence = { planner, receipts, repository, validateDraft };
		const persistSave = makePersistMutation({
			...persistence,
			resultCodec: EntitySnapshotResult,
			resultOf: (entity) => ({ entity }),
		});
		const persistDelete = makePersistMutation({
			...persistence,
			resultOf: () => null,
			resultCodec: EntityDeleteResult,
		});
		const persistEnsure = makePersistMutation({
			...persistence,
			resultCodec: EntityEnsureResult,
			resultOf: (entity, wasInserted) => ({ wasInserted, entityId: entity.id }),
		});
		const entityBatchPlans = (batch: EntityUpsertBatchScope) =>
			planner.planBatch({ ...batch, resource: "entity" });
		const persistAndBatch = Effect.fnUntraced(function* (pending: PendingEntityMutation) {
			const prepared = yield* acceptedMutation(pending);
			const batchScope = { identity: ["batch"], command: prepared.lifecycle };
			const decision = yield* planner.prepareBatch({
				...batchScope,
				resource: "entity",
				scopes: [prepared.scopeUserId],
			});
			const saved = yield* persistSave(prepared, { ...decision, index: 0 });
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
		const saveInline = <E, R>(
			step: Effect.Effect<LifecyclePreparedStep<EntitySnapshotResult, PendingEntityMutation>, E, R>,
		) =>
			runLifecycleWriteInline(execution, {
				prepare: step,
				commit: commitMutation,
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
					entitySchemaSlug: input.entitySchemaSlug,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				},
				scopeUserId,
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
				dependentEvents: [],
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
		const createGlobal = Effect.fn("EntitiesService.createGlobal")(function* (
			input: Omit<CreateEntityInput, "scope" | "userId">,
		) {
			return yield* create({ ...input, scope: "global" });
		});
		const upsert = Effect.fn("EntitiesService.upsert")(function* (input: UpsertEntityInput) {
			const { entity, warnings } = yield* saveCreate(input, input.updateExisting);
			return { entity, warnings };
		});
		const persistPlannedProviderUpsertItem = Effect.fnUntraced(function* (
			input: UpsertEntityInput,
			batch: { id: string; hasCandidates: boolean; index: number },
		) {
			yield* assertActiveTransaction;
			const lifecycle = yield* Schema.decodeEffect(LifecycleCommand)(input.lifecycle).pipe(
				Effect.mapError(() => bad("mutation-conflict", "Invalid lifecycle command")),
			);
			const scopeUserId = input.scope === "user" ? input.userId : null;
			const receipt = createReceipt(input, input.updateExisting);
			const recorded = yield* lookupEntityReceipt(receipt);
			if (recorded) {
				return { result: recorded.result, dispatch: recorded.dispatch };
			}
			const validated = yield* validateDraft(
				{
					name: input.name,
					properties: input.properties,
					externalId: input.externalId,
					providerId: input.providerId,
					entitySchemaSlug: input.entitySchemaSlug,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				},
				scopeUserId,
			);
			const identity = { ...input, entitySchemaPluginId: validated.entitySchemaPluginId };
			yield* repository.lockProviderEntityMutations([identity]);
			const found = yield* repository.findEntityByExternalId(identity);
			const existing = found
				? ((yield* repository.getMutationEntity(found.id, true))?.entity ?? null)
				: null;
			const replay = existing?.id === commandEntityId(lifecycle);
			if (existing && !replay && !input.updateExisting && existing.populatedAt !== null) {
				const result = { entity: existing };
				yield* receipts.insert({
					result,
					dispatch: [],
					identity: receipt,
					batchId: batch.id,
					batchIndex: batch.index,
				});
				return { result, dispatch: [] } satisfies CommittedLifecycleWork<EntitySnapshotResult>;
			}
			const operation = existing && !replay ? "update" : "create";
			const before = existing && !replay ? snapshot(existing) : null;
			let dependentEvents: PreparedMutation["dependentEvents"] = [];
			let payload: AutomationEntityRequestPayload;
			if (before === null) {
				payload = {
					resource: "entity",
					category: "request",
					operation: "create",
					draft: validated.draft,
				};
			} else {
				const capturedDependencies = yield* repository.listEventDependencies(before.id);
				dependentEvents = capturedDependencies;
				payload = {
					before,
					resource: "entity",
					category: "request",
					operation: "update",
					draft: validated.draft,
					dependentEvents: capturedDependencies,
				};
			}
			const requestPlan = yield* planner.plan({
				trigger: lifecycleTrigger(lifecycle, scopeUserId, payload),
			});
			if (requestPlan.trigger?.blockedReason) {
				return yield* bad("automation-limit", "Entity request exceeds automation limits");
			}
			if (requestPlan.policies.length > 0) {
				return yield* new LifecyclePersistenceError({ code: "before-policy-requires-owner" });
			}
			const saved = yield* persistSave(
				{
					before,
					receipt,
					lifecycle,
					operation,
					scopeUserId,
					dependentEvents,
					draft: validated.draft,
					requestId: requestPlan.trigger?.id ?? null,
					entitySchemaPluginId: validated.entitySchemaPluginId,
					entityId: existing?.id ?? commandEntityId(lifecycle),
					entitySchemaFingerprint: validated.entitySchemaFingerprint,
				},
				batch,
			);
			return {
				result: saved.result,
				dispatch: saved.dispatch,
			} satisfies CommittedLifecycleWork<EntitySnapshotResult>;
		});
		const persistPlannedProviderUpserts = Effect.fn(
			"EntitiesService.persistPlannedProviderUpserts",
		)(function* (input: {
			readonly batch: EntityUpsertBatchScope;
			readonly items: ReadonlyArray<UpsertEntityInput>;
		}) {
			const decision = yield* planner.prepareBatch({
				...input.batch,
				resource: "entity",
				scopes: input.items.map((item) => (item.scope === "user" ? item.userId : null)),
			});
			const itemDispatch: LifecycleDispatchPlan[] = [];
			const results: EntitySnapshotResult[] = [];
			for (const [index, item] of input.items.entries()) {
				const work = yield* persistPlannedProviderUpsertItem(item, { ...decision, index });
				itemDispatch.push(...work.dispatch);
				results.push(work.result);
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
			const receiptInput = {
				scope: input.scope,
				name: input.name.trim(),
				entityId: input.entityId,
				properties: input.properties,
				populatedAt: input.populatedAt?.toISOString() ?? null,
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
					: current.userId !== null && current.userId !== input.userId)
			) {
				return yield* new EntityNotFound({
					reason: { code: "entity-not-found", entityId: input.entityId },
				});
			}
			const before = snapshot(current.entity);
			const validated = yield* validateDraft(
				{
					...draftOf(before),
					name: input.name,
					properties: input.properties,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				},
				current.userId,
			);
			const pendingInput = {
				...validated,
				before,
				receiptInput,
				dependentEvents: [],
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
							: yield* persistAndBatch(pending);
					}),
				).pipe(
					Effect.filterOrFail(
						(step) => step._tag !== "Blocked",
						() => bad("automation-limit", "Entity request exceeds automation limits"),
					),
				),
			);
			return { entity, warnings };
		});
		const deleteByIds = Effect.fn("EntitiesService.deleteByIds")(function* (
			ids: readonly [EntityId, ...EntityId[]],
			lifecycle: LifecycleCommand,
		) {
			yield* assertOwner;
			const orderedIds = [...new Set(ids)].sort();
			const aggregateReceipt = mutationReceiptIdentity({
				scopeUserId: null,
				input: orderedIds,
				command: lifecycle,
				commandKind: "entity:delete-batch",
				ownerUserId: mutationReceiptOwner(lifecycle, null),
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
			const preparedEvents: PreparedEventDelete[] = [];
			for (const identity of eventIdentities) {
				const eventCommand = itemCommand(
					{ ...lifecycle, accountGeneration: yield* receipts.currentAccount(identity.userId) },
					`${identity.userId}:${identity.eventId}:cascade-delete`,
				);
				const preparedEvent = yield* events.prepareDelete(identity, eventCommand);
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
					const receiptInput = { entityId, requestedIds: orderedIds };
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
					const before = snapshot(current.entity);
					const definition = yield* entitySchema(current.userId, before.entitySchemaSlug);
					const pending = yield* planMutation({
						before,
						entityId,
						receiptInput,
						lifecycle: command,
						operation: "delete",
						dependentEvents: [],
						draft: draftOf(before),
						scopeUserId: current.userId,
						receiptKind: "entity:delete",
						entitySchemaPluginId: definition.pluginId ?? null,
						entitySchemaFingerprint: catalogDefinitionFingerprint(definition),
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
					for (const entityId of orderedIds) {
						yield* repository.getMutationEntity(entityId, true);
					}
					const previous = yield* receipts
						.lookup(aggregateReceipt, aggregateResult)
						.pipe(Effect.mapError(receiptConflict));
					if (previous) {
						return { dispatch: previous.dispatch, deletedCount: previous.result.deletedCount };
					}
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
						scopes: prepared.flatMap((item) => (item ? [item.scopeUserId] : [])),
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
					const saved = yield* Effect.forEach(
						prepared.filter((item) => item !== null).entries(),
						([index, item]) =>
							item.replay
								? Effect.succeed({ result: item.replay.result, dispatch: item.replay.dispatch })
								: persistDelete(item.prepared, { ...decision, index }),
					);
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
			lifecycle: LifecycleCommand,
		) {
			yield* assertOwner;
			const aggregateReceipt = mutationReceiptIdentity({
				command: lifecycle,
				scopeUserId: userId,
				commandKind: "entity:ensure-batch",
				ownerUserId: mutationReceiptOwner(lifecycle, userId),
				input: items.map((item) => ({ ...item, name: item.name.trim() })),
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
			const prepared = yield* Effect.forEach(items, (item) =>
				Effect.gen(function* () {
					const command = itemCommand(lifecycle, item.entitySchemaSlug);
					const receiptInput = { ...item, userId, name: item.name.trim() };
					const receipt = mutationReceiptIdentity({
						command,
						scopeUserId: userId,
						input: receiptInput,
						commandKind: "entity:ensure",
						ownerUserId: mutationReceiptOwner(command, userId),
					});
					const recorded = yield* receipts
						.peek(receipt, EntityEnsureResult)
						.pipe(Effect.mapError(receiptConflict));
					if (recorded) {
						return { item, receipt, recorded, existing: null, prepared: null };
					}
					const existing = yield* repository.findUserEntityWithoutProvenance({
						userId,
						entitySchemaSlug: item.entitySchemaSlug,
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
					yield* repository.lockUserEntityEnsureScopes({
						userId,
						entitySchemaSlugs: items.map((item) => item.entitySchemaSlug),
					});
					const saved = yield* Effect.forEach(prepared, (item, index) =>
						Effect.gen(function* () {
							if (item.recorded) {
								return {
									entityId: item.recorded.result.entityId,
									saved: { ...item.recorded.result, dispatch: item.recorded.dispatch },
								};
							}
							const prior = yield* receipts
								.lookup(item.receipt, EntityEnsureResult)
								.pipe(Effect.mapError(receiptConflict));
							if (prior) {
								return {
									entityId: prior.result.entityId,
									saved: { ...prior.result, dispatch: prior.dispatch },
								};
							}
							const existing = yield* repository.findUserEntityWithoutProvenance({
								userId,
								entitySchemaSlug: item.item.entitySchemaSlug,
							});
							if (existing) {
								const result = { wasInserted: false, entityId: existing.id };
								yield* receipts.insert({
									result,
									dispatch: [],
									batchIndex: index,
									batchId: decision.id,
									identity: item.receipt,
								});
								return { entityId: existing.id, saved: { ...result, dispatch: [] } };
							}
							if (!item.prepared) {
								return yield* bad(
									"mutation-conflict",
									"Ensured entity disappeared while policies ran",
								);
							}
							const work = yield* persistEnsure(item.prepared, { ...decision, index });
							return {
								entityId: work.result.entityId,
								saved: { ...work.result, dispatch: work.dispatch },
							};
						}),
					);
					const batch = yield* entityBatchPlans(batchScope);
					const result = saved.map((item, index) => ({
						entityId: item.entityId,
						wasInserted: item.saved.wasInserted,
						dispatch: [...item.saved.dispatch, ...(index === saved.length - 1 ? batch : [])],
					}));
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
			lifecycle: LifecycleCommand,
			aggregateReceipt: ReturnType<typeof mutationReceiptIdentity>,
			options?: UpsertGlobalEntitiesOptions,
		) {
			return yield* transaction(
				Effect.gen(function* () {
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
					const recorded = yield* Effect.forEach(planned, (item) =>
						receipts
							.lookup(item.receipt, GlobalEntityItemReceipt)
							.pipe(
								Effect.mapError((error) =>
									error instanceof MutationReceiptIdentityConflict
										? bad(
												"mutation-conflict",
												"Command identity was reused with different global upsert input",
											)
										: error,
								),
							),
					);
					for (const item of [...planned].sort((a, b) =>
						a.entitySchemaSlug.localeCompare(b.entitySchemaSlug),
					)) {
						yield* repository.lockGlobalEntityProvenanceScope({
							providerId,
							entitySchemaSlug: item.entitySchemaSlug,
							entitySchemaPluginId: item.entitySchemaPluginId,
						});
					}
					const written = yield* Effect.forEach(planned, (input, index) =>
						Effect.gen(function* () {
							const prior = recorded[index];
							if (prior) {
								return "status" in prior.result
									? { dispatch: prior.dispatch, status: "skipped" as const }
									: {
											dispatch: prior.dispatch,
											status: "upserted" as const,
											entityId: prior.result.entityId,
											wasInserted: prior.result.wasInserted,
										};
							}
							const scope = {
								providerId,
								entitySchemaSlug: input.entitySchemaSlug,
								entitySchemaPluginId: input.entitySchemaPluginId,
							};
							const existing = yield* repository.findEntityByExternalId({
								...scope,
								scope: "global",
								externalId: input.externalId,
							});
							if (existing) {
								yield* repository.getMutationEntity(existing.id, true);
								const result = { wasInserted: false, entityId: existing.id };
								yield* receipts.insert({
									result,
									dispatch: [],
									batchIndex: index,
									batchId: decision.id,
									identity: input.receipt,
								});
								return {
									dispatch: [],
									wasInserted: false,
									entityId: existing.id,
									status: "upserted" as const,
								};
							}
							if (
								options?.maximumTotal !== undefined &&
								(yield* repository.countGlobalEntitiesByProvenanceScope(scope)) >=
									options.maximumTotal
							) {
								yield* receipts.insert({
									dispatch: [],
									batchIndex: index,
									batchId: decision.id,
									identity: input.receipt,
									result: { status: "skipped" },
								});
								return { dispatch: [], status: "skipped" as const };
							}
							if (!input.prepared) {
								return yield* bad(
									"mutation-conflict",
									"Provider entity disappeared while policies ran",
								);
							}
							const persistedVar = yield* persistEnsure(input.prepared, { ...decision, index });
							return {
								status: "upserted" as const,
								dispatch: persistedVar.dispatch,
								entityId: persistedVar.result.entityId,
								wasInserted: persistedVar.result.wasInserted,
							};
						}),
					);
					const batch = yield* entityBatchPlans(batchScope);
					const dispatch = [...written.flatMap((item) => item.dispatch), ...batch];
					const result = written.map((item) =>
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
			lifecycle: LifecycleCommand,
			options: UpsertGlobalEntitiesOptions | undefined,
			cursor: GlobalEntityUpsertCursor,
		) {
			yield* assertOwner;
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
			const planned = [...cursor.planned];
			let accepted = cursor.accepted;
			for (let index = planned.length; index < items.length; index += 1) {
				const item = items[index];
				if (!item) {
					return yield* Effect.die("Global entity upsert cursor is out of range");
				}
				const command = itemCommand(
					lifecycle,
					stableStringify([item.entitySchemaSlug, providerId, item.externalId]),
				);
				const receiptInput = {
					providerId,
					item: { ...item, name: item.name.trim() },
					maximumTotal: options?.maximumTotal ?? null,
				};
				const receipt = mutationReceiptIdentity({
					command,
					scopeUserId: null,
					input: receiptInput,
					commandKind: "entity:upsert-global",
					ownerUserId: mutationReceiptOwner(command, null),
				});
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
						entitySchemaPluginId: null,
						externalId: item.externalId,
						entitySchemaSlug: item.entitySchemaSlug,
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
				const definition = yield* entitySchema(null, item.entitySchemaSlug);
				planned.push({
					receipt,
					prepared,
					recorded: false,
					externalId: item.externalId,
					entitySchemaSlug: item.entitySchemaSlug,
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
			lifecycle: LifecycleCommand,
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
			commitMutation,
			getByIdAnyScope,
			replayCreateStep,
			prepareCreateStep,
			ensureUserEntities,
			prepareReferenceStep,
			upsertGlobalEntities,
			applyMutationPolicies,
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
