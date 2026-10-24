import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	NotificationAdmissionConflictError,
	NotificationAdmissionUnavailableError,
} from "@ryot-app/contract/modules/notifications/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { MutationReceipts } from "#modules/mutations/receipts";
import { makeRevisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { makeAppConfigLayer, makeWorkflowEngine } from "#testing/effect";

import { NotificationAdmissions } from "./admission";
import { deliverEnabledChannels } from "./deliver-enabled-channels";
import { NotificationDeliveryError, NotificationDeliveryService } from "./delivery";
import { NotificationDeliveryRepository } from "./delivery-repository";
import type { NotificationAdmission } from "./ledger";
import { NOTIFICATION_BATCH_SIZE, NOTIFICATION_CHANNEL_LIMIT } from "./ledger";
import { NotificationsRepository } from "./repository";
import { NotificationSourcePolicy } from "./source-policy";

const owner = UserId.make("owner");
const accountGeneration = { userId: owner, token: "test-account-generation" };
const admissionInput = (sourceKey: string): NotificationAdmission => ({
	sourceKey,
	userId: owner,
	accountGeneration,
	sourceRunId: "run-1",
	sourceSubmittedAt: null,
	request: { kind: "message", message: "A message" },
});

const freshInput = Effect.fnUntraced(function* (sourceKey: string) {
	const session = yield* DatabaseSession;
	const id = UserId.make(crypto.randomUUID());
	yield* session.run((db) =>
		db
			.insert(user)
			.values({
				id,
				name: "Recipient",
				email: `${id}@example.test`,
				accountGeneration: accountGeneration.token,
			}),
	);
	return {
		...admissionInput(sourceKey),
		userId: id,
		accountGeneration: { ...accountGeneration, userId: id },
	};
});

class DeliveryEvidence extends Context.Service<
	DeliveryEvidence,
	{
		readonly sent: Effect.Effect<ReadonlyArray<string>>;
		readonly dispatches: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/DeliveryEvidence") {}

const recordingTransports = Layer.effectContext(
	Effect.gen(function* () {
		const sent = yield* Ref.make<ReadonlyArray<string>>([]);
		const dispatches = yield* Ref.make<ReadonlyArray<string>>([]);
		const send = ({
			channelSpecifics,
		}: Parameters<NotificationDeliveryService["Service"]["prepare"]>[0]) =>
			Effect.gen(function* () {
				yield* Ref.update(sent, (all) => [...all, channelSpecifics.kind]);
				if (channelSpecifics.kind === "telegram") {
					return yield* new NotificationDeliveryError({ outcome: "failed", message: "Rejected" });
				}
				return yield* Effect.void;
			});
		return Context.make(NotificationDeliveryService, {
			prepare: (input) => Effect.succeed({ execute: send(input) }),
		}).pipe(
			Context.add(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) =>
						Ref.update(dispatches, (all) => [...all, options.executionId]).pipe(
							Effect.as(options.executionId),
						),
				}),
			),
			Context.add(DeliveryEvidence, { sent: Ref.get(sent), dispatches: Ref.get(dispatches) }),
		);
	}),
);

const dependencies = Layer.mergeAll(
	NotificationDeliveryRepository.layer,
	NotificationsRepository.layer,
	MutationReceipts.layer,
	Layer.succeed(NotificationSourcePolicy, { authorize: () => Effect.succeed(true) }),
).pipe(Layer.provideMerge(makeRevisionDatabaseLayer(4)));
const services = NotificationAdmissions.layer.pipe(
	Layer.provideMerge(dependencies),
	Layer.provideMerge(recordingTransports),
	Layer.provideMerge(makeAppConfigLayer()),
);

layer(services)((test) => {
	test.effect("recovers keyset pages without repeatedly dispatching the same pending rows", () =>
		Effect.gen(function* () {
			const submission = yield* freshInput("pages");
			yield* (yield* NotificationsRepository).createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const admissions = yield* NotificationAdmissions;
			const admitted = yield* Effect.forEach(
				Array.from({ length: NOTIFICATION_BATCH_SIZE + 1 }, (_, index) => index),
				(index) => admissions.admit({ ...submission, sourceKey: `pages-${index}` }),
			);
			const evidence = yield* DeliveryEvidence;
			const before = (yield* evidence.dispatches).length;
			yield* admissions.recover();
			const recovered = (yield* evidence.dispatches).slice(before);
			for (const occurrence of admitted) {
				expect(recovered.filter((id) => id.startsWith(`${occurrence.id}-recovery-`))).toHaveLength(
					1,
				);
			}
			const dispatched = (yield* evidence.dispatches).length;
			yield* admissions.recover();
			expect((yield* evidence.dispatches).length).toBe(dispatched);
		}),
	);
	test.effect("defers capacity overflow without consuming the source identity", () =>
		Effect.gen(function* () {
			const submission = yield* freshInput("capacity");
			const channels = yield* NotificationsRepository;
			const selected = yield* Effect.forEach(
				Array.from({ length: NOTIFICATION_CHANNEL_LIMIT + 1 }, (_, index) => index),
				(index) =>
					channels.createForUser({
						isDisabled: false,
						userId: submission.userId,
						channelSpecifics: { kind: "ntfy", topic: `topic-${index}` },
					}),
				{ concurrency: 4 },
			);
			const admissions = yield* NotificationAdmissions;
			const result = yield* admissions.admit(submission).pipe(Effect.exit);
			assertExitFails(
				result,
				new NotificationAdmissionUnavailableError({
					reason: { code: "channel-capacity", limit: NOTIFICATION_CHANNEL_LIMIT },
				}),
			);
			const last = selected.at(-1);
			if (last) {
				yield* channels.updateForUser({
					channelId: last.id,
					userId: submission.userId,
					body: { isDisabled: true },
				});
			}
			const admitted = yield* admissions.admit(submission);
			expect(yield* (yield* NotificationDeliveryRepository).deliveries(admitted.id)).toHaveLength(
				NOTIFICATION_CHANNEL_LIMIT,
			);
		}),
	);
	test.effect("records a definite preparation failure without a Sending claim", () =>
		Effect.gen(function* () {
			const submission = yield* freshInput("preparation-failure");
			yield* (yield* NotificationsRepository).createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "email", recipient: "test@example.test" },
			});
			const admitted = yield* (yield* NotificationAdmissions).admit(submission);
			yield* deliverEnabledChannels({
				notificationId: admitted.id,
				executionId: "unconfigured",
				accountGeneration: submission.accountGeneration,
			}).pipe(
				Effect.provideService(NotificationDeliveryService, {
					prepare: () =>
						Effect.fail(
							new NotificationDeliveryError({
								outcome: "failed",
								message: "SMTP is not configured",
							}),
						),
				}),
			);
			const ledger = yield* NotificationDeliveryRepository;
			expect((yield* ledger.find(admitted.id))?.outcome).toBe("failed");
			expect((yield* ledger.deliveries(admitted.id))[0]).toMatchObject({
				attemptId: null,
				status: "failed",
				reason: "preparation-failed",
			});
		}),
	);
	test.effect("preserves partial success across independent channels", () =>
		Effect.gen(function* () {
			const submission = yield* freshInput("partial");
			const channels = yield* NotificationsRepository;
			yield* channels.createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			yield* channels.createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { chatId: "chat", kind: "telegram", botToken: "secret" },
			});
			const admitted = yield* (yield* NotificationAdmissions).admit(submission);
			yield* deliverEnabledChannels({
				executionId: "partial",
				notificationId: admitted.id,
				accountGeneration: submission.accountGeneration,
			});
			const ledger = yield* NotificationDeliveryRepository;
			expect((yield* ledger.find(admitted.id))?.outcome).toBe("partial");
			expect((yield* ledger.deliveries(admitted.id)).map(({ status }) => status).sort()).toEqual([
				"accepted",
				"failed",
			]);
		}),
	);
	test.effect(
		"skips disabled and deleted channels while preserving historical channel identity",
		() =>
			Effect.gen(function* () {
				const submission = yield* freshInput("removed-channels");
				const channels = yield* NotificationsRepository;
				const disabled = yield* channels.createForUser({
					isDisabled: false,
					userId: submission.userId,
					channelSpecifics: { kind: "ntfy", topic: "topic" },
				});
				const deleted = yield* channels.createForUser({
					isDisabled: false,
					userId: submission.userId,
					channelSpecifics: { chatId: "chat", kind: "telegram", botToken: "secret" },
				});
				const admitted = yield* (yield* NotificationAdmissions).admit(submission);
				yield* channels.updateForUser({
					channelId: disabled.id,
					userId: submission.userId,
					body: { isDisabled: true },
				});
				yield* channels.deleteForUser({ channelId: deleted.id, userId: submission.userId });
				const before = (yield* (yield* DeliveryEvidence).sent).length;
				yield* deliverEnabledChannels({
					executionId: "removed",
					notificationId: admitted.id,
					accountGeneration: submission.accountGeneration,
				});
				const ledger = yield* NotificationDeliveryRepository;
				expect((yield* (yield* DeliveryEvidence).sent).length).toBe(before);
				expect((yield* ledger.find(admitted.id))?.outcome).toBe("not-sent");
				const results = yield* ledger.deliveries(admitted.id);
				expect(results.find((row) => row.channelId === disabled.id)).toMatchObject({
					attemptId: null,
					status: "skipped",
					reason: "channel-disabled",
				});
				expect(results.find((row) => row.channelId === deleted.id)).toMatchObject({
					attemptId: null,
					status: "skipped",
					reason: "channel-deleted",
					description: deleted.description,
				});
			}),
	);
	test.effect("sends when a disabled channel is re-enabled before its claim", () =>
		Effect.gen(function* () {
			const submission = yield* freshInput("reenabled-before-claim");
			const channels = yield* NotificationsRepository;
			const channel = yield* channels.createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const admitted = yield* (yield* NotificationAdmissions).admit(submission);
			yield* channels.updateForUser({
				channelId: channel.id,
				userId: submission.userId,
				body: { isDisabled: true },
			});
			const evidence = yield* DeliveryEvidence;
			const before = (yield* evidence.sent).length;
			yield* deliverEnabledChannels({
				notificationId: admitted.id,
				executionId: "reenabled-before-claim",
				accountGeneration: submission.accountGeneration,
			}).pipe(
				Effect.provideService(NotificationsRepository, {
					...channels,
					findForUser: (input) =>
						Effect.gen(function* () {
							const captured = yield* channels.findForUser(input);
							if (captured?.isDisabled) {
								yield* channels.updateForUser({
									userId: input.userId,
									channelId: input.channelId,
									body: { isDisabled: false },
								});
							}
							return captured;
						}),
				}),
			);
			const ledger = yield* NotificationDeliveryRepository;
			expect((yield* evidence.sent).length - before).toBe(1);
			expect((yield* ledger.find(admitted.id))?.outcome).toBe("accepted");
			expect((yield* ledger.deliveries(admitted.id))[0]?.status).toBe("accepted");
		}),
	);
	test.effect("marks server-disabled delivery Not sent instead of Accepted", () =>
		Effect.gen(function* () {
			const submission = yield* freshInput("server-disabled");
			yield* (yield* NotificationsRepository).createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const admitted = yield* (yield* NotificationAdmissions).admit(submission);
			const before = (yield* (yield* DeliveryEvidence).sent).length;
			const config = yield* AppConfig;
			yield* deliverEnabledChannels({
				executionId: "disabled",
				notificationId: admitted.id,
				accountGeneration: submission.accountGeneration,
			}).pipe(
				Effect.provideService(AppConfig, {
					...config,
					server: { ...config.server, disableNotifications: true },
				}),
			);
			const ledger = yield* NotificationDeliveryRepository;
			expect((yield* ledger.find(admitted.id))?.outcome).toBe("not-sent");
			expect((yield* ledger.deliveries(admitted.id))[0]).toMatchObject({
				attemptId: null,
				status: "skipped",
				reason: "server-disabled",
			});
			expect((yield* (yield* DeliveryEvidence).sent).length).toBe(before);
		}),
	);
	test.effect(
		"deduplicates concurrent admissions, rejects changed content, and preserves the selected channel set",
		() =>
			Effect.gen(function* () {
				const admissions = yield* NotificationAdmissions;
				const channels = yield* NotificationsRepository;
				const ledger = yield* NotificationDeliveryRepository;
				const submission = yield* freshInput("concurrent");
				const first = yield* channels.createForUser({
					isDisabled: false,
					userId: submission.userId,
					channelSpecifics: { kind: "ntfy", topic: "topic" },
				});
				const results = yield* Effect.all(
					[admissions.admit(submission), admissions.admit(submission)],
					{ concurrency: 2 },
				);
				expect(results[0]).toEqual(results[1]);
				const admitted = results[0];
				yield* channels.createForUser({
					isDisabled: false,
					userId: submission.userId,
					channelSpecifics: { chatId: "chat", kind: "telegram", botToken: "secret" },
				});
				expect((yield* ledger.deliveries(admitted.id)).map((row) => row.channelId)).toEqual([
					first.id,
				]);
				const conflict = yield* admissions
					.admit({ ...submission, request: { kind: "message", message: "Changed" } })
					.pipe(Effect.exit);
				assertExitFails(
					conflict,
					new NotificationAdmissionConflictError({ reason: { code: "source-content-conflict" } }),
				);
				const before = (yield* (yield* DeliveryEvidence).sent).length;
				yield* Effect.all(
					[
						deliverEnabledChannels({
							executionId: "first",
							notificationId: admitted.id,
							accountGeneration: submission.accountGeneration,
						}),
						deliverEnabledChannels({
							notificationId: admitted.id,
							executionId: "concurrent-replay",
							accountGeneration: submission.accountGeneration,
						}),
					],
					{ concurrency: 2 },
				);
				yield* deliverEnabledChannels({
					executionId: "replay",
					notificationId: admitted.id,
					accountGeneration: submission.accountGeneration,
				});
				expect((yield* (yield* DeliveryEvidence).sent).slice(before)).toEqual(["ntfy"]);
				expect((yield* ledger.find(admitted.id))?.outcome).toBe("accepted");
			}),
	);
	test.effect("retries a failed outcome write without repeating the provider request", () =>
		Effect.gen(function* () {
			const submission = yield* freshInput("persist-retry");
			yield* (yield* NotificationsRepository).createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const admitted = yield* (yield* NotificationAdmissions).admit(submission);
			const ledger = yield* NotificationDeliveryRepository;
			const writes = yield* Ref.make(0);
			const before = (yield* (yield* DeliveryEvidence).sent).length;
			yield* deliverEnabledChannels({
				notificationId: admitted.id,
				executionId: "persist-retry",
				accountGeneration: submission.accountGeneration,
			}).pipe(
				Effect.provideService(NotificationDeliveryRepository, {
					...ledger,
					finishAttempt: (input) =>
						Effect.gen(function* () {
							const attempt = yield* Ref.getAndUpdate(writes, (count) => count + 1);
							if (attempt === 0) {
								return yield* new DbError({ message: "Persistence temporarily unavailable" });
							}
							return yield* ledger.finishAttempt(input);
						}),
				}),
				TestClock.withLive,
			);
			expect(yield* Ref.get(writes)).toBe(2);
			expect((yield* (yield* DeliveryEvidence).sent).length - before).toBe(1);
			expect((yield* ledger.find(admitted.id))?.outcome).toBe("accepted");
		}),
	);
	test.effect("recovers an admission committed before workflow dispatch failed", () =>
		Effect.gen(function* () {
			const submission = yield* freshInput("lost-dispatch");
			yield* (yield* NotificationsRepository).createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const disconnected = yield* NotificationAdmissions.make.pipe(
				Effect.provideService(
					WorkflowEngine,
					makeWorkflowEngine({
						execute: () => Effect.fail(new DbError({ message: "Dispatcher unavailable" })),
					}),
				),
			);
			const admitted = yield* disconnected.admit(submission);
			const ledger = yield* NotificationDeliveryRepository;
			expect((yield* ledger.find(admitted.id))?.state).toBe("admitted");
			yield* (yield* NotificationAdmissions).recover();
			expect(
				(yield* (yield* DeliveryEvidence).dispatches).some((id) =>
					id.startsWith(`${admitted.id}-recovery-`),
				),
			).toBe(true);
			yield* deliverEnabledChannels({
				executionId: "recovered",
				notificationId: admitted.id,
				accountGeneration: submission.accountGeneration,
			});
			expect((yield* ledger.find(admitted.id))?.outcome).toBe("accepted");
		}),
	);
	test.effect("settles no-channel work as Not sent without inventing a successful send", () =>
		Effect.gen(function* () {
			const admissions = yield* NotificationAdmissions;
			const ledger = yield* NotificationDeliveryRepository;
			const result = yield* admissions.admit(yield* freshInput("empty"));
			expect((yield* ledger.find(result.id))?.outcome).toBe("not-sent");
			expect(yield* ledger.deliveries(result.id)).toEqual([]);
		}),
	);
	test.effect(
		"does not reuse an existing Sending claim and marks only expired attempts Unknown",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const admissions = yield* NotificationAdmissions;
				const channels = yield* NotificationsRepository;
				const ledger = yield* NotificationDeliveryRepository;
				const submission = yield* freshInput("interrupted");
				const account = submission.accountGeneration;
				const channel = yield* channels.createForUser({
					isDisabled: false,
					userId: submission.userId,
					channelSpecifics: { kind: "ntfy", topic: "interrupted" },
				});
				const admitted = yield* admissions.admit(submission);
				const now = yield* DateTime.nowAsDate;
				const claim = yield* session.transaction(
					ledger.claim({
						now,
						disabled: false,
						channelId: channel.id,
						attemptId: "original",
						sourceAuthorized: true,
						notificationId: admitted.id,
					}),
				);
				expect(claim).not.toBeNull();
				const before = (yield* (yield* DeliveryEvidence).sent).length;
				yield* deliverEnabledChannels({
					executionId: "recovery",
					accountGeneration: account,
					notificationId: admitted.id,
				});
				expect((yield* ledger.deliveries(admitted.id))[0]?.status).toBe("sending");
				yield* TestClock.adjust("61 seconds");
				yield* admissions.recover();
				expect((yield* ledger.find(admitted.id))?.outcome).toBe("unknown");
				yield* deliverEnabledChannels({
					accountGeneration: account,
					notificationId: admitted.id,
					executionId: "after-expiry",
				});
				expect((yield* (yield* DeliveryEvidence).sent).length).toBe(before);
				yield* session.transaction(
					ledger.finishAttempt({
						diagnostic: null,
						status: "accepted",
						channelId: channel.id,
						attemptId: "original",
						notificationId: admitted.id,
						now: yield* DateTime.nowAsDate,
					}),
				);
				expect((yield* ledger.deliveries(admitted.id))[0]?.status).toBe("unknown");
			}),
	);
	test.effect("keeps compact source evidence when detailed diagnostics expire", () =>
		Effect.gen(function* () {
			const ledger = yield* NotificationDeliveryRepository;
			const session = yield* DatabaseSession;
			const submission = yield* freshInput("retention");
			const channel = yield* (yield* NotificationsRepository).createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const admitted = yield* (yield* NotificationAdmissions).admit(submission);
			const now = yield* DateTime.nowAsDate;
			yield* session.transaction(
				ledger.claim({
					now,
					disabled: false,
					channelId: channel.id,
					attemptId: "retained",
					sourceAuthorized: true,
					notificationId: admitted.id,
				}),
			);
			yield* session.transaction(
				ledger.finishAttempt({
					now,
					status: "unknown",
					channelId: channel.id,
					attemptId: "retained",
					diagnostic: "Unknown",
					notificationId: admitted.id,
				}),
			);
			yield* session.transaction(ledger.settle(admitted.id, now));
			yield* TestClock.adjust("31 days");
			yield* ledger.pruneDiagnostics(yield* DateTime.nowAsDate);
			expect((yield* ledger.deliveries(admitted.id))[0]).toMatchObject({
				diagnostic: null,
				status: "unknown",
				attemptId: "retained",
			});
			expect((yield* (yield* NotificationAdmissions).admit(submission)).id).toBe(admitted.id);
		}),
	);
	test.effect("rejects stale workflow payloads after account generation changes", () =>
		Effect.gen(function* () {
			const admissions = yield* NotificationAdmissions;
			const submission = yield* freshInput("retired");
			yield* (yield* NotificationsRepository).createForUser({
				isDisabled: false,
				userId: submission.userId,
				channelSpecifics: { kind: "ntfy", topic: "topic" },
			});
			const admitted = yield* admissions.admit(submission);
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.update(user)
					.set({ accountGeneration: "new-generation" })
					.where(eq(user.id, submission.userId)),
			);
			const result = yield* deliverEnabledChannels({
				executionId: "stale",
				notificationId: admitted.id,
				accountGeneration: submission.accountGeneration,
			}).pipe(Effect.exit);
			assertExitFails(
				result,
				new DbError({ message: "Mutation command belongs to a retired account" }),
			);
		}),
	);
});
