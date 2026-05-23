import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { EntityId } from "../../schema/brands";
import {
	decodeEntityInterestClientMessage,
	decodeEntityInterestServerMessage,
	encodeEntityInterestClientMessage,
	encodeEntityInterestServerMessage,
	EntityInterestSocketTicketResponse,
} from "./messages";

describe("entity-interest socket messages", () => {
	it("decodes every client message and deduplicates command IDs", () => {
		expect(decodeEntityInterestClientMessage('{"type":"authenticate","ticket":"ticket"}')).toEqual(
			expect.objectContaining({ success: { type: "authenticate", ticket: "ticket" } }),
		);
		expect(
			decodeEntityInterestClientMessage(
				'{"type":"replace","revision":1,"entityIds":["entity-2","entity-1","entity-2"]}',
			),
		).toEqual(
			expect.objectContaining({
				success: { type: "replace", revision: 1, entityIds: ["entity-2", "entity-1"] },
			}),
		);
		expect(
			decodeEntityInterestClientMessage(
				'{"type":"update","revision":2,"add":["entity-2","entity-2"],"remove":["entity-1","entity-1"]}',
			),
		).toEqual(
			expect.objectContaining({
				success: { type: "update", revision: 2, add: ["entity-2"], remove: ["entity-1"] },
			}),
		);
		expect(decodeEntityInterestClientMessage('{"type":"pong","nonce":"nonce"}')).toEqual(
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
			expect(Result.isFailure(decodeEntityInterestClientMessage(message))).toBe(true);
		}
	});

	it("rejects no-op updates and IDs present on both sides", () => {
		for (const message of [
			'{"type":"update","revision":1,"add":[],"remove":[]}',
			'{"type":"update","revision":1,"add":["entity-1"],"remove":["entity-1"]}',
		]) {
			expect(Result.isFailure(decodeEntityInterestClientMessage(message))).toBe(true);
		}
	});

	it("round-trips client and server text frames", () => {
		const client = encodeEntityInterestClientMessage({
			revision: 1,
			type: "replace",
			entityIds: ["entity-1"],
		});
		const server = encodeEntityInterestServerMessage({
			reason: "translated",
			type: "entity-updated",
			entityId: EntityId.make("entity-1"),
		});

		expect(decodeEntityInterestClientMessage(client)).toEqual(
			expect.objectContaining({
				success: { type: "replace", revision: 1, entityIds: ["entity-1"] },
			}),
		);
		expect(decodeEntityInterestServerMessage(server)).toEqual(
			expect.objectContaining({
				success: { type: "entity-updated", entityId: "entity-1", reason: "translated" },
			}),
		);
	});

	it("encodes ticket responses with an ISO 8601 UTC expiry", () => {
		const encode = Schema.encodeSync(Schema.fromJsonString(EntityInterestSocketTicketResponse));
		expect(encode({ ticket: "ticket", expiresAt: "2026-08-20T12:00:30.000Z" })).toBe(
			'{"ticket":"ticket","expiresAt":"2026-08-20T12:00:30.000Z"}',
		);
		expect(() => encode({ ticket: "ticket", expiresAt: "not-a-date" })).toThrow();
	});
});
