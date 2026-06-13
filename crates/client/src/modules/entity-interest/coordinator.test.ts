import { expect, it } from "@effect/vitest";
import {
	MAX_INTEREST_ENTITY_IDS,
	type EntityInterestClientMessage,
	type EntityInterestEntityUpdatedMessage,
} from "@ryot-app/contract/modules/entity-interest/messages";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { EntityInterestCoordinator } from "./coordinator";

const settle = Effect.gen(function* () {
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
});

const makeSender =
	(messages: EntityInterestClientMessage[]) => (message: EntityInterestClientMessage) =>
		Effect.sync(() => messages.push(message));

const ignoreUpdate = () => undefined;

it.effect("selects IDs deterministically by highest owner priority", () =>
	Effect.gen(function* () {
		const messages: EntityInterestClientMessage[] = [];
		const overflows: unknown[] = [];
		const coordinator = yield* EntityInterestCoordinator.make({
			onSelectionOverflow: (overflow) => overflows.push(overflow),
		});
		const prefetch = Array.from(
			{ length: MAX_INTEREST_ENTITY_IDS },
			(_, index) => `prefetch-${index.toString().padStart(3, "0")}`,
		);
		yield* coordinator.setInterest("prefetch", prefetch, "prefetch", ignoreUpdate);
		yield* coordinator.setInterest("visible", ["visible", prefetch[0]], "visible", ignoreUpdate);
		yield* coordinator.setInterest("foreground", ["foreground"], "foreground", ignoreUpdate);
		const send = makeSender(messages);
		yield* coordinator.connect(send);

		expect(messages).toEqual([
			{
				revision: 1,
				type: "replace",
				entityIds: ["foreground", ...prefetch.slice(0, -2), "visible"],
			},
		]);
		expect(overflows.at(-1)).toEqual({
			omittedCount: 2,
			counts: { foreground: 1, prefetch: 499, visible: 2 },
		});
	}),
);

it.effect("batches partial waves and sends one incremental command", () =>
	Effect.gen(function* () {
		const messages: EntityInterestClientMessage[] = [];
		const coordinator = yield* EntityInterestCoordinator.make();
		const send = makeSender(messages);
		yield* coordinator.connect(send);
		yield* coordinator.acknowledge(send, 1);
		yield* coordinator.setInterest("results", ["entity-2"], "visible", ignoreUpdate);
		yield* TestClock.adjust("50 millis");
		yield* coordinator.setInterest(
			"results",
			["entity-2", "entity-1", "entity-3"],
			"visible",
			ignoreUpdate,
		);
		yield* TestClock.adjust("49 millis");
		yield* settle;
		expect(messages).toHaveLength(1);

		yield* TestClock.adjust("1 millis");
		yield* settle;
		expect(messages[1]).toEqual({
			remove: [],
			revision: 2,
			type: "update",
			add: ["entity-1", "entity-2", "entity-3"],
		});
	}),
);

it.effect("keeps one command unacknowledged and coalesces the next revision", () =>
	Effect.gen(function* () {
		const messages: EntityInterestClientMessage[] = [];
		const coordinator = yield* EntityInterestCoordinator.make();
		const send = makeSender(messages);
		yield* coordinator.connect(send);
		yield* coordinator.acknowledge(send, 1);
		yield* coordinator.setInterest("results", ["entity-1"], "visible", ignoreUpdate);
		yield* TestClock.adjust("100 millis");
		yield* settle;
		yield* coordinator.setInterest(
			"results",
			["entity-1", "entity-2", "entity-3"],
			"visible",
			ignoreUpdate,
		);
		yield* TestClock.adjust("100 millis");
		yield* settle;
		expect(messages).toHaveLength(2);

		yield* coordinator.acknowledge(send, 2);
		yield* settle;
		expect(messages[2]).toEqual({
			remove: [],
			revision: 3,
			type: "update",
			add: ["entity-2", "entity-3"],
		});
	}),
);

it.effect("delays removals and cancels grace when interest returns", () =>
	Effect.gen(function* () {
		const messages: EntityInterestClientMessage[] = [];
		const coordinator = yield* EntityInterestCoordinator.make();
		yield* coordinator.setInterest("surface", ["entity-1"], "visible", ignoreUpdate);
		const send = makeSender(messages);
		yield* coordinator.connect(send);
		yield* coordinator.acknowledge(send, 1);
		yield* coordinator.removeInterest("surface");
		yield* TestClock.adjust("1999 millis");
		yield* settle;
		expect(messages).toHaveLength(1);

		yield* coordinator.setInterest("surface", ["entity-1"], "visible", ignoreUpdate);
		yield* TestClock.adjust("2 seconds");
		yield* settle;
		expect(messages).toHaveLength(1);

		yield* coordinator.removeInterest("surface");
		yield* TestClock.adjust("2 seconds");
		yield* settle;
		expect(messages[1]).toEqual({
			add: [],
			revision: 2,
			type: "update",
			remove: ["entity-1"],
		});
	}),
);

it.effect("starts every connection with a revision-one replacement snapshot", () =>
	Effect.gen(function* () {
		const firstMessages: EntityInterestClientMessage[] = [];
		const secondMessages: EntityInterestClientMessage[] = [];
		const coordinator = yield* EntityInterestCoordinator.make();
		yield* coordinator.setInterest("surface", ["entity-2", "entity-1"], "visible", ignoreUpdate);
		const firstSend = makeSender(firstMessages);
		yield* coordinator.connect(firstSend);
		yield* coordinator.acknowledge(firstSend, 1);
		yield* coordinator.disconnect(firstSend);
		const secondSend = makeSender(secondMessages);
		yield* coordinator.connect(secondSend);

		expect(firstMessages[0]).toEqual(secondMessages[0]);
		expect(secondMessages[0]).toEqual({
			revision: 1,
			type: "replace",
			entityIds: ["entity-1", "entity-2"],
		});
	}),
);

it.effect("routes updates only to currently registered owners while connected", () =>
	Effect.gen(function* () {
		const updates: EntityInterestEntityUpdatedMessage[] = [];
		const coordinator = yield* EntityInterestCoordinator.make();
		yield* coordinator.setInterest("surface", ["entity-1"], "visible", (frame) =>
			updates.push(frame),
		);
		const send = makeSender([]);
		yield* coordinator.connect(send);
		const frame = {
			reason: "translated",
			type: "entity-updated",
			entityId: EntityId.make("entity-1"),
		} as const;
		yield* coordinator.receive(frame);
		yield* coordinator.removeInterest("surface");
		yield* coordinator.receive(frame);
		yield* coordinator.disconnect(send);
		yield* coordinator.receive(frame);

		expect(updates).toEqual([frame]);
	}),
);
