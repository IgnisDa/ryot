import { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationRelationshipSnapshot,
	AutomationTrigger,
	AutomationTriggerPayload,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginMembership } from "@ryot-app/contract/modules/plugins/manifest";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EventsRepository } from "#modules/events/repository";
import { snapshot as relationshipSnapshot } from "#modules/relationships/mutation-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { EntitiesRepository } from "./repository";

type Candidate = Member & { readonly accepts: (membership: PluginMembership) => boolean };

type Member = {
	readonly entityId: EntityId;
	readonly entitySchemaSlug: string;
	readonly entitySchemaPluginId: string;
};

const isKernelCollectionAdd = (event: {
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly eventSchemaPluginId: null | string;
	readonly entitySchemaPluginId: null | string;
}) =>
	event.entitySchemaPluginId === null &&
	event.eventSchemaPluginId === null &&
	event.entitySchemaSlug === "collection" &&
	event.eventSchemaSlug === "add-entity-to-collection";

export class PluginMembershipWrites extends Context.Service<PluginMembershipWrites>()(
	"@ryot-app/kernel-backend/modules/entities/plugin-memberships/PluginMembershipWrites",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const entities = yield* EntitiesRepository;
			const relationships = yield* RelationshipsRepository;
			const events = yield* EventsRepository;
			const schemas = yield* EventSchemaReader;

			const candidatesOf = Effect.fnUntraced(function* (
				userId: UserId,
				payload: AutomationTriggerPayload,
			) {
				if (payload.category !== "change") {
					return [];
				}
				if (payload.resource === "provider-entity-import") {
					return payload.entitySchemaPluginId === null || payload.userId !== userId
						? []
						: [
								{
									entityId: payload.entityId,
									entitySchemaSlug: payload.entitySchemaSlug,
									entitySchemaPluginId: payload.entitySchemaPluginId,
									accepts: (membership: PluginMembership) => membership.join.providerImport,
								},
							];
				}
				if (payload.resource === "entity" && payload.operation === "create") {
					const { after } = payload;
					return after.entitySchemaPluginId === null || after.providerId !== null
						? []
						: [
								{
									entityId: after.id,
									entitySchemaSlug: after.entitySchemaSlug,
									entitySchemaPluginId: after.entitySchemaPluginId,
									accepts: (membership: PluginMembership) =>
										membership.join.entityCreate.includes(after.entitySchemaSlug),
								},
							];
				}
				if (payload.resource !== "event" || payload.operation !== "create") {
					return [];
				}
				const event = payload.after;
				if (isKernelCollectionAdd(event)) {
					const target = event.properties["entityId"];
					if (typeof target !== "string") {
						return [];
					}
					const entity = (yield* entities.getByIdsForUser({
						userId,
						entityIds: [EntityId.make(target)],
					})).get(EntityId.make(target));
					return entity?.entitySchemaPluginId
						? [
								{
									entityId: entity.id,
									entitySchemaSlug: entity.entitySchemaSlug,
									entitySchemaPluginId: entity.entitySchemaPluginId,
									accepts: (membership: PluginMembership) => membership.join.kernelCollectionAdd,
								},
							]
						: [];
				}
				return event.entitySchemaPluginId === null
					? []
					: [
							{
								entityId: event.entityId,
								entitySchemaSlug: event.entitySchemaSlug,
								entitySchemaPluginId: event.entitySchemaPluginId,
								accepts: (membership: PluginMembership) =>
									membership.join.events &&
									event.eventSchemaSlug !== membership.recordEventSchemaSlug &&
									(membership.silentEventProperty === undefined ||
										event.properties[membership.silentEventProperty] !== true),
							},
						];
			});

			const membershipsFor = Effect.fnUntraced(function* (
				userId: UserId,
				pluginIds: ReadonlyArray<string>,
			) {
				const rows = yield* session.run((db) =>
					db
						.select({ pluginId: tables.plugin.id, memberships: tables.pluginRevision.memberships })
						.from(tables.plugin)
						.innerJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.plugin.activeRevisionId),
						)
						.innerJoin(
							tables.pluginInstallation,
							and(
								eq(tables.pluginInstallation.pluginId, tables.plugin.id),
								eq(tables.pluginInstallation.userId, userId),
								isNull(tables.pluginInstallation.uninstalledAt),
								isNull(tables.pluginInstallation.incompatibilityReason),
							),
						)
						.where(
							and(
								eq(tables.plugin.status, "active"),
								inArray(tables.plugin.id, [...pluginIds]),
								isNotNull(tables.pluginRevision.memberships),
							),
						),
				);
				return new Map(rows.map((row) => [row.pluginId, row.memberships ?? []]));
			});

			const recordEvent = Effect.fnUntraced(function* (input: {
				userId: UserId;
				member: Member;
				identity: string;
				occurredAt: string;
				eventSchemaSlug: string;
			}) {
				const scope = {
					entitySchemaPluginId: input.member.entitySchemaPluginId,
					eventSchemaSlug: EventSchemaSlug.make(input.eventSchemaSlug),
					entitySchemaSlug: EntitySchemaSlug.make(input.member.entitySchemaSlug),
				};
				const schema = yield* schemas.getScopeForUser({ ...scope, userId: input.userId });
				if (!schema) {
					return null;
				}
				const created = yield* events
					.createEvent({
						properties: {},
						userId: input.userId,
						eventSchemaName: schema.name,
						entityId: input.member.entityId,
						eventSchemaSlug: scope.eventSchemaSlug,
						propertiesSchema: schema.propertiesSchema,
						eventSchemaPluginId: input.member.entitySchemaPluginId,
						occurredAt: DateTime.toDate(DateTime.makeUnsafe(input.occurredAt)),
						id: EventId.make(`event_0000_${sha256Base64Url(stableStringify([input.identity]))}`),
					})
					.pipe(
						Effect.catchTag(
							"EventReferenceUnavailable",
							(error) => new DbError({ message: error.message }),
						),
					);
				const written = yield* events.getEventSnapshot({
					eventId: created.id,
					userId: input.userId,
				});
				if (!written) {
					return yield* new DbError({ message: "Membership event disappeared" });
				}
				return written.snapshot;
			});

			/** Records a new membership relationship of a member entity as the rule's event, dated at its creation. */
			const recordMembership = Effect.fnUntraced(function* (
				userId: UserId,
				trigger: AutomationTrigger,
				command: LifecycleCommand,
				relationship: AutomationRelationshipSnapshot,
			) {
				const pluginId = relationship.relationshipSchemaPluginId;
				if (pluginId === null) {
					return [];
				}
				const membership = (yield* membershipsFor(userId, [pluginId]))
					.get(pluginId)
					?.find(
						(rule) =>
							rule.recordEventSchemaSlug !== undefined &&
							rule.relationshipSchemaSlug === relationship.relationshipSchemaSlug,
					);
				if (membership?.recordEventSchemaSlug === undefined) {
					return [];
				}
				const source = (yield* entities.getByIdsForUser({
					userId,
					entityIds: [relationship.sourceEntityId],
				})).get(relationship.sourceEntityId);
				if (
					!source ||
					source.entitySchemaPluginId !== pluginId ||
					!membership.memberEntitySchemaSlugs.includes(source.entitySchemaSlug)
				) {
					return [];
				}
				const event = yield* recordEvent({
					userId,
					occurredAt: relationship.createdAt,
					eventSchemaSlug: membership.recordEventSchemaSlug,
					identity: `${trigger.causation.executionId}:${trigger.id}:${membership.slug}`,
					member: {
						entityId: source.id,
						entitySchemaPluginId: pluginId,
						entitySchemaSlug: source.entitySchemaSlug,
					},
				});
				return event
					? [
							yield* lifecycleTrigger(
								command,
								userId,
								{ after: event, resource: "event", category: "change", operation: "create" },
								`${membership.slug}:event`,
							),
						]
					: [];
			});

			const derive = Effect.fn("PluginMembershipWrites.derive")(function* (
				triggers: ReadonlyArray<AutomationTrigger>,
			) {
				const derived: AutomationTrigger[] = [];
				const pending: Array<{
					userId: UserId;
					command: LifecycleCommand;
					candidates: ReadonlyArray<Candidate>;
				}> = [];
				for (const trigger of triggers) {
					const userId = trigger.scopeUserId;
					if (userId === null || trigger.payload === null) {
						continue;
					}
					const command = {
						accountUserId: null,
						occurredAt: trigger.occurredAt,
						itemIdentity: `${trigger.id}:membership`,
						causation: { ...trigger.causation, parentTriggerId: trigger.id },
					};
					const payload = trigger.payload;
					if (
						payload.category === "change" &&
						payload.resource === "relationship" &&
						payload.operation === "create"
					) {
						derived.push(...(yield* recordMembership(userId, trigger, command, payload.after)));
						continue;
					}
					const candidates: ReadonlyArray<Candidate> = yield* candidatesOf(userId, payload);
					if (candidates.length > 0) {
						pending.push({ userId, command, candidates });
					}
				}
				const declaredByUser = new Map<UserId, Effect.Success<ReturnType<typeof membershipsFor>>>();
				for (const userId of new Set(pending.map((entry) => entry.userId))) {
					declaredByUser.set(
						userId,
						yield* membershipsFor(userId, [
							...new Set(
								pending
									.filter((entry) => entry.userId === userId)
									.flatMap((entry) =>
										entry.candidates.map((candidate) => candidate.entitySchemaPluginId),
									),
							),
						]),
					);
				}
				for (const { userId, command, candidates } of pending) {
					const declared = declaredByUser.get(userId);
					if (declared === undefined) {
						continue;
					}
					yield* deriveCandidates(userId, command, candidates, declared, derived);
				}
				return derived;
			});

			const deriveCandidates = Effect.fnUntraced(function* (
				userId: UserId,
				command: LifecycleCommand,
				candidates: ReadonlyArray<Candidate>,
				declared: Effect.Success<ReturnType<typeof membershipsFor>>,
				derived: AutomationTrigger[],
			) {
				for (const candidate of candidates) {
					for (const membership of declared.get(candidate.entitySchemaPluginId) ?? []) {
						if (
							!membership.memberEntitySchemaSlugs.includes(candidate.entitySchemaSlug) ||
							!candidate.accepts(membership)
						) {
							continue;
						}
						const target = yield* entities.findUserEntityWithoutProvenance({
							userId,
							entitySchemaPluginId: candidate.entitySchemaPluginId,
							entitySchemaSlug: EntitySchemaSlug.make(membership.targetEntitySchemaSlug),
						});
						if (!target) {
							continue;
						}
						const identity = {
							userId,
							scope: "user" as const,
							sourceEntityId: candidate.entityId,
							targetEntityId: EntityId.make(target.id),
							relationshipSchemaPluginId: candidate.entitySchemaPluginId,
							relationshipSchemaSlug: RelationshipSchemaSlug.make(
								membership.relationshipSchemaSlug,
							),
						};
						yield* relationships.lockRelationshipMutations([identity]);
						const saved = yield* relationships.createRelationship({ ...identity, properties: {} });
						if (!saved.wasInserted) {
							continue;
						}
						const stored = yield* relationships.findRelationship(identity);
						if (!stored) {
							return yield* new DbError({ message: "Membership relationship disappeared" });
						}
						derived.push(
							yield* lifecycleTrigger(
								command,
								userId,
								{
									category: "change",
									operation: "create",
									resource: "relationship",
									after: yield* relationshipSnapshot(stored),
								},
								`${membership.slug}:${candidate.entityId}`,
							),
						);
					}
				}
				return derived;
			});

			return { derive };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
