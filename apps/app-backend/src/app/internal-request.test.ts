import { afterEach, describe, expect, it } from "bun:test";

import { getInternalRequestAuth } from "./internal-auth";
import {
	executeInternalAppRequest,
	normalizeBaseAppPath,
	registerInternalAppRequestHandler,
} from "./internal-request";

afterEach(() => {
	registerInternalAppRequestHandler(null);
});

describe("normalizeBaseAppPath", () => {
	it("normalizes /api-prefixed paths", () => {
		expect(normalizeBaseAppPath("/api/query-engine/execute?x=1")).toBe("/query-engine/execute?x=1");
	});

	it("keeps base-app-relative paths", () => {
		expect(normalizeBaseAppPath("/query-engine/execute")).toBe("/query-engine/execute");
	});

	it("rejects full URLs", () => {
		expect(() => normalizeBaseAppPath("https://example.com/query-engine")).toThrow(
			"appApiCall expects a base-app path, not a full URL",
		);
	});

	it("rejects /api/auth routes", () => {
		expect(() => normalizeBaseAppPath("/api/auth/sign-in")).toThrow(
			"appApiCall cannot target /api/auth routes",
		);
	});

	it("rejects malformed percent-encoded paths", () => {
		expect(() => normalizeBaseAppPath("/api/%ZZquery-engine/execute")).toThrow(
			"appApiCall path is invalid",
		);
	});
});

describe("executeInternalAppRequest", () => {
	it("registers internal request auth before execution", async () => {
		let capturedRequest: Request | undefined;

		registerInternalAppRequestHandler(async (request) => {
			capturedRequest = request;
			return Response.json({ ok: true });
		});

		const response = await executeInternalAppRequest({
			method: "POST",
			userId: "user_1",
			body: { hello: "world" },
			headers: { "x-test": "1" },
			path: "/api/query-engine/execute",
		});

		expect(response.status).toBe(200);
		expect(capturedRequest).toBeDefined();
		expect(capturedRequest?.url).toBe("http://ryot.internal/query-engine/execute");
		expect(capturedRequest?.headers.get("x-test")).toBe("1");
		expect(capturedRequest?.headers.get("content-type")).toBe("application/json");
		expect(getInternalRequestAuth(capturedRequest as Request)).toEqual({
			userId: "user_1",
		});
		expect(await (capturedRequest as Request).text()).toBe('{"hello":"world"}');
	});

	it("throws when the internal handler is missing", async () => {
		expect(
			executeInternalAppRequest({
				method: "POST",
				userId: "user_1",
				path: "/query-engine/execute",
			}),
		).rejects.toThrow("Internal app request handler is not registered");
	});
});
