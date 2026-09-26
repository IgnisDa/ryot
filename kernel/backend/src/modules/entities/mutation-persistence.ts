import {
	AutomationEntityDraft,
	AutomationEntitySnapshot,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { EntityBadRequest } from "@ryot-app/contract/modules/entities/schemas";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Schema } from "effect";

import type { LifecyclePlanner } from "#lib/domain/lifecycle";
import { toLifecycleDispatchPlan } from "#lib/domain/lifecycle";
import { LifecycleCommand, lifecycleTrigger } from "#lib/domain/lifecycle-command";
import {
	MutationReceiptIdentity,
	MutationReceiptIdentityConflict,
	type MutationReceipts,
} from "#modules/mutations/receipts";
import { CatalogDefinitionFingerprint } from "#modules/plugins/runtime-resolver";

import { EntitySaveResult, type EntityMutationOutcome } from "./mutation-outcomes";
import type { EntitiesRepository } from "./repository";

export const PreparedEntityMutation = Schema.Struct({
	entityId: EntityId,
	lifecycle: LifecycleCommand,
	draft: AutomationEntityDraft,
	receipt: MutationReceiptIdentity,
	scopeUserId: Schema.NullOr(UserId),
	before: Schema.NullOr(AutomationEntitySnapshot),
	entitySchemaPluginId: Schema.NullOr(Schema.String),
	requestId: Schema.NullOr(AutomationTrigger.fields.id),
	entitySchemaFingerprint: CatalogDefinitionFingerprint,
	operation: Schema.Literals(["create", "update", "delete"]),
});
export type PreparedMutation = typeof PreparedEntityMutation.Type;

export const snapshot = (entity: ListedEntity) =>
	Schema.decodeUnknownSync(AutomationEntitySnapshot)(entity);
export const draftOf = ({
	id: _id,
	createdAt: _createdAt,
	updatedAt: _updatedAt,
	...draft
}: AutomationEntitySnapshot) => draft;
export const same = (left: unknown, right: unknown) =>
	stableStringify(left) === stableStringify(right);
const conflict = (message: string) =>
	new EntityBadRequest({ reason: { message, code: "mutation-conflict" } });

export const makePersistMutation = <E, R>({
	planner,
	receipts,
	repository,
	validateDraft,
}: {
	repository: EntitiesRepository["Service"];
	planner: LifecyclePlanner["Service"];
	receipts: MutationReceipts["Service"];
	validateDraft: (
		draft: AutomationEntityDraft,
		scopeUserId: UserId | null,
	) => Effect.Effect<Pick<PreparedMutation, "draft" | "entitySchemaFingerprint">, E, R>;
}) =>
	Effect.fnUntraced(function* (
		input: PreparedMutation,
		batch?: { id: string; hasCandidates: boolean; index: number },
	) {
		const replay = yield* receipts
			.lookup(input.receipt, EntitySaveResult)
			.pipe(
				Effect.mapError((error) =>
					error instanceof MutationReceiptIdentityConflict
						? conflict("Command identity was reused with a different entity payload")
						: error,
				),
			);
		if (replay) {
			return { ...replay.result, dispatch: replay.dispatch };
		}
		yield* repository.lockSchemaCatalog();
		const currentSchema = yield* validateDraft(input.draft, input.scopeUserId);
		if (
			!same(currentSchema.entitySchemaFingerprint, input.entitySchemaFingerprint) ||
			!same(currentSchema.draft, input.draft)
		) {
			return yield* conflict("Entity schema changed before the source write committed");
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
			return yield* conflict("Entity scope changed");
		}
		let entity: ListedEntity;
		let outcome: EntityMutationOutcome;
		let changed = false;
		if (input.operation === "create") {
			if (before) {
				if (!same(draftOf(before), input.draft)) {
					return yield* conflict("Command identity was reused with a different entity payload");
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
					return yield* conflict(
						"Provider identity changed while policies ran; resubmit with a new command",
					);
				}
				entity = saved.entity;
				changed = true;
			}
			outcome = before
				? { before, after: before, operation: "noop" }
				: { before: null, operation: "create", after: snapshot(entity) };
		} else {
			if (!before || !same(before, input.before)) {
				return yield* conflict("Entity changed while policies ran; resubmit with a new command");
			}
			if (input.operation === "delete") {
				yield* repository.deleteByIds([input.entityId]);
				const plan = yield* planner.plan({
					trigger: lifecycleTrigger(
						{
							...input.lifecycle,
							causation: {
								...input.lifecycle.causation,
								parentTriggerId: input.requestId ?? input.lifecycle.causation.parentTriggerId,
							},
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
				const dispatch = plan.trigger === null ? [] : [toLifecycleDispatchPlan(plan)];
				outcome = { before, after: before, operation: "noop" as const };
				yield* receipts.insert({
					dispatch,
					identity: input.receipt,
					result: { outcome, entity: before, wasInserted: false },
					...(batch ? { batchId: batch.id, batchIndex: batch.index } : {}),
					...(batch?.hasCandidates
						? {
								evidence: {
									before,
									category: "change",
									resource: "entity",
									operation: "delete",
									...(input.lifecycle.population ? { population: input.lifecycle.population } : {}),
								},
							}
						: {}),
				});
				return {
					dispatch,
					entity: before,
					wasInserted: false,
					outcome: { before, after: before, operation: "noop" as const },
				};
			}
			if (same(draftOf(before), input.draft)) {
				outcome = { before, after: before, operation: "noop" as const };
				yield* receipts.insert({
					dispatch: [],
					identity: input.receipt,
					result: { outcome, entity: before, wasInserted: false },
					...(batch ? { batchId: batch.id, batchIndex: batch.index } : {}),
				});
				return { outcome, dispatch: [], entity: before, wasInserted: false };
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
			changed = true;
		}
		const plan = changed
			? yield* planner.plan({
					trigger: lifecycleTrigger(
						{
							...input.lifecycle,
							causation: {
								...input.lifecycle.causation,
								parentTriggerId: input.requestId ?? input.lifecycle.causation.parentTriggerId,
							},
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
				})
			: null;
		const dispatch = plan?.trigger ? [toLifecycleDispatchPlan(plan)] : [];
		yield* receipts.insert({
			dispatch,
			identity: input.receipt,
			result: { entity, outcome, wasInserted: input.operation === "create" && before === null },
			...(batch ? { batchId: batch.id, batchIndex: batch.index } : {}),
			...(batch?.hasCandidates && outcome.operation !== "noop"
				? {
						evidence:
							outcome.operation === "create"
								? {
										after: outcome.after,
										category: "change" as const,
										resource: "entity" as const,
										operation: "create" as const,
										...(input.lifecycle.population
											? { population: input.lifecycle.population }
											: {}),
									}
								: {
										after: outcome.after,
										before: outcome.before,
										category: "change" as const,
										resource: "entity" as const,
										operation: "update" as const,
										...(input.lifecycle.population
											? { population: input.lifecycle.population }
											: {}),
									},
					}
				: {}),
		});
		return {
			entity,
			outcome,
			dispatch,
			wasInserted: input.operation === "create" && before === null,
		};
	});
