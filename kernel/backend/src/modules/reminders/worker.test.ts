import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { ReminderInvalid } from "@ryot-app/contract/modules/reminders/schemas";
import { AutomationExecutionId, EntityId, ReminderId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Context, DateTime, Deferred, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecyclePlannerServiceLive } from "#modules/automations/layer";
import { withLifecycleDispatch } from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { manifest as notificationManifest } from "#modules/definitions/kernel-scripts/notification.sandbox";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityUserDataAttachments } from "#modules/entities/user-data/attachments";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { NotificationAdmissions } from "#modules/notifications/admission";
import { deliverEnabledChannels } from "#modules/notifications/deliver-enabled-channels";
import { NotificationDeliveryService } from "#modules/notifications/delivery";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { makeRevisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer, makeWorkflowEngine } from "#testing/effect";

import { ReminderEntityLifecycleLive } from "./entity-lifecycle";
import { ReminderNotificationSourcePolicyLive } from "./layer";
import { reminderTestInput } from "./reminders.test-support";
import { RemindersRepository } from "./repository";
import { RemindersService } from "./service";
import { ReminderWorker } from "./worker";

class WorkerEvidence extends Context.Service<
	WorkerEvidence,
	{
		sends: Effect.Effect<number>;
		dispatches: Effect.Effect<ReadonlyArray<{ runId: string; inTransaction: boolean }>>;
	}
>()("test/WorkerEvidence") {}

const execution = Layer.effectContext(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const dispatches = yield* Ref.make<ReadonlyArray<{ runId: string; inTransaction: boolean }>>(
			[],
		);
		const sends = yield* Ref.make(0);
		return Context.make(
			LifecycleExecution,
			withLifecycleDispatch(
				{
					executePolicy: () => Effect.die("Unexpected policy"),
					skipQueuedPolicies: () => Effect.die("Unexpected policy"),
					after: ({ runs }) =>
						Effect.gen(function* () {
							const inTransaction = yield* session.isTransactionActive;
							yield* Ref.update(dispatches, (all) => [
								...all,
								...runs.map((run) => ({ runId: run.id, inTransaction })),
							]);
							return [];
						}),
				},
				session,
			),
		).pipe(
			Context.add(WorkerEvidence, { sends: Ref.get(sends), dispatches: Ref.get(dispatches) }),
			Context.add(NotificationDeliveryService, {
				prepare: () => Effect.succeed({ execute: Ref.update(sends, (count) => count + 1) }),
			}),
		);
	}),
);

const repositories = Layer.mergeAll(
	RemindersRepository.layer,
	MutationReceipts.layer,
	NotificationDeliveryRepository.layer,
	NotificationsRepository.layer,
	EntitiesRepository.layer,
	EntityUserDataGraphRepository.layer,
	RelationshipsRepository.layer,
	AutomationRunRepository.layer,
	AutomationTriggerRepository.layer,
	EventsRepository.layer,
);
const dependencies = SignalEmissionService.layer.pipe(
	Layer.provideMerge(LifecyclePlannerServiceLive),
	Layer.provideMerge(execution),
	Layer.provideMerge(repositories),
	Layer.provideMerge(makeRevisionDatabaseLayer(4)),
	Layer.provideMerge(makeAppConfigLayer()),
);
const services = Layer.mergeAll(
	RemindersService.layer,
	ReminderWorker.layer,
	NotificationAdmissions.layer,
	EntityUserDataService.layer,
).pipe(
	Layer.provideMerge(ReminderEntityLifecycleLive),
	Layer.provide(
		Layer.mergeAll(Layer.mock(EventsService)({}), Layer.mock(RelationshipsService)({})),
	),
	Layer.provideMerge(ReminderNotificationSourcePolicyLive),
	Layer.provideMerge(dependencies),
	Layer.provideMerge(Layer.succeed(WorkflowEngine, makeWorkflowEngine())),
);

const enabledInput = Effect.fnUntraced(function* () {
	const input = yield* reminderTestInput();
	const session = yield* DatabaseSession;
	yield* session.transaction(
		Effect.gen(function* () {
			yield* (yield* PluginRepository).persistKernelScript({
				source: "source",
				compiledFormat: 1,
				compiledCode: "code",
				name: notificationManifest.name,
				slug: notificationManifest.slug,
				contentHash: "reminder-kernel-script",
				metadata: { ...emptySandboxExecutionMetadata, ...notificationManifest },
			});
			yield* session.run((db) =>
				db
					.insert(tables.notificationSubscription)
					.values({
						isActive: true,
						userId: input.user.id,
						signalSchemaPluginId: null,
						signalSchemaSlug: "reminder.due",
					}),
			);
		}),
	);
	return input;
});

const lifecycleCommand = (input: Effect.Success<ReturnType<typeof reminderTestInput>>) =>
	rootLifecycleCommand({
		source: "api",
		lane: "interactive",
		itemIdentity: "reminder-lifecycle",
		occurredAt: input.body.submittedAt,
		initiator: { kind: "user", id: input.user.id },
		accountGeneration: input.user.accountGeneration,
		executionId: AutomationExecutionId.make(crypto.randomUUID()),
	});

const processingInput = Effect.fnUntraced(function* () {
	const input = yield* enabledInput();
	yield* (yield* NotificationsRepository).createForUser({
		isDisabled: false,
		userId: input.user.id,
		channelSpecifics: { kind: "ntfy", topic: "topic" },
	});
	const created = yield* (yield* RemindersService).create(input.user, input.body);
	yield* TestClock.adjust("2 hours");
	yield* (yield* ReminderWorker).run();
	const row = yield* (yield* RemindersRepository).findForUser(input.user.id, created.id);
	assert(row?.formatterRunId);
	return {
		...input,
		row,
		admission: {
			userId: input.user.id,
			sourceSubmittedAt: null,
			sourceRunId: row.formatterRunId,
			sourceKey: `${row.formatterRunId}-call`,
			accountGeneration: input.user.accountGeneration,
			request: { kind: "message" as const, message: "Target: A reminder" },
		},
	};
});

layer(services)((test) => {
	test.effect(
		"rejects reminder mutations and delayed deliveries from a retired account generation",
		() =>
			Effect.gen(function* () {
				const input = yield* processingInput();
				const notification = yield* (yield* NotificationAdmissions).admit(input.admission);
				yield* (yield* DatabaseSession).run((db) =>
					db
						.update(tables.user)
						.set({ accountGeneration: "replacement-generation" })
						.where(eq(tables.user.id, input.user.id)),
				);
				const before = yield* (yield* WorkerEvidence).sends;
				assertExitFails(
					yield* deliverEnabledChannels({
						notificationId: notification.id,
						executionId: "retired-reminder-delivery",
						accountGeneration: input.user.accountGeneration,
					}).pipe(Effect.exit),
					new DbError({ message: "Mutation command belongs to a retired account" }),
				);
				assertExitFails(
					yield* (yield* NotificationAdmissions)
						.admit({ ...input.admission, sourceKey: "delayed-retired-call" })
						.pipe(Effect.exit),
					new DbError({ message: "Mutation command belongs to a retired account" }),
				);
				assertExitFails(
					yield* (yield* RemindersService)
						.cancel(input.user, ReminderId.make(input.row.id), {
							revision: input.row.revision,
							idempotencyKey: "retired-cancel",
							submittedAt: input.body.submittedAt,
						})
						.pipe(Effect.exit),
					new DbError({ message: "Mutation command belongs to a retired account" }),
				);
				expect(yield* (yield* WorkerEvidence).sends).toBe(before);
			}),
	);
	test.effect(
		"clears delayed formatter work and retains its cancellation fence after erasing history",
		() =>
			Effect.gen(function* () {
				const input = yield* processingInput();
				yield* (yield* EntityUserDataService).clearEntityUserData(
					input.user,
					input.body.entityId,
					lifecycleCommand(input),
				);
				const stored = yield* (yield* RemindersRepository).findForUser(input.user.id, input.row.id);
				expect(stored).toMatchObject({
					message: null,
					entityId: null,
					entityTitle: null,
					state: "cancelled",
					formatterRunId: input.row.formatterRunId,
				});
				expect(stored?.removedAt).not.toBeNull();
				assertExitFails(
					yield* (yield* NotificationAdmissions).admit(input.admission).pipe(Effect.exit),
					new DbError({ message: "Notification source has been cancelled or settled" }),
				);
			}),
	);
	test.effect(
		"clearing during preparation revokes the queued send before it can claim transport",
		() =>
			Effect.gen(function* () {
				const input = yield* processingInput();
				const notification = yield* (yield* NotificationAdmissions).admit(input.admission);
				const preparing = yield* Deferred.make<void>();
				const resume = yield* Deferred.make<void>();
				const sends = yield* Ref.make(0);
				const send = yield* deliverEnabledChannels({
					notificationId: notification.id,
					executionId: "clear-before-claim",
					accountGeneration: input.user.accountGeneration,
				}).pipe(
					Effect.provideService(NotificationDeliveryService, {
						prepare: () =>
							Effect.gen(function* () {
								yield* Deferred.succeed(preparing, undefined);
								yield* Deferred.await(resume);
								return { execute: Ref.update(sends, (count) => count + 1) };
							}),
					}),
					Effect.forkChild,
				);
				yield* Deferred.await(preparing);
				yield* (yield* EntityUserDataService).clearEntityUserData(
					input.user,
					input.body.entityId,
					lifecycleCommand(input),
				);
				yield* Deferred.succeed(resume, undefined);
				yield* Fiber.join(send);
				expect(yield* Ref.get(sends)).toBe(0);
				expect(
					yield* (yield* NotificationDeliveryRepository).deliveries(notification.id),
				).toMatchObject([{ status: "skipped", reason: "source-cancelled" }]);
			}),
	);
	test.effect(
		"clearing after a send claim preserves its result without allowing a second request",
		() =>
			Effect.gen(function* () {
				const input = yield* processingInput();
				const notification = yield* (yield* NotificationAdmissions).admit(input.admission);
				const sending = yield* Deferred.make<void>();
				const accepted = yield* Deferred.make<void>();
				const sends = yield* Ref.make(0);
				const payload = {
					notificationId: notification.id,
					executionId: "clear-after-claim",
					accountGeneration: input.user.accountGeneration,
				};
				const transport = {
					prepare: () =>
						Effect.succeed({
							execute: Effect.gen(function* () {
								yield* Ref.update(sends, (count) => count + 1);
								yield* Deferred.succeed(sending, undefined);
								yield* Deferred.await(accepted);
							}),
						}),
				};
				const send = yield* deliverEnabledChannels(payload).pipe(
					Effect.provideService(NotificationDeliveryService, transport),
					Effect.forkChild,
				);
				yield* Deferred.await(sending);
				yield* (yield* EntityUserDataService).clearEntityUserData(
					input.user,
					input.body.entityId,
					lifecycleCommand(input),
				);
				yield* Deferred.succeed(accepted, undefined);
				yield* Fiber.join(send);
				yield* deliverEnabledChannels(payload).pipe(
					Effect.provideService(NotificationDeliveryService, transport),
				);
				expect(yield* Ref.get(sends)).toBe(1);
				expect(
					yield* (yield* NotificationDeliveryRepository).deliveries(notification.id),
				).toMatchObject([{ status: "accepted" }]);
			}),
	);
	test.effect(
		"merges independent occurrences without changing admitted messages or occurrence identities",
		() =>
			Effect.gen(function* () {
				const input = yield* processingInput();
				const session = yield* DatabaseSession;
				const destination = EntityId.make(crypto.randomUUID());
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							id: destination,
							name: "Destination",
							userId: input.user.id,
							entitySchemaPluginId: null,
							entitySchemaSlug: "collection",
						}),
				);
				const next = DateTime.formatIso(
					DateTime.addDuration(DateTime.makeUnsafe(input.body.dueAt), "1 day"),
				);
				const other = yield* (yield* RemindersService).create(input.user, {
					...input.body,
					dueAt: next,
					entityId: destination,
					idempotencyKey: "destination-reminder",
					submittedAt: (yield* DateTime.nowAsDate).toISOString(),
				});
				const notification = yield* (yield* NotificationAdmissions).admit(input.admission);
				yield* (yield* EntityUserDataService).mergeEntityUserData(
					input.user,
					{ mergeInto: destination, mergeFrom: input.body.entityId },
					lifecycleCommand(input),
				);
				const reminders = yield* (yield* EntityUserDataAttachments).list({
					userId: input.user.id,
					entityIds: [destination],
				});
				expect(new Set(reminders.map(({ id }) => id))).toEqual(new Set([other.id, input.row.id]));
				expect(
					yield* (yield* RemindersRepository).findForUser(input.user.id, input.row.id),
				).toMatchObject({
					state: "processing",
					entityId: destination,
					triggerId: input.row.triggerId,
					formatterRunId: input.row.formatterRunId,
				});
				expect(
					(yield* (yield* NotificationDeliveryRepository).find(notification.id))?.request,
				).toEqual(input.admission.request);
				expect(yield* (yield* NotificationAdmissions).admit(input.admission)).toEqual(notification);
			}),
	);
	test.effect(
		"crosses due pages and isolates a planning failure without consuming its occurrence",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* enabledInput();
				const service = yield* RemindersService;
				const created = yield* Effect.forEach(
					Array.from({ length: 51 }, (_, index) => index),
					(index) => service.create(user, { ...body, idempotencyKey: `page-${index}` }),
				);
				const first = created[0];
				assert(first);
				const signals = yield* SignalEmissionService;
				const worker = yield* ReminderWorker.make.pipe(
					Effect.provideService(SignalEmissionService, {
						...signals,
						planSignal: (input) =>
							input.command.itemIdentity === first.id
								? Effect.fail(new DbError({ message: "Planning unavailable" }))
								: signals.planSignal(input),
					}),
				);
				yield* TestClock.adjust("2 hours");
				yield* worker.run();
				const repository = yield* RemindersRepository;
				expect(yield* repository.findForUser(user.id, first.id)).toMatchObject({
					revision: 1,
					state: "scheduled",
					formatterRunId: null,
				});
				for (const item of created.slice(1)) {
					expect((yield* repository.findForUser(user.id, item.id))?.state).toBe("processing");
				}
				yield* TestClock.adjust("2 minutes");
				yield* (yield* ReminderWorker).run();
				expect((yield* repository.findForUser(user.id, first.id))?.state).toBe("processing");
			}),
	);
	test.effect("reports no enabled channels without claiming successful delivery", () =>
		Effect.gen(function* () {
			const { user, body } = yield* enabledInput();
			const created = yield* (yield* RemindersService).create(user, body);
			yield* TestClock.adjust("2 hours");
			const now = yield* DateTime.nowAsDate;
			expect(now.getTime()).toBeGreaterThan(Date.parse(body.dueAt));
			const scheduled = yield* (yield* RemindersRepository).findForUser(user.id, created.id);
			expect(scheduled?.dueAt?.getTime()).toBeLessThan(now.getTime());
			expect((yield* (yield* RemindersRepository).listDue(now, null)).length).toBeGreaterThan(0);
			yield* (yield* ReminderWorker).run();
			const repository = yield* RemindersRepository;
			const processing = yield* repository.findForUser(user.id, created.id);
			assert(processing?.formatterRunId);
			yield* (yield* NotificationAdmissions).admit({
				userId: user.id,
				sourceSubmittedAt: null,
				sourceKey: "no-channels",
				sourceRunId: processing.formatterRunId,
				accountGeneration: user.accountGeneration,
				request: { kind: "message", message: "Reminder" },
			});
			yield* TestClock.adjust("2 minutes");
			yield* (yield* ReminderWorker).run();
			expect(yield* repository.findForUser(user.id, created.id)).toMatchObject({
				state: "settled",
				outcome: "not-sent",
				reason: "no-enabled-channels",
			});
		}),
	);
	test.effect(
		"settles missing admission, failed formatters and expired evidence without allowing delayed sends",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* enabledInput();
				const service = yield* RemindersService;
				const created = yield* Effect.forEach(["succeeded", "failed", "expired"], (key) =>
					service.create(user, { ...body, idempotencyKey: key }),
				);
				yield* TestClock.adjust("2 hours");
				yield* (yield* ReminderWorker).run();
				const repository = yield* RemindersRepository;
				const processing = yield* Effect.forEach(created, (item) =>
					repository.findForUser(user.id, item.id),
				);
				const [success, failure, expired] = processing;
				assert(success?.formatterRunId && failure?.formatterRunId && expired?.formatterRunId);
				const successRunId = success.formatterRunId;
				const failureRunId = failure.formatterRunId;
				const expiredRunId = expired.formatterRunId;
				const session = yield* DatabaseSession;
				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(tables.automationRun)
						.set({ finishedAt: now, status: "succeeded" })
						.where(eq(tables.automationRun.id, successRunId)),
				);
				yield* session.run((db) =>
					db
						.update(tables.automationRun)
						.set({ finishedAt: now, status: "failed", nextAttemptAt: null })
						.where(eq(tables.automationRun.id, failureRunId)),
				);
				yield* session.run((db) =>
					db
						.update(tables.automationRun)
						.set({ artifactsExpireAt: now })
						.where(eq(tables.automationRun.id, expiredRunId)),
				);
				yield* TestClock.adjust("2 minutes");
				yield* (yield* ReminderWorker).run();
				for (const [row, reason] of [
					[success, "admission-missing"],
					[failure, "formatter-failed"],
					[expired, "formatter-expired"],
				] as const) {
					expect(yield* repository.findForUser(user.id, row.id)).toMatchObject({
						reason,
						state: "settled",
						outcome: "failed",
					});
					assertExitFails(
						yield* (yield* NotificationAdmissions)
							.admit({
								userId: user.id,
								sourceKey: "delayed",
								sourceSubmittedAt: null,
								sourceRunId: row.formatterRunId,
								accountGeneration: user.accountGeneration,
								request: { kind: "message", message: "Late" },
							})
							.pipe(Effect.exit),
						new DbError({ message: "Notification source has been cancelled or settled" }),
					);
				}
			}),
	);
	test.effect(
		"admits one immutable formatter under concurrent overdue scans and dispatches after commit",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* enabledInput();
				const created = yield* (yield* RemindersService).create(user, body);
				yield* TestClock.adjust("2 hours");
				const worker = yield* ReminderWorker;
				const before = (yield* (yield* WorkerEvidence).dispatches).length;
				yield* Effect.all([worker.run(), worker.run()], { concurrency: 2 });
				const stored = yield* (yield* RemindersRepository).findForUser(user.id, created.id);
				assert(stored?.formatterRunId && stored.triggerId);
				expect(stored).toMatchObject({ revision: 2, state: "processing", message: "A reminder" });
				const evidence = (yield* (yield* WorkerEvidence).dispatches).slice(before);
				expect(evidence.some(({ runId }) => runId === stored.formatterRunId)).toBe(true);
				expect(evidence.every(({ inTransaction }) => !inTransaction)).toBe(true);
				const triggerId = stored.triggerId;
				expect(
					yield* (yield* DatabaseSession).run((db) =>
						db
							.select({ id: tables.automationRun.id })
							.from(tables.automationRun)
							.where(eq(tables.automationRun.triggerId, triggerId)),
					),
				).toEqual([{ id: stored.formatterRunId }]);
				assertExitFails(
					yield* (yield* RemindersService)
						.edit(user, created.id, {
							message: "Changed",
							timezone: body.timezone,
							revision: stored.revision,
							idempotencyKey: "late-edit",
							submittedAt: body.submittedAt,
							dueAt: DateTime.formatIso(
								DateTime.addDuration(DateTime.makeUnsafe(body.dueAt), "1 day"),
							),
						})
						.pipe(Effect.exit),
					new ReminderInvalid({ reason: "invalid-state" }),
				);
			}),
	);
	test.effect.each(["edit", "cancel"] as const)(
		"due/%s race preserves the committed change",
		(action) =>
			Effect.gen(function* () {
				const { user, body } = yield* enabledInput();
				const service = yield* RemindersService;
				const created = yield* service.create(user, body);
				yield* TestClock.adjust("2 hours");
				const repository = yield* RemindersRepository;
				const selected = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const futureDueAt = DateTime.formatIso(
					DateTime.addDuration(DateTime.makeUnsafe(body.dueAt), "1 day"),
				);
				const worker = yield* ReminderWorker.make.pipe(
					Effect.provideService(RemindersRepository, {
						...repository,
						listDue: (now, after) =>
							repository.listDue(now, after).pipe(
								Effect.tap(() => Deferred.succeed(selected, undefined)),
								Effect.tap(() => Deferred.await(release)),
							),
					}),
				);
				const fiber = yield* worker.run().pipe(Effect.forkChild);
				yield* Deferred.await(selected);
				if (action === "edit") {
					yield* service.edit(user, created.id, {
						revision: 1,
						dueAt: futureDueAt,
						timezone: body.timezone,
						idempotencyKey: "race-edit",
						submittedAt: body.submittedAt,
						message: "Edited before admission",
					});
				} else {
					yield* service.cancel(user, created.id, {
						revision: 1,
						idempotencyKey: "race-cancel",
						submittedAt: body.submittedAt,
					});
				}
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(fiber);
				const stored = yield* repository.findForUser(user.id, created.id);
				assert(stored);
				expect(stored).toMatchObject({ revision: 2, triggerId: null, formatterRunId: null });
				if (action === "edit") {
					expect(stored).toMatchObject({
						state: "scheduled",
						timezone: body.timezone,
						message: "Edited before admission",
					});
					expect(stored.dueAt?.toISOString()).toBe(futureDueAt);
				} else {
					expect(stored.state).toBe("cancelled");
				}
			}),
	);
	test.effect(
		"settles a missing subscription as Not sent and never replays it when enabled later",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* reminderTestInput();
				const created = yield* (yield* RemindersService).create(user, body);
				yield* TestClock.adjust("2 hours");
				yield* (yield* ReminderWorker).run();
				const repository = yield* RemindersRepository;
				expect(yield* repository.findForUser(user.id, created.id)).toMatchObject({
					state: "settled",
					outcome: "not-sent",
					reason: "subscription-disabled",
				});
				yield* (yield* DatabaseSession).run((db) =>
					db
						.insert(tables.notificationSubscription)
						.values({
							isActive: true,
							userId: user.id,
							signalSchemaPluginId: null,
							signalSchemaSlug: "reminder.due",
						}),
				);
				yield* (yield* ReminderWorker).run();
				expect((yield* repository.findForUser(user.id, created.id))?.formatterRunId).toBeNull();
			}),
	);
	test.effect(
		"settles from the delivery ledger, not formatter completion, and blocks a later formatter call",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* enabledInput();
				yield* (yield* NotificationsRepository).createForUser({
					userId: user.id,
					isDisabled: false,
					channelSpecifics: { kind: "ntfy", topic: "topic" },
				});
				const created = yield* (yield* RemindersService).create(user, body);
				yield* TestClock.adjust("2 hours");
				yield* (yield* ReminderWorker).run();
				const repository = yield* RemindersRepository;
				const processing = yield* repository.findForUser(user.id, created.id);
				assert(processing?.formatterRunId);
				const input = {
					userId: user.id,
					sourceSubmittedAt: null,
					sourceRunId: processing.formatterRunId,
					accountGeneration: user.accountGeneration,
					sourceKey: `${processing.formatterRunId}-call`,
					request: { kind: "message" as const, message: "Target: A reminder" },
				};
				const notification = yield* (yield* NotificationAdmissions).admit(input);
				expect((yield* repository.findForUser(user.id, created.id))?.state).toBe("processing");
				yield* deliverEnabledChannels({
					executionId: "delivery",
					notificationId: notification.id,
					accountGeneration: user.accountGeneration,
				});
				yield* TestClock.adjust("2 minutes");
				yield* (yield* ReminderWorker).run();
				expect(yield* repository.findForUser(user.id, created.id)).toMatchObject({
					state: "settled",
					outcome: "accepted",
				});
				assertExitFails(
					yield* (yield* NotificationAdmissions)
						.admit({ ...input, sourceKey: "late-new-call" })
						.pipe(Effect.exit),
					new DbError({ message: "Notification source has been cancelled or settled" }),
				);
			}),
	);
	test.effect("cancellation revokes queued delivery and delayed formatter authority", () =>
		Effect.gen(function* () {
			const { user, body } = yield* enabledInput();
			yield* (yield* NotificationsRepository).createForUser({
				userId: user.id,
				isDisabled: false,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const service = yield* RemindersService;
			const created = yield* service.create(user, body);
			yield* TestClock.adjust("2 hours");
			yield* (yield* ReminderWorker).run();
			const processing = yield* (yield* RemindersRepository).findForUser(user.id, created.id);
			assert(processing?.formatterRunId);
			const input = {
				userId: user.id,
				sourceSubmittedAt: null,
				sourceKey: "before-cancel",
				sourceRunId: processing.formatterRunId,
				accountGeneration: user.accountGeneration,
				request: { kind: "message" as const, message: "Target: A reminder" },
			};
			const notification = yield* (yield* NotificationAdmissions).admit(input);
			const before = yield* (yield* WorkerEvidence).sends;
			expect(
				(yield* service.cancel(user, created.id, {
					idempotencyKey: "cancel",
					submittedAt: body.submittedAt,
					revision: processing.revision,
				})).sendStarted,
			).toBe(false);
			yield* deliverEnabledChannels({
				executionId: "after-cancel",
				notificationId: notification.id,
				accountGeneration: user.accountGeneration,
			});
			expect(yield* (yield* WorkerEvidence).sends).toBe(before);
			expect(
				yield* (yield* NotificationDeliveryRepository).deliveries(notification.id),
			).toMatchObject([{ status: "skipped", reason: "source-cancelled" }]);
			assertExitFails(
				yield* (yield* NotificationAdmissions).admit(input).pipe(Effect.exit),
				new DbError({ message: "Notification source has been cancelled or settled" }),
			);
		}),
	);
	test.effect("marks an abandoned send Unknown without acquiring another transport claim", () =>
		Effect.gen(function* () {
			const { user, body } = yield* enabledInput();
			const channel = yield* (yield* NotificationsRepository).createForUser({
				userId: user.id,
				isDisabled: false,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const created = yield* (yield* RemindersService).create(user, body);
			yield* TestClock.adjust("2 hours");
			yield* (yield* ReminderWorker).run();
			const repository = yield* RemindersRepository;
			const processing = yield* repository.findForUser(user.id, created.id);
			assert(processing?.formatterRunId);
			const notification = yield* (yield* NotificationAdmissions).admit({
				userId: user.id,
				sourceSubmittedAt: null,
				sourceKey: "interrupted",
				sourceRunId: processing.formatterRunId,
				accountGeneration: user.accountGeneration,
				request: { kind: "message", message: "Target: A reminder" },
			});
			const ledger = yield* NotificationDeliveryRepository;
			const now = yield* DateTime.nowAsDate;
			yield* (yield* DatabaseSession).transaction(
				ledger.claim({
					now,
					disabled: false,
					channelId: channel.id,
					sourceAuthorized: true,
					attemptId: "abandoned-attempt",
					notificationId: notification.id,
				}),
			);
			yield* TestClock.adjust("2 minutes");
			const before = yield* (yield* WorkerEvidence).sends;
			yield* (yield* ReminderWorker).run();
			expect(yield* repository.findForUser(user.id, created.id)).toMatchObject({
				state: "settled",
				outcome: "unknown",
			});
			yield* deliverEnabledChannels({
				executionId: "recovery",
				notificationId: notification.id,
				accountGeneration: user.accountGeneration,
			});
			expect(yield* (yield* WorkerEvidence).sends).toBe(before);
		}),
	);
});
