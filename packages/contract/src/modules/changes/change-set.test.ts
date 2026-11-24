import { describe, expect, it } from "bun:test";

import { Result, Schema } from "effect";

import { CHANGE_SET_LIMITS, ChangeSet } from "./change-set";

const decode = Schema.decodeUnknownResult(ChangeSet);
const eventIds = (count: number) => Array.from({ length: count }, (_, index) => `event-${index}`);
const deletes = (count: number) => ({
	events: {
		changes: eventIds(count).map((eventId) => ({ eventId, kind: "delete", itemIdentity: eventId })),
	},
});
const expectedEvents = (count: number) => ({
	events: { changes: [], expected: { eventIds: eventIds(count), eventSchemaSlug: "observed" } },
});

describe("change set bounds", () => {
	it("accepts event changes up to their bound and refuses one more", () => {
		expect(Result.isSuccess(decode(deletes(CHANGE_SET_LIMITS.eventChanges)))).toBe(true);
		expect(Result.isFailure(decode(deletes(CHANGE_SET_LIMITS.eventChanges + 1)))).toBe(true);
	});

	it("accepts expected events up to their bound and refuses one more", () => {
		expect(Result.isSuccess(decode(expectedEvents(CHANGE_SET_LIMITS.expectedEventIds)))).toBe(true);
		expect(Result.isFailure(decode(expectedEvents(CHANGE_SET_LIMITS.expectedEventIds + 1)))).toBe(
			true,
		);
	});
});
