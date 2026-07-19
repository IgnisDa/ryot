import { PgClient } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntitySnapshot,
	AutomationEntityDraft,
	type AutomationPolicyPatch,
	AutomationRequestPayload,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EntityBadRequest,
	EntityNotFound,
	ListedEntity,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	type SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";

import {
	type CommittedLifecycleWork,
	type LifecycleBatchInput,
	LifecyclePersistenceError,
	LifecyclePlannedPolicy,
	type LifecyclePlan,
	LifecyclePlanner,
	lifecycleTriggerId,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { LifecycleCommand, lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	applyLifecyclePolicyPatch,
	canonicalLifecyclePolicyPatch,
} from "#lib/domain/lifecycle-policy-patch";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	runLifecycleWriteInline,
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { trimToNull } from "#lib/shared/validation";
import {
	catalogDefinitionFingerprint,
	CatalogDefinitionFingerprint,
} from "#modules/plugins/runtime-resolver";

import { EntityMutationOutcome } from "./mutation-outcomes";
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
export type PlannedProviderEntityUpsertResult = {
	readonly entity: ListedEntity;
	readonly outcome: EntityMutationOutcome;
	readonly wasInserted: boolean;
};
export type EnsureUserEntityItem = {
	name: string;
	properties: unknown;
	entitySchemaSlug: EntitySchemaSlug;
};
const EntityRequest = Schema.Union([
	AutomationRequestPayload.members[0],
	AutomationRequestPayload.members[1],
	AutomationRequestPayload.members[2],
]);
type EntityRequest = typeof EntityRequest.Type;
const PreparedEntityMutation = Schema.Struct({
	entityId: EntityId,
	lifecycle: LifecycleCommand,
	draft: AutomationEntityDraft,
	scopeUserId: Schema.NullOr(UserId),
	requestId: AutomationTrigger.fields.id,
	before: Schema.NullOr(AutomationEntitySnapshot),
	entitySchemaPluginId: Schema.NullOr(Schema.String),
	entitySchemaFingerprint: CatalogDefinitionFingerprint,
	operation: Schema.Literals(["create", "update", "delete"]),
});
type PreparedMutation = typeof PreparedEntityMutation.Type;
export const PendingEntityMutation = Schema.Struct({
	...PreparedEntityMutation.fields,
	request: EntityRequest,
	policies: Schema.Array(LifecyclePlannedPolicy),
});
export type PendingEntityMutation = typeof PendingEntityMutation.Type;
export const EntitySaveResult = Schema.Struct({
	entity: ListedEntity,
	wasInserted: Schema.Boolean,
	outcome: EntityMutationOutcome,
});
export type EntitySaveResult = typeof EntitySaveResult.Type;
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
const snapshot = (entity: ListedEntity) =>
	Schema.decodeUnknownSync(AutomationEntitySnapshot)(entity);
const draftOf = ({
	id: _id,
	createdAt: _createdAt,
	updatedAt: _updatedAt,
	...draft
}: AutomationEntitySnapshot) => draft;
const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right);
const itemCommand = (lifecycle: LifecycleCommand, identity: string): LifecycleCommand => ({
	...lifecycle,
	itemIdentity: stableStringify([lifecycle.itemIdentity, identity]),
});
const commandEntityId = (lifecycle: LifecycleCommand) =>
	EntityId.make(
		`ent_${sha256Base64Url(stableStringify([lifecycle.causation.executionId, lifecycle.itemIdentity]))}`,
	);
const batchDispatch = (plans: ReadonlyArray<LifecyclePlan>) => plans.map(toLifecycleDispatchPlan);
const committedStep = (saved: {
	readonly plan: LifecyclePlan | null;
	readonly entity: ListedEntity;
	readonly wasInserted: boolean;
	readonly outcome: EntityMutationOutcome;
}): LifecycleCommittedStep<EntitySaveResult> => ({
	_tag: "Committed",
	dispatch: saved.plan ? [toLifecycleDispatchPlan(saved.plan)] : [],
	result: { entity: saved.entity, outcome: saved.outcome, wasInserted: saved.wasInserted },
});

const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const database = yield* Database;
		return yield* mapDatabaseErrors(
			database.transaction((tx) => work.pipe(Effect.provideService(Database, tx))),
		);
	});

export class EntitiesService extends Context.Service<EntitiesService>()("EntitiesService", {
	make: Effect.gen(function* () {
		const sqlClient = yield* PgClient.PgClient;
		const planner = yield* LifecyclePlanner;
		const repository = yield* EntitiesRepository;
		const execution = yield* LifecycleExecution;

		const assertOwner = Effect.serviceOption(sqlClient.transactionService).pipe(
			Effect.flatMap((active) =>
				Option.isSome(active)
					? Effect.fail(
							bad(
								"enclosing-transaction",
								"EntitiesService must own the transaction and post-commit execution",
							),
						)
					: Effect.void,
			),
		);
		const assertActiveTransaction = Effect.serviceOption(sqlClient.transactionService).pipe(
			Effect.flatMap((active) =>
				Option.isSome(active)
					? Effect.void
					: Effect.fail(new LifecyclePersistenceError({ code: "active-transaction-required" })),
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
		const planMutation = Effect.fnUntraced(function* (input: Omit<PreparedMutation, "requestId">) {
			const lifecycle = yield* Schema.decodeEffect(LifecycleCommand)(input.lifecycle).pipe(
				Effect.mapError(() => bad("mutation-conflict", "Invalid lifecycle command")),
			);
			let request: EntityRequest;
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
				request =
					input.operation === "update"
						? {
								resource: "entity",
								draft: input.draft,
								category: "request",
								operation: "update",
								before: input.before,
							}
						: { resource: "entity", operation: "delete", draft: input.before, category: "request" };
			}
			const planned = yield* transaction(
				planner.plan({ trigger: lifecycleTrigger(lifecycle, input.scopeUserId, request) }),
			);
			if (planned.trigger.blockedReason !== null) {
				return yield* bad("automation-limit", "Entity request exceeds automation limits");
			}
			return {
				...input,
				request,
				lifecycle,
				policies: planned.policies,
				requestId: planned.trigger.id,
			} satisfies PendingEntityMutation;
		});
		const applyMutationPolicies = Effect.fn("EntitiesService.applyMutationPolicies")(function* (
			pending: PendingEntityMutation,
		) {
			let payload = pending.request;
			const acceptedPatches: AutomationPolicyPatch[] = [];
			yield* Effect.gen(function* () {
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
			}).pipe(
				Effect.catchCause((cause) =>
					execution
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
		const persisted = Effect.fnUntraced(function* (input: PreparedMutation) {
			yield* repository.lockSchemaCatalog();
			const currentSchema = yield* validateDraft(input.draft, input.scopeUserId);
			if (
				!same(currentSchema.entitySchemaFingerprint, input.entitySchemaFingerprint) ||
				!same(currentSchema.draft, input.draft)
			) {
				return yield* bad(
					"mutation-conflict",
					"Entity schema changed before the source write committed",
				);
			}
			yield* repository.lockMutationKeys([input.entityId]);
			if (input.draft.externalId !== null && input.draft.providerId !== null) {
				yield* repository.lockProviderEntityMutations([
					{
						externalId: input.draft.externalId,
						providerId: input.draft.providerId,
						entitySchemaSlug: input.draft.entitySchemaSlug,
						...(input.scopeUserId === null
							? { scope: "global" as const }
							: { scope: "user" as const, userId: input.scopeUserId }),
					},
				]);
			}
			const current = yield* repository.getMutationEntity(input.entityId, true);
			const before = current ? snapshot(current.entity) : null;
			if (current && current.userId !== input.scopeUserId) {
				return yield* bad("mutation-conflict", "Entity scope changed");
			}
			let entity: ListedEntity;
			let outcome: EntityMutationOutcome;
			if (input.operation === "create") {
				if (before) {
					if (!same(draftOf(before), input.draft)) {
						return yield* bad(
							"mutation-conflict",
							"Command identity was reused with a different entity payload",
						);
					}
					entity = before;
				} else {
					const saved = yield* repository.insertEntity({
						id: input.entityId,
						name: input.draft.name,
						properties: input.draft.properties,
						entitySchemaSlug: input.draft.entitySchemaSlug,
						entitySchemaPluginId: input.entitySchemaPluginId,
						createdAt: DateTime.toDateUtc(DateTime.makeUnsafe(input.lifecycle.occurredAt)),
						populatedAt:
							input.draft.populatedAt === null
								? null
								: DateTime.toDateUtc(DateTime.makeUnsafe(input.draft.populatedAt)),
						...(input.draft.externalId === null ? {} : { externalId: input.draft.externalId }),
						...(input.draft.providerId === null ? {} : { providerId: input.draft.providerId }),
						...(input.scopeUserId === null
							? { scope: "global" as const }
							: { scope: "user" as const, userId: input.scopeUserId }),
					});
					if (!saved.wasInserted) {
						return yield* bad(
							"mutation-conflict",
							"Provider identity changed while policies ran; resubmit with a new command",
						);
					}
					entity = saved.entity;
				}
				outcome = { before: null, operation: "create", after: snapshot(entity) };
			} else {
				if (!before || !same(before, input.before)) {
					return yield* bad(
						"mutation-conflict",
						"Entity changed while policies ran; resubmit with a new command",
					);
				}
				if (input.operation === "delete") {
					yield* repository.deleteByIds([input.entityId]);
					const plan = yield* planner.plan({
						trigger: lifecycleTrigger(
							{
								...input.lifecycle,
								causation: { ...input.lifecycle.causation, parentTriggerId: input.requestId },
							},
							input.scopeUserId,
							{
								before,
								category: "change",
								resource: "entity",
								operation: "delete",
								...(input.lifecycle.population ? { population: input.lifecycle.population } : {}),
							},
						),
					});
					return {
						plan,
						entity: before,
						wasInserted: false,
						outcome: { before, after: before, operation: "noop" as const },
					};
				}
				if (same(draftOf(before), input.draft)) {
					return {
						plan: null,
						entity: before,
						wasInserted: false,
						outcome: { before, after: before, operation: "noop" as const },
					};
				}
				entity = yield* repository.updateEntity({
					name: input.draft.name,
					entityId: input.entityId,
					properties: input.draft.properties,
					populatedAt:
						input.draft.populatedAt === null
							? null
							: DateTime.toDateUtc(DateTime.makeUnsafe(input.draft.populatedAt)),
				});
				outcome = { before, operation: "update", after: snapshot(entity) };
			}
			const plan = yield* planner.plan({
				trigger: lifecycleTrigger(
					{
						...input.lifecycle,
						causation: { ...input.lifecycle.causation, parentTriggerId: input.requestId },
					},
					input.scopeUserId,
					{
						category: "change",
						resource: "entity",
						...(outcome.operation === "create"
							? { after: outcome.after, operation: "create" as const }
							: { after: outcome.after, before: outcome.before, operation: "update" as const }),
						...(input.lifecycle.population ? { population: input.lifecycle.population } : {}),
					},
				),
			});
			return {
				plan,
				entity,
				outcome,
				wasInserted: input.operation === "create" && before === null,
			};
		});
		const entityBatchPlans = (
			batch: EntityUpsertBatchScope,
			saved: ReadonlyArray<{ readonly plan: LifecyclePlan | null }>,
		) =>
			planner.planBatch({
				...batch,
				resource: "entity",
				plans: saved.flatMap((item) => (item.plan ? [item.plan] : [])),
			});
		const commitMutation = Effect.fn("EntitiesService.commitMutation")(function* (
			pending: PendingEntityMutation,
		) {
			const prepared = yield* acceptedMutation(pending);
			const committed = yield* transaction(
				Effect.gen(function* () {
					const saved = yield* persisted(prepared);
					const batch = yield* entityBatchPlans(
						{ identity: ["batch"], command: prepared.lifecycle },
						[saved],
					);
					return { batch, saved };
				}),
			);
			const step = committedStep(committed.saved);
			return { ...step, dispatch: [...step.dispatch, ...batchDispatch(committed.batch)] };
		});
		const mutationStep = Effect.fnUntraced(function* (pending: PendingEntityMutation) {
			if (pending.policies.length === 0) {
				return yield* commitMutation(pending);
			}
			return { pending, _tag: "PoliciesRequired" } satisfies LifecyclePreparedStep<
				EntitySaveResult,
				PendingEntityMutation
			>;
		});
		const saveInline = <E, R>(
			step: Effect.Effect<LifecyclePreparedStep<EntitySaveResult, PendingEntityMutation>, E, R>,
		) =>
			runLifecycleWriteInline(execution, {
				prepare: step,
				commit: commitMutation,
				applyPolicies: applyMutationPolicies,
			}).pipe(Effect.map(({ result, warnings }) => ({ ...result, warnings })));
		const planCreate = Effect.fnUntraced(function* (
			input: CreateEntityInput,
			updateExisting?: boolean,
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
				return { existing, pending: null };
			}
			return {
				existing: null,
				pending: yield* planMutation({
					...validated,
					scopeUserId,
					lifecycle: input.lifecycle,
					operation: existing && !replay ? "update" : "create",
					before: existing && !replay ? snapshot(existing) : null,
					entityId: existing?.id ?? commandEntityId(input.lifecycle),
				}),
			};
		});
		const prepareCreateStep = Effect.fn("EntitiesService.prepareCreateStep")(function* (
			input: CreateEntityInput,
			updateExisting?: boolean,
		) {
			yield* assertOwner;
			const planned = yield* planCreate(input, updateExisting);
			if (planned.existing) {
				const before = snapshot(planned.existing);
				return {
					dispatch: [],
					_tag: "Committed",
					result: {
						wasInserted: false,
						entity: planned.existing,
						outcome: { before, after: before, operation: "noop" },
					},
				} satisfies LifecycleCommittedStep<EntitySaveResult>;
			}
			return yield* mutationStep(planned.pending);
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
			const { entity, outcome, warnings } = yield* saveCreate(input, input.updateExisting);
			return { entity, outcome, warnings };
		});
		const committedProviderUpsertReplay = Effect.fnUntraced(function* (input: {
			operation: "create" | "update";
			lifecycle: LifecycleCommand;
			scopeUserId: UserId | null;
			existing: ListedEntity | null;
			draft: AutomationEntityDraft;
		}) {
			const triggerId = (category: "request" | "change") =>
				lifecycleTriggerId({
					discriminator: "lifecycle",
					itemIdentity: input.lifecycle.itemIdentity,
					executionId: input.lifecycle.causation.executionId,
					kind: { category, resource: "entity", operation: input.operation },
				});
			const request = yield* repository.findLifecyclePayload(triggerId("request"));
			if (request === null) {
				return null;
			}
			if (
				request.category !== "request" ||
				request.resource !== "entity" ||
				!same(request.draft, input.draft)
			) {
				return yield* bad(
					"mutation-conflict",
					"Command identity was reused with a different entity payload",
				);
			}
			if (!input.existing) {
				return yield* bad(
					"mutation-conflict",
					"Replayed entity command is missing its committed entity",
				);
			}
			const requestPlan = yield* planner.plan({
				trigger: lifecycleTrigger(input.lifecycle, input.scopeUserId, request),
			});
			const committed = snapshot(input.existing);
			const outcome = { after: committed, before: committed, operation: "noop" as const };
			const result = { outcome, entity: input.existing, wasInserted: input.operation === "create" };
			const change = yield* repository.findLifecyclePayload(triggerId("change"));
			if (change === null) {
				return {
					result,
					plans: [],
				} satisfies CommittedLifecycleWork<PlannedProviderEntityUpsertResult>;
			}
			if (change.category !== "change" || change.resource !== "entity") {
				return yield* bad("mutation-conflict", "Replayed entity command changed its resource kind");
			}
			const plan = yield* planner.plan({
				trigger: lifecycleTrigger(
					{
						...input.lifecycle,
						causation: { ...input.lifecycle.causation, parentTriggerId: requestPlan.trigger.id },
					},
					input.scopeUserId,
					change,
				),
			});
			return {
				result,
				plans: [plan],
			} satisfies CommittedLifecycleWork<PlannedProviderEntityUpsertResult>;
		});
		const persistPlannedProviderUpsertItem = Effect.fnUntraced(function* (
			input: UpsertEntityInput,
		) {
			yield* assertActiveTransaction;
			const lifecycle = yield* Schema.decodeEffect(LifecycleCommand)(input.lifecycle).pipe(
				Effect.mapError(() => bad("mutation-conflict", "Invalid lifecycle command")),
			);
			const scopeUserId = input.scope === "user" ? input.userId : null;
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
				const before = snapshot(existing);
				return {
					plans: [],
					result: {
						entity: existing,
						wasInserted: false,
						outcome: { before, after: before, operation: "noop" },
					},
				} satisfies CommittedLifecycleWork<PlannedProviderEntityUpsertResult>;
			}
			const operation = existing && !replay ? "update" : "create";
			const committed = yield* committedProviderUpsertReplay({
				existing,
				lifecycle,
				operation,
				scopeUserId,
				draft: validated.draft,
			});
			if (committed) {
				return committed;
			}
			const before = existing && !replay ? snapshot(existing) : null;
			const payload: EntityRequest =
				before === null
					? { resource: "entity", category: "request", operation: "create", draft: validated.draft }
					: {
							before,
							resource: "entity",
							category: "request",
							operation: "update",
							draft: validated.draft,
						};
			const requestPlan = yield* planner.plan({
				trigger: lifecycleTrigger(lifecycle, scopeUserId, payload),
			});
			if (requestPlan.trigger.blockedReason !== null) {
				return yield* bad("automation-limit", "Entity request exceeds automation limits");
			}
			if (requestPlan.policies.length > 0) {
				return yield* new LifecyclePersistenceError({ code: "before-policy-requires-owner" });
			}
			const saved = yield* persisted({
				before,
				lifecycle,
				operation,
				scopeUserId,
				draft: validated.draft,
				requestId: requestPlan.trigger.id,
				entitySchemaPluginId: validated.entitySchemaPluginId,
				entityId: existing?.id ?? commandEntityId(lifecycle),
				entitySchemaFingerprint: validated.entitySchemaFingerprint,
			});
			return {
				plans: saved.plan ? [saved.plan] : [],
				result: { entity: saved.entity, outcome: saved.outcome, wasInserted: saved.wasInserted },
			} satisfies CommittedLifecycleWork<PlannedProviderEntityUpsertResult>;
		});
		const persistPlannedProviderUpserts = Effect.fn(
			"EntitiesService.persistPlannedProviderUpserts",
		)(function* (input: {
			readonly batch: EntityUpsertBatchScope;
			readonly items: ReadonlyArray<UpsertEntityInput>;
		}) {
			const itemPlans: LifecyclePlan[] = [];
			const results: PlannedProviderEntityUpsertResult[] = [];
			for (const item of input.items) {
				const work = yield* persistPlannedProviderUpsertItem(item);
				itemPlans.push(...work.plans);
				results.push(work.result);
			}
			const batchPlans = yield* entityBatchPlans(
				input.batch,
				itemPlans.map((plan) => ({ plan })),
			);
			return { results, plans: [...itemPlans, ...batchPlans] };
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
					plans: work.plans,
				} satisfies CommittedLifecycleWork<PlannedProviderEntityUpsertResult>;
			},
		);
		const update = Effect.fn("EntitiesService.update")(function* (input: UpdateEntityInput) {
			yield* assertOwner;
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
			const pending = yield* planMutation({
				...validated,
				before,
				operation: "update",
				entityId: input.entityId,
				lifecycle: input.lifecycle,
				scopeUserId: current.userId,
			});
			const { entity, warnings } = yield* saveInline(mutationStep(pending));
			return { entity, warnings };
		});
		const deleteByIds = Effect.fn("EntitiesService.deleteByIds")(function* (
			ids: readonly [EntityId, ...EntityId[]],
			lifecycle: LifecycleCommand,
		) {
			yield* assertOwner;
			const prepared = yield* Effect.forEach([...new Set(ids)].sort(), (entityId) =>
				Effect.gen(function* () {
					const current = yield* repository.getMutationEntity(entityId);
					if (!current) {
						return null;
					}
					const before = snapshot(current.entity);
					const definition = yield* entitySchema(current.userId, before.entitySchemaSlug);
					const pending = yield* planMutation({
						before,
						entityId,
						operation: "delete",
						draft: draftOf(before),
						scopeUserId: current.userId,
						lifecycle: itemCommand(lifecycle, entityId),
						entitySchemaPluginId: definition.pluginId ?? null,
						entitySchemaFingerprint: catalogDefinitionFingerprint(definition),
					});
					return yield* acceptedMutation(yield* applyMutationPolicies(pending));
				}),
			);
			const committed = yield* transaction(
				Effect.gen(function* () {
					const saved = yield* Effect.forEach(
						prepared.filter((item) => item !== null),
						persisted,
					);
					return {
						saved,
						batch: yield* entityBatchPlans({ command: lifecycle, identity: ["deletes"] }, saved),
					};
				}),
			);
			const warnings = yield* execution
				.dispatch([
					...committed.saved.flatMap((item) => committedStep(item).dispatch),
					...batchDispatch(committed.batch),
				])
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
			return { warnings, deletedCount: committed.saved.length };
		});
		const ensureUserEntities = Effect.fn("EntitiesService.ensureUserEntities")(function* (
			userId: UserId,
			items: ReadonlyArray<EnsureUserEntityItem>,
			lifecycle: LifecycleCommand,
		) {
			yield* assertOwner;
			const prepared = yield* Effect.forEach(items, (item) =>
				Effect.gen(function* () {
					const existing = yield* repository.findUserEntityWithoutProvenance({
						userId,
						entitySchemaSlug: item.entitySchemaSlug,
					});
					return {
						item,
						existing,
						prepared: existing
							? null
							: yield* Effect.gen(function* () {
									const planned = yield* planCreate({
										...item,
										userId,
										scope: "user",
										lifecycle: itemCommand(lifecycle, item.entitySchemaSlug),
									});
									return planned.pending
										? yield* acceptedMutation(yield* applyMutationPolicies(planned.pending))
										: null;
								}),
					};
				}),
			);
			const committed = yield* transaction(
				Effect.gen(function* () {
					yield* repository.lockUserEntityEnsureScopes({
						userId,
						entitySchemaSlugs: items.map((item) => item.entitySchemaSlug),
					});
					const saved = yield* Effect.forEach(prepared, (item) =>
						Effect.gen(function* () {
							const existing = yield* repository.findUserEntityWithoutProvenance({
								userId,
								entitySchemaSlug: item.item.entitySchemaSlug,
							});
							if (existing) {
								return { saved: null, entityId: existing.id };
							}
							if (!item.prepared) {
								return yield* bad(
									"mutation-conflict",
									"Ensured entity disappeared while policies ran",
								);
							}
							const persistedVar = yield* persisted(item.prepared);
							return { saved: persistedVar, entityId: persistedVar.entity.id };
						}),
					);
					return {
						saved,
						batch: yield* entityBatchPlans(
							{ command: lifecycle, identity: ["ensure"] },
							saved.flatMap((item) => (item.saved ? [item.saved] : [])),
						),
					};
				}),
			);
			const batch = batchDispatch(committed.batch);
			return yield* Effect.forEach([...committed.saved.entries()], ([index, item]) =>
				Effect.gen(function* () {
					const step = item.saved ? committedStep(item.saved) : null;
					const last = index === committed.saved.length - 1;
					const dispatch = [...(step?.dispatch ?? []), ...(last ? batch : [])];
					return {
						entityId: item.entityId,
						wasInserted: step?.result.wasInserted ?? false,
						warnings: dispatch.length
							? yield* execution
									.dispatch(dispatch)
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
			options?: UpsertGlobalEntitiesOptions,
		) {
			const saved = yield* transaction(
				Effect.gen(function* () {
					for (const item of [...planned].sort((a, b) =>
						a.entitySchemaSlug.localeCompare(b.entitySchemaSlug),
					)) {
						yield* repository.lockGlobalEntityProvenanceScope({
							providerId,
							entitySchemaSlug: item.entitySchemaSlug,
							entitySchemaPluginId: item.entitySchemaPluginId,
						});
					}
					const written = yield* Effect.forEach(planned, (input) =>
						Effect.gen(function* () {
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
								return { saved: null, entityId: existing.id, status: "upserted" as const };
							}
							if (
								options?.maximumTotal !== undefined &&
								(yield* repository.countGlobalEntitiesByProvenanceScope(scope)) >=
									options.maximumTotal
							) {
								return { saved: null, status: "skipped" as const };
							}
							if (!input.prepared) {
								return yield* bad(
									"mutation-conflict",
									"Provider entity disappeared while policies ran",
								);
							}
							const persistedVar = yield* persisted(input.prepared);
							return {
								saved: persistedVar,
								status: "upserted" as const,
								entityId: persistedVar.entity.id,
							};
						}),
					);
					return {
						written,
						batch: yield* entityBatchPlans(
							{ command: lifecycle, identity: ["global-upsert"] },
							written.flatMap((item) => (item.saved ? [item.saved] : [])),
						),
					};
				}),
			);
			return {
				_tag: "Committed",
				dispatch: [
					...saved.written.flatMap((item) =>
						item.saved ? committedStep(item.saved).dispatch : [],
					),
					...batchDispatch(saved.batch),
				],
				result: saved.written.map((item) =>
					item.status === "skipped"
						? { status: item.status }
						: {
								status: item.status,
								entityId: item.entityId,
								wasInserted: item.saved?.wasInserted ?? false,
							},
				),
			} satisfies LifecycleCommittedStep<GlobalEntityUpsertResults>;
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
				let pending = accepted;
				accepted = null;
				if (!pending) {
					const result = yield* planCreate({
						...item,
						providerId,
						scope: "global",
						lifecycle: itemCommand(
							lifecycle,
							stableStringify([item.entitySchemaSlug, providerId, item.externalId]),
						),
					});
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
					prepared,
					externalId: item.externalId,
					entitySchemaSlug: item.entitySchemaSlug,
					entitySchemaPluginId: definition.pluginId ?? null,
				});
			}
			return yield* commitGlobalEntities(planned, providerId, lifecycle, options);
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
			prepareCreateStep,
			ensureUserEntities,
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
}
