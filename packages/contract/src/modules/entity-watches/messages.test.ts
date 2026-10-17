import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { EntityId } from "../../schema/brands";
import {
	decodeEntityWatchClientMessage,
	decodeEntityWatchServerMessage,
	encodeEntityWatchClientMessage,
	encodeEntityWatchServerMessage,
	EntityWatchSocketTicketResponse,
} from "./messages";

describe("entity-watches socket messages", () => {
	it("decodes every client message and deduplicates command IDs", () => {
		expect(decodeEntityWatchClientMessage('{"type":"authenticate","ticket":"ticket"}')).toEqual(
			expect.objectContaining({ success: { ticket: "ticket", type: "authenticate" } }),
		);
		expect(
			decodeEntityWatchClientMessage(
				'{"type":"replace","revision":1,"entityIds":["entity-2","entity-1","entity-2"]}',
			),
		).toEqual(
			expect.objectContaining({
				success: { revision: 1, type: "replace", entityIds: ["entity-2", "entity-1"] },
			}),
		);
		expect(
			decodeEntityWatchClientMessage(
				'{"type":"update","revision":2,"add":["entity-2","entity-2"],"remove":["entity-1","entity-1"]}',
			),
		).toEqual(
			expect.objectContaining({
				success: { revision: 2, type: "update", add: ["entity-2"], remove: ["entity-1"] },
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
			'{"type":"replace","revision":0,"entityIds":[]}',
			'{"type":"replace","revision":-1,"entityIds":[]}',
			'{"type":"replace","revision":1.5,"entityIds":[]}',
			'{"type":"replace","revision":null,"entityIds":[]}',
		]) {
			expect(Result.isFailure(decodeEntityWatchClientMessage(message))).toBe(true);
		}
	});

	it("rejects no-op updates and IDs present on both sides", () => {
		for (const message of [
			'{"type":"update","revision":1,"add":[],"remove":[]}',
			'{"type":"update","revision":1,"add":["entity-1"],"remove":["entity-1"]}',
		]) {
			expect(Result.isFailure(decodeEntityWatchClientMessage(message))).toBe(true);
		}
	});

	it("round-trips client and server text frames", () => {
		const client = encodeEntityWatchClientMessage({
			revision: 1,
			type: "replace",
			entityIds: ["entity-1"],
		});
		const server = encodeEntityWatchServerMessage({
			reason: "translated",
			type: "entity-updated",
			entityId: EntityId.make("entity-1"),
		});

		expect(decodeEntityWatchClientMessage(client)).toEqual(
			expect.objectContaining({
				success: { revision: 1, type: "replace", entityIds: ["entity-1"] },
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
