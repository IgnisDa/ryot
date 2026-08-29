import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginClientArtifact,
	PluginBridgeInit,
	PluginBridgeReady,
	PluginBridgeClientMessage,
	PluginBridgeHostMessage,
	PluginBridgeOperationResult,
	PluginBridgeRyotQLCancel,
	PluginBridgeRyotQLResult,
	PluginOperationBridgeErrorReason,
	PluginRyotQLFailureReason,
	PluginThemeSnapshot,
	RyotClientErrorReason,
} from "./client";

const document = {
	queries: {
		items: {
			from: { alias: "item", table: "item" },
			output: { fields: [], orderBy: [], pagination: { limit: 10 }, type: "rows" },
		},
	},
} as const;

const identity = {
	sessionId: "session-1",
	artifactHash: "hash-1",
	apiVersion: CLIENT_API_VERSION,
	format: CLIENT_ARTIFACT_FORMAT,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};

describe("plugin client artifact contract", () => {
	it("rejects duplicate emitted file names", () => {
		const decode = Schema.decodeUnknownResult(PluginClientArtifact);
		const file = {
			name: "plugin.js",
			contents: new Uint8Array(),
			contentType: "text/javascript",
		};

		expect(
			Result.isFailure(
				decode({
					hash: "hash",
					files: [file, file],
					format: CLIENT_ARTIFACT_FORMAT,
					apiVersion: CLIENT_API_VERSION,
					compilerVersion: CLIENT_COMPILER_VERSION,
					bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
				}),
			),
		).toBe(true);
	});

	it("requires artifact file contents to be bytes", () => {
		const decode = Schema.decodeUnknownResult(PluginClientArtifact);
		const artifact = {
			hash: "hash",
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		};

		expect(
			Result.isSuccess(
				decode({
					...artifact,
					files: [
						{ name: "plugin.js", contents: new Uint8Array([0xff]), contentType: "text/javascript" },
					],
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({
					...artifact,
					files: [{ name: "plugin.js", contents: "", contentType: "text/javascript" }],
				}),
			),
		).toBe(true);
	});
});

describe("plugin client bridge contract", () => {
	it("uses exact protocol version 1", () => {
		expect(CLIENT_BRIDGE_PROTOCOL_VERSION).toBe(1);
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

	it("requires header content to identify its active screen", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeClientMessage);

		expect(
			Result.isSuccess(
				decode({ index: 2, key: "k2", header: { title: "Details" }, type: "header" }),
			),
		).toBe(true);
		expect(Result.isSuccess(decode({ index: 2, key: "k2", header: null, type: "header" }))).toBe(
			true,
		);
		expect(Result.isFailure(decode({ header: { title: "Details" }, type: "header" }))).toBe(true);
		expect(
			Result.isFailure(decode({ index: 2, key: "k2", header: { title: "" }, type: "header" })),
		).toBe(true);
		expect(
			Result.isFailure(decode({ extra: true, index: 2, key: "k2", header: null, type: "header" })),
		).toBe(true);
	});

	it("restricts a theme snapshot to a resolved mode", () => {
		const decode = Schema.decodeUnknownResult(PluginThemeSnapshot);

		expect(Result.isSuccess(decode({ resolvedMode: "dark" }))).toBe(true);
		expect(Result.isFailure(decode({ resolvedMode: "system" }))).toBe(true);
		expect(Result.isFailure(decode({ extra: true, resolvedMode: "dark" }))).toBe(true);
	});

	it("carries the theme mode and safe-area inset on init and never on the ready echo", () => {
		const decodeInit = Schema.decodeUnknownResult(PluginBridgeInit);
		const decodeReady = Schema.decodeUnknownResult(PluginBridgeReady);
		const init = { ...identity, mode: "dark", safeAreaTop: 59 };

		expect(Result.isSuccess(decodeInit(init))).toBe(true);
		expect(Result.isFailure(decodeInit({ ...identity, mode: "dark" }))).toBe(true);
		expect(Result.isFailure(decodeInit({ ...init, safeAreaTop: -1 }))).toBe(true);
		expect(Result.isSuccess(decodeReady(identity))).toBe(true);
		expect(Result.isFailure(decodeReady(init))).toBe(true);
	});

	it("admits a viewport inset from the host and a drawer request from the plugin", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);

		expect(Result.isSuccess(decodeHost({ safeAreaTop: 0, type: "viewport" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ type: "viewport" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ safeAreaTop: -8, type: "viewport" }))).toBe(true);
		expect(Result.isSuccess(decodeClient({ type: "open-drawer" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ type: "open-drawer" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ safeAreaTop: 0, type: "viewport" }))).toBe(true);
	});

	it("uses tagged logical locations by bridge direction", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const hostFields = { compact: false, edgeBack: false, index: 0, key: "k0", type: "location" };
		const route = { kind: "route", path: "/details", search: "tab=stats" };
		const entity = { entityId: "entity-1", entitySchemaSlug: "show", kind: "entity" };

		expect(Result.isSuccess(decodeHost({ ...hostFields, location: route }))).toBe(true);
		expect(Result.isSuccess(decodeHost({ ...hostFields, location: entity }))).toBe(true);
		expect(
			Result.isFailure(
				decodeHost({ ...hostFields, location: { path: route.path, search: route.search } }),
			),
		).toBe(true);
		expect(
			Result.isFailure(decodeHost({ ...hostFields, location: { ...route, kind: "unknown" } })),
		).toBe(true);
		expect(
			Result.isFailure(decodeHost({ ...hostFields, location: { ...route, extra: true } })),
		).toBe(true);
		expect(
			Result.isFailure(decodeHost({ ...hostFields, location: { ...entity, extra: true } })),
		).toBe(true);
		expect(
			Result.isSuccess(decodeClient({ location: route, mode: "push", type: "navigate" })),
		).toBe(true);
		expect(
			Result.isFailure(decodeClient({ location: entity, mode: "push", type: "navigate" })),
		).toBe(true);
	});

	it("admits a theme mode event and no applied acknowledgement", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);

		expect(Result.isSuccess(decodeHost({ mode: "light", type: "theme" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ type: "theme" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ mode: "system", type: "theme" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ type: "theme-applied" }))).toBe(true);
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

	it("decodes only the strict RyotQL cancellation message", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeRyotQLCancel);

		expect(Result.isSuccess(decode({ requestId: "request-1", type: "ryotql-cancel" }))).toBe(true);
		expect(
			Result.isFailure(decode({ reason: "caller", requestId: "request-1", type: "ryotql-cancel" })),
		).toBe(true);
		expect(Result.isFailure(decode({ type: "ryotql-cancel" }))).toBe(true);
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
					input: null,
					requestId: "request-1",
					operationSlug: "greet",
					type: "operation-request",
					sourceHash: "plugin-controlled-source-hash",
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

	it("defines independent public client errors and strict wire subsets", () => {
		const decodeOperationBridge = Schema.decodeUnknownResult(PluginOperationBridgeErrorReason);
		const decodeQueryBridge = Schema.decodeUnknownResult(PluginRyotQLFailureReason);
		const decodePublic = Schema.decodeUnknownResult(RyotClientErrorReason);
		const operationBridgeReasons = ["transport", "operation-failed", "malformed-result"];
		const queryBridgeReasons = ["transport", "query-failed"];
		const publicReasons = [
			"disposed",
			"protocol",
			"transport",
			"invalid-input",
			"query-failed",
			"operation-failed",
			"malformed-result",
			"unsupported-capability",
		];

		for (const reason of publicReasons) {
			expect(Result.isSuccess(decodePublic(reason))).toBe(true);
		}
		for (const reason of operationBridgeReasons) {
			expect(Result.isSuccess(decodeOperationBridge(reason))).toBe(true);
		}
		for (const reason of queryBridgeReasons) {
			expect(Result.isSuccess(decodeQueryBridge(reason))).toBe(true);
		}
		expect(Result.isFailure(decodeOperationBridge("query-failed"))).toBe(true);
		expect(Result.isFailure(decodeQueryBridge("operation-failed"))).toBe(true);
		expect(Result.isFailure(decodePublic("failure"))).toBe(true);
	});

	it("accepts only bridge operation errors on strict result messages", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeOperationResult);

		for (const reason of ["transport", "operation-failed", "malformed-result"]) {
			expect(
				Result.isSuccess(
					decode({ reason, outcome: "failure", requestId: "request-1", type: "operation-result" }),
				),
			).toBe(true);
		}
		expect(
			Result.isFailure(
				decode({
					reason: "protocol",
					outcome: "failure",
					requestId: "request-1",
					type: "operation-result",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({
					debug: true,
					reason: "transport",
					outcome: "failure",
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
