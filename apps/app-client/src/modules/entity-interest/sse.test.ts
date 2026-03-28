import { describe, expect, it } from "vitest";

import { InterestSseParser } from "./sse";

describe("entity-interest SSE parser", () => {
	it("parses split and batched events while ignoring comments and malformed frames", () => {
		const parser = new InterestSseParser();

		expect(parser.push('event: connected\ndata: {"streamId":"stream-1')).toEqual([]);
		expect(
			parser.push(
				'"}\n\n: ping\n\nevent: entity:updated\ndata: {"entityId":"entity-1","reason":"populated"}\n\nevent: entity:updated\ndata: nope\n\n',
			),
		).toEqual([
			{ type: "connected", frame: { streamId: "stream-1" } },
			{
				type: "entity:updated",
				frame: { entityId: "entity-1", reason: "populated" },
			},
		]);
	});
});
