import { describe, expect, it } from "bun:test";

import {
	type DateArgument,
	localMessageBuilder,
	messageBuilder,
	type NoArguments,
	type NumberArgument,
	type SelectArgument,
	type TextArgument,
	type ZonedDateTimeArgument,
} from "./builder";

type Catalog = {
	readonly "item.plain": NoArguments;
	readonly "item.due": { readonly at: ZonedDateTimeArgument };
	readonly "item.summary": {
		readonly at: DateArgument;
		readonly name: TextArgument;
		readonly count: NumberArgument;
		readonly status: SelectArgument<"done" | "pending">;
	};
};

describe("message builders", () => {
	it("encodes dates and keeps nested messages with their own namespace", () => {
		const kernel = messageBuilder<Catalog>("kernel");
		const nested = messageBuilder<Catalog>("media")("item.plain");
		expect(
			kernel("item.summary", {
				count: 3,
				name: nested,
				status: "done",
				at: new Date("2026-11-15T10:00:00.000Z"),
			}),
		).toEqual({
			namespace: "kernel",
			key: "item.summary",
			params: {
				count: 3,
				status: "done",
				at: { date: "2026-11-15T10:00:00.000Z" },
				name: { key: "item.plain", namespace: "media" },
			},
		});
		expect(kernel("item.plain")).toEqual({ key: "item.plain", namespace: "kernel" });
		expect(
			kernel("item.due", {
				at: { timeZone: "Asia/Kolkata", date: new Date("2026-11-15T10:00:00.000Z") },
			}),
		).toEqual({
			key: "item.due",
			namespace: "kernel",
			params: { at: { timeZone: "Asia/Kolkata", date: "2026-11-15T10:00:00.000Z" } },
		});
	});

	it("builds namespace-less local messages", () => {
		const local = localMessageBuilder<Catalog>();
		expect(
			local("item.summary", {
				count: 1,
				status: "pending",
				name: local("item.plain"),
				at: new Date("2026-11-15T00:00:00.000Z"),
			}),
		).toEqual({
			key: "item.summary",
			params: {
				count: 1,
				status: "pending",
				name: { key: "item.plain" },
				at: { date: "2026-11-15T00:00:00.000Z" },
			},
		});
	});
});
