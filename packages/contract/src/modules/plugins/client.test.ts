import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	PluginBridgeClientMessage,
	PluginBridgeHostMessage,
	PluginBridgeOperationResult,
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

	it("requires JSON operation inputs and success values", () => {
		const decodeRequest = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeResult = Schema.decodeUnknownResult(PluginBridgeOperationResult);

		expect(
			Result.isSuccess(
				decodeRequest({
					requestId: "request-1",
					operationSlug: "greet",
					type: "operation-request",
					input: { values: [null, true, 1, "ok"] },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeRequest({
					requestId: "request-1",
					operationSlug: "greet",
					type: "operation-request",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeRequest({
					requestId: "request-1",
					operationSlug: "greet",
					type: "operation-request",
					input: { invalid: undefined },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeResult({
					outcome: "success",
					value: () => undefined,
					requestId: "request-1",
					type: "operation-result",
				}),
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
