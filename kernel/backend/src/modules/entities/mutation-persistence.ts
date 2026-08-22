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
import { LifecycleCommand, lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { CatalogDefinitionFingerprint } from "#modules/plugins/runtime-resolver";

import type { EntityMutationOutcome } from "./mutation-outcomes";
import type { EntitiesRepository } from "./repository";

export const PreparedEntityMutation = Schema.Struct({
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
	repository,
	validateDraft,
}: {
	repository: EntitiesRepository["Service"];
	planner: LifecyclePlanner["Service"];
	validateDraft: (
		draft: AutomationEntityDraft,
		scopeUserId: UserId | null,
	) => Effect.Effect<Pick<PreparedMutation, "draft" | "entitySchemaFingerprint">, E, R>;
}) =>
	Effect.fnUntraced(function* (input: PreparedMutation) {
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
			outcome = { before: null, operation: "create", after: snapshot(entity) };
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
		return { plan, entity, outcome, wasInserted: input.operation === "create" && before === null };
	});
