import { reminderReadinessRecipe } from "@ryot-app/ryotql-recipes/reminders";
import { DateTime, Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { setNotificationRuleActive } from "~/fixtures/kernel/automations";
import { createCollection } from "~/fixtures/kernel/collections";
import {
	createNotificationChannel,
	startFakeAppriseServerScoped,
} from "~/fixtures/kernel/notifications";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	cancelReminder,
	createReminder,
	editReminder,
	listReminders,
	reminderSubmission,
	removeReminder,
	runReminderScan,
} from "~/fixtures/kernel/reminders";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("entity reminder commands and delivery", () => {
	it.live(
		"deleting a target clears its scheduled reminder through the entity lifecycle owner",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const provider = yield* startFakeAppriseServerScoped;
				yield* createNotificationChannel(client, {
					channelSpecifics: { key: "local", kind: "apprise", baseUrl: provider.url },
				});
				const entity = yield* createCollection(client);
				yield* createReminder(client, {
					...(yield* reminderSubmission),
					replaces: null,
					timezone: "UTC",
					entityId: entity.id,
					parentEntityId: null,
					message: "Remove with the target",
					dueAt: DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, "1 hour")),
				});
				yield* client.call((c) => c.collections.delete({ payload: { collectionId: entity.id } }));
				yield* runReminderScan(client);
				expect((yield* listReminders(client)).items).toEqual([]);
				expect(provider.requests).toEqual([]);
			}),
	);
	it.live("owns reads, replays submissions and rejects conflicting or stale edits", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const entity = yield* createCollection(client);
			const payload = {
				...(yield* reminderSubmission),
				replaces: null,
				entityId: entity.id,
				parentEntityId: null,
				timezone: "Asia/Kolkata",
				message: "Independent reminder",
				dueAt: DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, 3_600_000)),
			};
			const first = yield* createReminder(client, payload);
			expect(yield* createReminder(client, payload)).toEqual(first);
			const second = yield* createReminder(client, { ...payload, ...(yield* reminderSubmission) });
			expect(second.id).not.toBe(first.id);
			expect((yield* listReminders(other.client)).items).toEqual([]);
			const conflicting = yield* Effect.flip(
				createReminder(client, { ...payload, message: "Changed" }),
			);
			assertTaggedError(conflicting, "ReminderConflict");
			expect(conflicting.reason).toBe("submission-content-conflict");
			const edit = {
				...(yield* reminderSubmission),
				timezone: "UTC",
				message: "Edited",
				dueAt: payload.dueAt,
				revision: first.revision,
			};
			const edited = yield* editReminder(client, first.id, edit);
			expect(yield* editReminder(client, first.id, edit)).toEqual(edited);
			const stale = yield* Effect.flip(
				editReminder(client, first.id, { ...edit, ...(yield* reminderSubmission) }),
			);
			assertTaggedError(stale, "ReminderConflict");
			expect(stale.reason).toBe("stale-revision");
			const foreign = yield* Effect.flip(
				cancelReminder(other.client, first.id, {
					...(yield* reminderSubmission),
					revision: edited.revision,
				}),
			);
			assertTaggedError(foreign, "ReminderNotFound");
			const cancelled = yield* cancelReminder(client, first.id, {
				...(yield* reminderSubmission),
				revision: edited.revision,
			});
			expect(cancelled.sendStarted).toBe(false);
			yield* removeReminder(client, first.id, {
				...(yield* reminderSubmission),
				revision: cancelled.revision,
			});
			expect((yield* listReminders(client)).items.map(({ id }) => id)).toEqual([second.id]);
		}),
	);

	it.live(
		"settles due work from actual provider acceptance without sending an occurrence twice",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const provider = yield* startFakeAppriseServerScoped;
				yield* createNotificationChannel(client, {
					channelSpecifics: { key: "local", kind: "apprise", baseUrl: provider.url },
				});
				const readiness = yield* executeRyotQLRecipe(client, reminderReadinessRecipe());
				expect(readiness.subscriptionEnabled).toBe(true);
				const entity = yield* createCollection(client);
				const created = yield* createReminder(client, {
					...(yield* reminderSubmission),
					replaces: null,
					entityId: entity.id,
					parentEntityId: null,
					message: "Deliver once",
					timezone: "Europe/London",
					dueAt: DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, 2_000)),
				});
				const settled = yield* pollUntil(
					"reminder provider outcome",
					Effect.gen(function* () {
						yield* runReminderScan(client);
						const row = (yield* listReminders(client)).items.find(({ id }) => id === created.id);
						return row?.state === "settled" ? row : null;
					}),
				);
				expect(settled.outcome).toBe("accepted");
				expect(provider.requests).toHaveLength(1);
				yield* runReminderScan(client);
				expect(provider.requests).toHaveLength(1);
				expect(requirePresent(settled.dueAt, "Scheduled instant")).toBeTruthy();
			}),
	);

	it.live("does not replay Not sent work after the user enables a subscription", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const provider = yield* startFakeAppriseServerScoped;
			yield* createNotificationChannel(client, {
				channelSpecifics: { key: "local", kind: "apprise", baseUrl: provider.url },
			});
			const readiness = yield* executeRyotQLRecipe(client, reminderReadinessRecipe());
			const subscriptionId = requirePresent(readiness.subscriptionId, "Reminder subscription");
			yield* setNotificationRuleActive(client, subscriptionId, false);
			const entity = yield* createCollection(client);
			const created = yield* createReminder(client, {
				...(yield* reminderSubmission),
				replaces: null,
				timezone: "UTC",
				entityId: entity.id,
				parentEntityId: null,
				message: "Do not replay",
				dueAt: DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, 2_000)),
			});
			const settled = yield* pollUntil(
				"disabled reminder subscription outcome",
				Effect.gen(function* () {
					yield* runReminderScan(client);
					const row = (yield* listReminders(client)).items.find(({ id }) => id === created.id);
					return row?.state === "settled" ? row : null;
				}),
			);
			expect(settled).toMatchObject({ outcome: "not-sent", reason: "subscription-disabled" });
			yield* setNotificationRuleActive(client, subscriptionId, true);
			yield* runReminderScan(client);
			expect(provider.requests).toEqual([]);
		}),
	);
});
