import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Data, DateTime, Effect } from "effect";
import { describe } from "vitest";

import { automationTrigger } from "#lib/infrastructure/db/schema/tables/automations";
import { Database } from "#lib/infrastructure/db/service";
import { withRevisionDatabase } from "#modules/plugins/revision.test-support";

import { triggerFixture } from "./lifecycle.test-support";
import { AutomationTriggerRepository } from "./trigger-repository";

class Rollback extends Data.TaggedError("TriggerTestRollback") {}

describe("AutomationTriggerRepository", () => {
	it.effect("round trips strict snapshots, verifies replay and deduplicates recipients", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const repo = yield* AutomationTriggerRepository;
				const trigger = triggerFixture();
				expect(yield* repo.insert(trigger)).toEqual(trigger);
				expect(yield* repo.insert(trigger)).toEqual(trigger);
				expect(
					yield* repo
						.insert({ ...trigger, occurredAt: "2026-09-16T00:00:00.000Z" })
						.pipe(Effect.flip),
				).toMatchObject({ _tag: "DbError" });
				expect(yield* repo.findById(trigger.id)).toEqual(trigger);
				const owner = UserId.make("owner");
				const recipient = UserId.make("recipient");
				yield* repo.insertRecipients(trigger.id, [recipient, owner, owner]);
				expect(yield* repo.insertRecipients(trigger.id, [recipient])).toEqual([
					{ userId: owner, triggerId: trigger.id },
					{ userId: recipient, triggerId: trigger.id },
				]);
				const db = yield* Database;
				yield* db
					.update(automationTrigger)
					.set({
						payload: null,
						payloadPrunedAt: DateTime.toDate(DateTime.makeUnsafe(trigger.createdAt)),
					})
					.where(eq(automationTrigger.id, trigger.id));
				expect(yield* repo.findById(trigger.id)).toEqual({
					...trigger,
					payload: null,
					payloadPrunedAt: trigger.createdAt,
				});
			}).pipe(Effect.provide(AutomationTriggerRepository.layer)),
		),
	);
	it.effect("uses the caller transaction for triggers and recipients", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const repo = yield* AutomationTriggerRepository;
				const db = yield* Database;
				const trigger = triggerFixture("rolled-back");
				yield* db
					.transaction((transaction) =>
						Effect.gen(function* () {
							yield* repo.insert(trigger);
							yield* repo.insertRecipients(trigger.id, [UserId.make("owner")]);
							return yield* new Rollback();
						}).pipe(Effect.provideService(Database, transaction)),
					)
					.pipe(Effect.catchTag("TriggerTestRollback", () => Effect.void));
				expect(yield* repo.findById(trigger.id)).toBeNull();
				expect(yield* repo.listRecipients(trigger.id)).toEqual([]);
			}).pipe(Effect.provide(AutomationTriggerRepository.layer)),
		),
	);
});
