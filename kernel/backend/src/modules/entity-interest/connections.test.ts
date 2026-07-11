import { expect, it } from "@effect/vitest";
import { NotFound } from "@ryot-app/contract/errors";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import { LocalInterestSessions, type LocalInterestSessionEnqueue } from "./connections";

const message = {
	reason: "populated",
	type: "entity-updated",
	entityId: EntityId.make("entity-1"),
} as const;

it.effect("routes updates only to a local interest session", () =>
	Effect.gen(function* () {
		const sessions = yield* LocalInterestSessions;
		const messages: unknown[] = [];
		const enqueue: LocalInterestSessionEnqueue = (received) => messages.push(received);

		yield* sessions.add("session-1", enqueue);
		yield* sessions.enqueue("session-1", message);
		yield* sessions.enqueue("remote-session", message);
		yield* sessions.remove("session-1", enqueue);
		yield* sessions.enqueue("session-1", message);

		expect(messages).toEqual([message]);
	}).pipe(Effect.provide(LocalInterestSessions.layer)),
);

it.effect("claims a session once and preserves the original callback", () =>
	Effect.gen(function* () {
		const sessions = yield* LocalInterestSessions;
		const firstMessages: unknown[] = [];
		const secondMessages: unknown[] = [];
		const first: LocalInterestSessionEnqueue = (received) => firstMessages.push(received);
		const second: LocalInterestSessionEnqueue = (received) => secondMessages.push(received);

		yield* sessions.add("session-1", first);
		const duplicate = yield* Effect.exit(sessions.add("session-1", second));
		yield* sessions.enqueue("session-1", message);

		assertExitFails(duplicate, new NotFound({ message: "Unknown session" }));
		expect(firstMessages).toEqual([message]);
		expect(secondMessages).toEqual([]);
	}).pipe(Effect.provide(LocalInterestSessions.layer)),
);

const first: LocalInterestSessionEnqueue = () => undefined;

it.effect("does not remove a replacement callback from a stale release", () =>
	Effect.gen(function* () {
		const sessions = yield* LocalInterestSessions;
		const messages: unknown[] = [];
		const second: LocalInterestSessionEnqueue = (received) => messages.push(received);

		yield* sessions.add("session-1", first);
		yield* sessions.remove("session-1", first);
		yield* sessions.add("session-1", second);
		yield* sessions.remove("session-1", first);
		yield* sessions.enqueue("session-1", message);

		expect(messages).toEqual([message]);
	}).pipe(Effect.provide(LocalInterestSessions.layer)),
);
