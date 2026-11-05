import { expect } from "bun:test";

import {
	ReminderConflict,
	ReminderInvalid,
	ReminderNotFound,
} from "@ryot-app/contract/modules/reminders/schemas";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { AutomationRunRepository } from "#modules/automations/run-repository";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { makeAppConfigLayer } from "#testing/effect";

import { reminderTestInput } from "./reminders.test-support";
import { RemindersRepository } from "./repository";
import { RemindersService } from "./service";

const services = RemindersService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			AutomationRunRepository.layer,
			AutomationTriggerRepository.layer,
			RemindersRepository.layer,
			EntitiesRepository.layer,
			EntityUserDataGraphRepository.layer,
			NotificationDeliveryRepository.layer,
		),
	),
	Layer.provideMerge(revisionDatabaseLayer),
	Layer.provideMerge(makeAppConfigLayer()),
);

layer(services)((test) => {
	test.effect(
		"replays accepted submissions after their due time and preserves independent occurrences",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* reminderTestInput();
				const service = yield* RemindersService;
				const first = yield* service.create(user, body);
				const second = yield* service.create(user, { ...body, idempotencyKey: yield* randomUuid });
				expect(second.id).not.toBe(first.id);
				yield* TestClock.adjust("2 hours");
				expect(yield* service.create(user, { ...body, message: "A reminder" })).toEqual(first);
				assertExitFails(
					yield* service.create(user, { ...body, message: "changed" }).pipe(Effect.exit),
					new ReminderConflict({ reason: "submission-content-conflict" }),
				);
				const stored = yield* (yield* RemindersRepository).findForUser(user.id, first.id);
				expect(stored).toMatchObject({
					state: "scheduled",
					message: "A reminder",
					entityId: body.entityId,
					timezone: "Asia/Kolkata",
				});
			}),
		testTimeout,
	);
	test.effect(
		"serializes concurrent identical creates without producing another occurrence",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* reminderTestInput();
				const service = yield* RemindersService;
				const results = yield* Effect.all(
					[service.create(user, body), service.create(user, body)],
					{ concurrency: 2 },
				);
				expect(results[0]).toEqual(results[1]);
			}),
		testTimeout,
	);
	test.effect(
		"rejects past schedules, invalid timezones and invisible or forged child scopes",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* reminderTestInput();
				const service = yield* RemindersService;
				assertExitFails(
					yield* service.create(user, { ...body, dueAt: body.submittedAt }).pipe(Effect.exit),
					new ReminderInvalid({ reason: "schedule-not-future" }),
				);
				assertExitFails(
					yield* service.create(user, { ...body, timezone: "not/a-zone" }).pipe(Effect.exit),
					new ReminderInvalid({ reason: "invalid-timezone" }),
				);
				assertExitFails(
					yield* service
						.create(user, { ...body, entityId: EntityId.make("missing") })
						.pipe(Effect.exit),
					new ReminderInvalid({ reason: "invalid-scope" }),
				);
				assertExitFails(
					yield* service.create(user, { ...body, parentEntityId: body.entityId }).pipe(Effect.exit),
					new ReminderInvalid({ reason: "invalid-scope" }),
				);
				assertExitFails(
					yield* service.create(user, { ...body, message: "  " }).pipe(Effect.exit),
					new ReminderInvalid({ reason: "invalid-message" }),
				);
			}),
		testTimeout,
	);
	test.effect(
		"settles a matching edit and rejects stale editors",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* reminderTestInput();
				const service = yield* RemindersService;
				const created = yield* service.create(user, body);
				const edit = {
					message: "Edited",
					dueAt: body.dueAt,
					timezone: body.timezone,
					revision: created.revision,
				};
				const edited = yield* service.edit(user, created.id, edit);
				expect(edited.revision).toBe(2);
				expect(yield* service.edit(user, created.id, edit)).toEqual(edited);
				assertExitFails(
					yield* service
						.edit(user, created.id, { ...edit, message: "Edited again" })
						.pipe(Effect.exit),
					new ReminderConflict({ reason: "stale-revision" }),
				);
				const other = {
					...user,
					id: UserId.make("recipient"),
					accountGeneration: { userId: UserId.make("recipient"), token: "test-account-generation" },
				};
				assertExitFails(
					yield* service.cancel(other, created.id, { revision: edited.revision }).pipe(Effect.exit),
					new ReminderNotFound({ id: created.id }),
				);
			}),
		testTimeout,
	);
	test.effect(
		"cancels pending work and removes its authored content while retaining immutable replay",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* reminderTestInput();
				const service = yield* RemindersService;
				const created = yield* service.create(user, body);
				const submission = {
					idempotencyKey: "cancel",
					revision: created.revision,
					submittedAt: body.submittedAt,
				};
				const cancelled = yield* service.cancel(user, created.id, submission);
				expect(cancelled.sendStarted).toBe(false);
				const removed = yield* service.remove(user, created.id, {
					...submission,
					revision: cancelled.revision,
				});
				expect(yield* service.cancel(user, created.id, submission)).toEqual({
					...cancelled,
					revision: removed.revision,
				});
				expect(yield* service.create(user, body)).toEqual(created);
				const stored = yield* (yield* RemindersRepository).findForUser(user.id, created.id);
				assert(stored);
				expect(stored).toMatchObject({
					message: null,
					entityTitle: null,
					state: "cancelled",
					revision: removed.revision,
				});
				expect(stored.removedAt).not.toBeNull();
			}),
		testTimeout,
	);
});
