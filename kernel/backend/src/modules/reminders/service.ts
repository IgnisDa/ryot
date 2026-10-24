import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	type ChangeReminderBody,
	type CreateReminderBody,
	type EditReminderBody,
	REMINDER_MESSAGE_MAX_LENGTH,
	ReminderCommandResult,
	ReminderConflict,
	ReminderInvalid,
	ReminderNotFound,
	type ReminderSubmission,
} from "@ryot-app/contract/modules/reminders/schemas";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	EntityId,
	ReminderId,
} from "@ryot-app/contract/schema/brands";
import { isNamedTimeZone } from "@ryot-app/contract/schema/time-zone";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Layer, Option } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { mutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";
import { requireOpenSubmission } from "#modules/mutations/submission-window";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";

import { RemindersRepository } from "./repository";

export class RemindersService extends Context.Service<RemindersService>()("RemindersService", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const config = yield* AppConfig;
		const repository = yield* RemindersRepository;
		const receipts = yield* MutationReceipts;
		const plugins = yield* PluginRepository;
		const definitions = yield* DefinitionRepository;
		const entities = yield* EntitiesRepository;
		const graph = yield* EntityUserDataGraphRepository;
		const notifications = yield* NotificationDeliveryRepository;
		const triggers = yield* AutomationTriggerRepository;
		const runs = yield* AutomationRunRepository;
		const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
			session.transaction(work).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
		const commit = Effect.fnUntraced(function* <E, R>(
			user: CurrentUserValue,
			submission: ReminderSubmission,
			kind: string,
			input: unknown,
			write: (receiptId: string) => Effect.Effect<ReminderCommandResult, E, R>,
		) {
			yield* requireOpenSubmission(submission.submittedAt);
			const command = rootLifecycleCommand({
				source: "api",
				itemIdentity: kind,
				lane: "interactive",
				occurredAt: submission.submittedAt,
				initiator: { id: user.id, kind: "user" },
				accountGeneration: user.accountGeneration,
				executionId: AutomationExecutionId.make(
					`reminder-${sha256Base64Url(stableStringify([user.id, user.accountGeneration.token, kind, submission.idempotencyKey]))}`,
				),
			});
			const identity = mutationReceiptIdentity({
				input,
				command,
				commandKind: kind,
				ownerUserId: user.id,
				scopeUserId: user.id,
			});
			return yield* transaction(
				Effect.gen(function* () {
					const prior = yield* receipts
						.lookup(identity, ReminderCommandResult)
						.pipe(
							Effect.catchTag(
								"MutationReceiptIdentityConflict",
								() => new ReminderConflict({ reason: "submission-content-conflict" }),
							),
						);
					if (prior) {
						return prior.result;
					}
					yield* plugins.lockIngestionShared();
					const result = yield* write(identity.id);
					yield* receipts.insert({ result, identity, dispatch: [] });
					return result;
				}),
			);
		});
		const validateSchedule = Effect.fnUntraced(function* (input: {
			dueAt: string;
			message: string;
			timezone: string;
		}) {
			if (input.message.length === 0 || input.message.length > REMINDER_MESSAGE_MAX_LENGTH) {
				return yield* new ReminderInvalid({ reason: "invalid-message" });
			}
			if (!isNamedTimeZone(input.timezone)) {
				return yield* new ReminderInvalid({ reason: "invalid-timezone" });
			}
			const dueAt = DateTime.make(input.dueAt);
			const now = yield* DateTime.now;
			if (
				Option.isNone(dueAt) ||
				DateTime.toEpochMillis(dueAt.value) <= DateTime.toEpochMillis(now)
			) {
				return yield* new ReminderInvalid({ reason: "schedule-not-future" });
			}
			return DateTime.toDate(dueAt.value);
		});
		const validateScope = Effect.fnUntraced(function* (
			user: CurrentUserValue,
			input: Pick<CreateReminderBody, "entityId" | "parentEntityId">,
		) {
			yield* entities.lockUserDataReferences([
				input.entityId,
				...(input.parentEntityId === null ? [] : [input.parentEntityId]),
			]);
			const target = yield* entities.getByIdForUser({ userId: user.id, entityId: input.entityId });
			if (!target) {
				return yield* new ReminderInvalid({ reason: "invalid-scope" });
			}
			const parents = yield* definitions.listUserStateParents(user.id, {
				slug: target.entitySchemaSlug,
				owner: definitionOwner(target.entitySchemaPluginId),
			});
			if (input.parentEntityId === null) {
				if (parents.length > 0) {
					return yield* new ReminderInvalid({ reason: "invalid-scope" });
				}
			} else {
				const parent = yield* entities.getByIdForUser({
					userId: user.id,
					entityId: input.parentEntityId,
				});
				const declaration =
					parent &&
					parents.find(
						(schema) =>
							schema.pluginId === parent.entitySchemaPluginId &&
							schema.slug === parent.entitySchemaSlug,
					);
				if (!parent || !declaration) {
					return yield* new ReminderInvalid({ reason: "invalid-scope" });
				}
				let found = false;
				for (const child of declaration.userState?.children ?? []) {
					if (
						child.entitySchemaSlug === target.entitySchemaSlug &&
						(yield* graph.listChildren({
							child,
							userId: user.id,
							entityId: parent.id,
							pluginId: parent.entitySchemaPluginId,
						})).some(({ id }) => id === target.id)
					) {
						found = true;
					}
				}
				if (!found) {
					return yield* new ReminderInvalid({ reason: "invalid-scope" });
				}
			}
			return target;
		});
		const lockCurrent = Effect.fnUntraced(function* (
			user: CurrentUserValue,
			id: ReminderId,
			revision: number,
		) {
			const captured = yield* repository.findForUser(user.id, id);
			if (captured?.removedAt !== null) {
				return yield* new ReminderNotFound({ id });
			}
			if (captured.revision !== revision) {
				return yield* new ReminderConflict({ reason: "stale-revision" });
			}
			yield* entities.lockUserDataReferences(
				[captured.entityId, captured.parentEntityId]
					.filter((entityId) => entityId !== null)
					.map((entityId) => EntityId.make(entityId)),
			);
			const current = yield* repository.lockForUser(user.id, id);
			if (current?.removedAt !== null) {
				return yield* new ReminderNotFound({ id });
			}
			if (current.revision !== revision) {
				return yield* new ReminderConflict({ reason: "stale-revision" });
			}
			return current;
		});
		const create = Effect.fn("RemindersService.create")(function* (
			user: CurrentUserValue,
			body: CreateReminderBody,
		) {
			const input = { ...body, message: body.message.trim() };
			return yield* commit(user, body, "reminder:create", input, (receiptId) =>
				Effect.gen(function* () {
					const dueAt = yield* validateSchedule(input);
					if (input.replaces !== null) {
						const prior = yield* repository.findForUser(user.id, input.replaces.id);
						if (
							!prior ||
							prior.entityId !== input.entityId ||
							prior.parentEntityId !== input.parentEntityId
						) {
							return yield* new ReminderInvalid({ reason: "invalid-scope" });
						}
					}
					const target = yield* validateScope(user, input);
					const now = yield* DateTime.nowAsDate;
					const id = ReminderId.make(`reminder_${sha256Base64Url(receiptId)}`);
					if (input.replaces !== null) {
						const prior = yield* lockCurrent(user, input.replaces.id, input.replaces.revision);
						if (
							prior.state === "processing" ||
							prior.state === "scheduled" ||
							prior.replacementId !== null ||
							prior.entityId !== input.entityId ||
							prior.parentEntityId !== input.parentEntityId
						) {
							return yield* new ReminderInvalid({ reason: "invalid-state" });
						}
						if (prior.state === "needs-scheduling") {
							yield* repository.update(prior.id, {
								updatedAt: now,
								settledAt: now,
								replacementId: id,
								state: "cancelled",
								reason: "cancelled",
								revision: prior.revision + 1,
							});
						}
					}
					yield* repository.insert({
						id,
						dueAt,
						createdAt: now,
						updatedAt: now,
						userId: user.id,
						reconcileAt: dueAt,
						state: "scheduled",
						message: input.message,
						entityId: input.entityId,
						entityTitle: target.name,
						timezone: input.timezone,
						parentEntityId: input.parentEntityId,
						accountGeneration: user.accountGeneration.token,
					});
					return { id, revision: 1, sendStarted: false };
				}),
			);
		});
		const edit = Effect.fn("RemindersService.edit")(function* (
			user: CurrentUserValue,
			id: ReminderId,
			body: EditReminderBody,
		) {
			const input = { ...body, message: body.message.trim() };
			return yield* commit(user, body, "reminder:edit", { id, ...input }, () =>
				Effect.gen(function* () {
					const current = yield* lockCurrent(user, id, body.revision);
					if (current.state !== "scheduled") {
						return yield* new ReminderInvalid({ reason: "invalid-state" });
					}
					const dueAt = yield* validateSchedule(input);
					yield* repository.update(id, {
						dueAt,
						reconcileAt: dueAt,
						message: input.message,
						timezone: input.timezone,
						revision: current.revision + 1,
						updatedAt: yield* DateTime.nowAsDate,
					});
					return { id, sendStarted: false, revision: current.revision + 1 };
				}),
			);
		});
		const change = Effect.fnUntraced(function* (
			user: CurrentUserValue,
			id: ReminderId,
			body: ChangeReminderBody,
			remove: boolean,
		) {
			return yield* commit(
				user,
				body,
				remove ? "reminder:remove" : "reminder:cancel",
				{ id, ...body },
				() =>
					Effect.gen(function* () {
						const current = yield* lockCurrent(user, id, body.revision);
						if (
							remove
								? current.state !== "settled" && current.state !== "cancelled"
								: current.state === "settled" || current.state === "cancelled"
						) {
							return yield* new ReminderInvalid({ reason: "invalid-state" });
						}
						const now = yield* DateTime.nowAsDate;
						yield* repository.update(id, {
							updatedAt: now,
							revision: current.revision + 1,
							...(remove
								? {
										dueAt: null,
										message: null,
										removedAt: now,
										dispatch: null,
										entityId: null,
										timezone: null,
										entityTitle: null,
										parentEntityId: null,
										originalSchedule: null,
									}
								: { settledAt: now, dispatch: null, state: "cancelled", reason: "cancelled" }),
						});
						if (remove && current.triggerId !== null) {
							const triggerId = AutomationTriggerId.make(current.triggerId);
							yield* triggers.erasePayload(triggerId, now);
							yield* runs.clearHistoryPayloads([triggerId]);
						}
						const sendStarted =
							current.formatterRunId === null
								? false
								: yield* notifications.revokeRun(current.formatterRunId, now, remove);
						return { id, sendStarted, revision: current.revision + 1 };
					}),
			);
		});
		return {
			edit,
			create,
			remove: (user: CurrentUserValue, id: ReminderId, body: ChangeReminderBody) =>
				change(user, id, body, true),
			cancel: (user: CurrentUserValue, id: ReminderId, body: ChangeReminderBody) =>
				change(user, id, body, false),
			deliveryConfiguration: Effect.succeed({
				deliveryEnabled: !config.server.disableNotifications,
				scanSchedule: config.scheduler.frequentCronJobsSchedule,
				dispatchersEnabled: !config.scheduler.disableDispatchers,
			}),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
