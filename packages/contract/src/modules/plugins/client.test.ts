import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	PluginBridgeClientMessage,
	PluginBridgeHostMessage,
	PluginBridgeRyotQLResult,
} from "./client";

const document = {
	queries: {
		items: {
			from: { alias: "item", table: "item" },
			output: { fields: [], orderBy: [], pagination: { limit: 10 }, type: "rows" },
		},
	},
} as const;

describe("plugin client bridge contract", () => {
	it("uses exact protocol version 3", () => {
		expect(CLIENT_BRIDGE_PROTOCOL_VERSION).toBe(3);
	});

	it("admits lifecycle close messages in both directions", () => {
		const message = { reason: "disposed", type: "lifecycle-close" };

		expect(Result.isSuccess(Schema.decodeUnknownResult(PluginBridgeClientMessage)(message))).toBe(
			true,
		);
		expect(Result.isSuccess(Schema.decodeUnknownResult(PluginBridgeHostMessage)(message))).toBe(
			true,
		);
	});

	it("decodes a strict RyotQL request", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeClientMessage);

		expect(
			Result.isSuccess(decode({ document, requestId: "request-1", type: "ryotql-request" })),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({ document, userId: "user-1", requestId: "request-1", type: "ryotql-request" }),
			),
		).toBe(true);
	});

	it("decodes only strict RyotQL success and failure results", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeRyotQLResult);
		const response = {
			data: {
				items: {
					items: [],
					type: "rows",
					pageInfo: { hasMore: false, limit: 10, nextCursor: null },
				},
			},
		};

		expect(
			Result.isSuccess(
				decode({ response, outcome: "success", requestId: "request-1", type: "ryotql-result" }),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decode({
					outcome: "failure",
					type: "ryotql-result",
					reason: "query-failed",
					requestId: "request-1",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({
					cause: "secret",
					outcome: "failure",
					reason: "transport",
					type: "ryotql-result",
					requestId: "request-1",
				}),
			),
		).toBe(true);
	});
});
