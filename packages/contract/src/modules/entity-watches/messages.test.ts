import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { EntityId } from "../../schema/brands";
import {
	decodeEntityWatchClientMessage,
	decodeEntityWatchServerMessage,
	encodeEntityWatchClientMessage,
	encodeEntityWatchServerMessage,
	EntityWatchSocketTicketResponse,
	MAX_FOREGROUND_ENTITY_IDS,
} from "./messages";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `entity-${index}`);
const replace = (entityIds: readonly string[], foregroundIds: readonly string[]) =>
	decodeEntityWatchClientMessage(
		JSON.stringify({ entityIds, revision: 1, foregroundIds, type: "replace" }),
	);
const update = (addForeground: readonly string[]) =>
	decodeEntityWatchClientMessage(
		JSON.stringify({
			add: [],
			remove: [],
			revision: 2,
			addForeground,
			type: "update",
			removeForeground: [],
		}),
	);

describe("entity-watches socket messages", () => {
	it("decodes every client message and deduplicates command IDs", () => {
		expect(decodeEntityWatchClientMessage('{"type":"authenticate","ticket":"ticket"}')).toEqual(
			expect.objectContaining({ success: { ticket: "ticket", type: "authenticate" } }),
		);
		expect(
			decodeEntityWatchClientMessage(
				'{"type":"replace","revision":1,"entityIds":["entity-2","entity-1","entity-2"],"foregroundIds":["entity-1","entity-1"]}',
			),
		).toEqual(
			expect.objectContaining({
				success: {
					revision: 1,
					type: "replace",
					foregroundIds: ["entity-1"],
					entityIds: ["entity-2", "entity-1"],
				},
			}),
		);
		expect(
			decodeEntityWatchClientMessage(
				'{"type":"update","revision":2,"add":["entity-2","entity-2"],"remove":["entity-1","entity-1"],"addForeground":["entity-2","entity-2"],"removeForeground":["entity-3"]}',
			),
		).toEqual(
			expect.objectContaining({
				success: {
					revision: 2,
					type: "update",
					add: ["entity-2"],
					remove: ["entity-1"],
					addForeground: ["entity-2"],
					removeForeground: ["entity-3"],
				},
			}),
		);
		expect(decodeEntityWatchClientMessage('{"type":"pong","nonce":"nonce"}')).toEqual(
			expect.objectContaining({ success: { type: "pong", nonce: "nonce" } }),
		);
	});

	it("rejects malformed JSON, unknown messages, and invalid revisions", () => {
		for (const message of [
			"not-json",
			'{"type":"unknown"}',
			'{"type":"replace","revision":0,"entityIds":[],"foregroundIds":[]}',
			'{"type":"replace","revision":-1,"entityIds":[],"foregroundIds":[]}',
			'{"type":"replace","revision":1.5,"entityIds":[],"foregroundIds":[]}',
			'{"type":"replace","revision":null,"entityIds":[],"foregroundIds":[]}',
			'{"type":"replace","revision":1,"entityIds":[]}',
		]) {
			expect(Result.isFailure(decodeEntityWatchClientMessage(message))).toBe(true);
		}
	});

	it("rejects no-op updates and IDs present on both sides", () => {
		for (const message of [
			'{"type":"update","revision":1,"add":[],"remove":[],"addForeground":[],"removeForeground":[]}',
			'{"type":"update","revision":1,"add":["entity-1"],"remove":["entity-1"],"addForeground":[],"removeForeground":[]}',
			'{"type":"update","revision":1,"add":[],"remove":[],"addForeground":["entity-1"],"removeForeground":["entity-1"]}',
			'{"type":"update","revision":1,"add":[],"remove":["entity-1"],"addForeground":["entity-1"],"removeForeground":[]}',
			'{"type":"update","revision":1,"add":[],"remove":["entity-1"],"addForeground":[],"removeForeground":["entity-1"]}',
			'{"type":"update","revision":1,"add":["entity-1"],"remove":[]}',
		]) {
			expect(Result.isFailure(decodeEntityWatchClientMessage(message))).toBe(true);
		}
	});

	it("accepts a foreground-only update", () => {
		expect(
			decodeEntityWatchClientMessage(
				'{"type":"update","revision":3,"add":[],"remove":[],"addForeground":[],"removeForeground":["entity-1"]}',
			),
		).toEqual(
			expect.objectContaining({
				success: {
					add: [],
					remove: [],
					revision: 3,
					type: "update",
					addForeground: [],
					removeForeground: ["entity-1"],
				},
			}),
		);
	});

	it("caps foreground IDs and requires replace foreground IDs to be members", () => {
		const atCap = ids(MAX_FOREGROUND_ENTITY_IDS);
		const overCap = ids(MAX_FOREGROUND_ENTITY_IDS + 1);

		expect(Result.isSuccess(replace(atCap, atCap))).toBe(true);
		expect(Result.isFailure(replace(overCap, overCap))).toBe(true);
		expect(Result.isFailure(replace(["entity-1"], ["entity-2"]))).toBe(true);
		expect(Result.isSuccess(update(atCap))).toBe(true);
		expect(Result.isFailure(update(overCap))).toBe(true);
	});

	it("round-trips client and server text frames", () => {
		const client = encodeEntityWatchClientMessage({
			revision: 1,
			type: "replace",
			entityIds: ["entity-1"],
			foregroundIds: ["entity-1"],
		});
		const server = encodeEntityWatchServerMessage({
			reason: "translated",
			type: "entity-updated",
			entityId: EntityId.make("entity-1"),
		});

		expect(decodeEntityWatchClientMessage(client)).toEqual(
			expect.objectContaining({
				success: {
					revision: 1,
					type: "replace",
					entityIds: ["entity-1"],
					foregroundIds: ["entity-1"],
				},
			}),
		);
		expect(decodeEntityWatchServerMessage(server)).toEqual(
			expect.objectContaining({
				success: { entityId: "entity-1", reason: "translated", type: "entity-updated" },
			}),
		);
	});

	it("encodes ticket responses with an ISO 8601 UTC expiry", () => {
		const encode = Schema.encodeSync(Schema.fromJsonString(EntityWatchSocketTicketResponse));
		expect(encode({ ticket: "ticket", expiresAt: "2026-08-20T12:00:30.000Z" })).toBe(
			'{"ticket":"ticket","expiresAt":"2026-08-20T12:00:30.000Z"}',
		);
		expect(() => encode({ ticket: "ticket", expiresAt: "not-a-date" })).toThrow();
	});
});
