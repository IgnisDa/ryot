import {
	AutomationEntityDraft,
	type AutomationEntityChangePayload,
	AutomationEntitySnapshot,
	AutomationTrigger,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { EntityBadRequest, type ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Schema } from "effect";

import { toLifecycleDispatchPlan, type LifecyclePlanner } from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import {
	MutationReceiptIdentity,
	MutationReceiptIdentityConflict,
	type MutationReceipts,
} from "#modules/mutations/receipts";
import { CatalogDefinitionFingerprint } from "#modules/plugins/runtime-resolver";

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

export const makePersistMutation = <E, R, Result>({
	planner,
	receipts,
	resultOf,
	repository,
	resultCodec,
	validateDraft,
}: {
	repository: EntitiesRepository["Service"];
	planner: LifecyclePlanner["Service"];
	receipts: MutationReceipts["Service"];
	resultCodec: Schema.Codec<Result, unknown>;
	resultOf: (entity: ListedEntity, wasInserted: boolean) => Result;
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
			.lookup(input.receipt, resultCodec)
			.pipe(
				Effect.mapError((error) =>
					error instanceof MutationReceiptIdentityConflict
						? conflict("Command identity was reused with a different entity payload")
						: error,
				),
			);
		if (replay) {
			return { result: replay.result, dispatch: replay.dispatch };
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
		let evidence: AutomationEntityChangePayload | undefined;
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
			}
			if (before === null) {
				evidence = {
					category: "change",
					resource: "entity",
					operation: "create",
					after: snapshot(entity),
				};
			}
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
				const result = resultOf(before, false);
				yield* receipts.insert({
					result,
					dispatch,
					identity: input.receipt,
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
				return { result, dispatch };
			}
			if (same(draftOf(before), input.draft)) {
				const result = resultOf(before, false);
				yield* receipts.insert({
					result,
					dispatch: [],
					identity: input.receipt,
					...(batch ? { batchId: batch.id, batchIndex: batch.index } : {}),
				});
				return { result, dispatch: [] };
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
			evidence = {
				before,
				category: "change",
				resource: "entity",
				operation: "update",
				after: snapshot(entity),
			};
		}
		const change = evidence
			? {
					...evidence,
					...(input.lifecycle.population ? { population: input.lifecycle.population } : {}),
				}
			: undefined;
		const plan = change
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
						change,
					),
				})
			: null;
		const dispatch = plan?.trigger ? [toLifecycleDispatchPlan(plan)] : [];
		const result = resultOf(entity, input.operation === "create" && before === null);
		yield* receipts.insert({
			result,
			dispatch,
			identity: input.receipt,
			...(batch ? { batchId: batch.id, batchIndex: batch.index } : {}),
			...(batch?.hasCandidates && change ? { evidence: change } : {}),
		});
		return { result, dispatch };
	});
