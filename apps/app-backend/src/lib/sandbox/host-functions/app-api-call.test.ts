import { describe, expect, it } from "bun:test";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";
import { createAppApiCallHostFunction } from "./app-api-call";

describe("appApiCall", () => {
	it("returns validation failure for a blank userId", async () => {
		const fn = createAppApiCallHostFunction(async () =>
			Response.json({ ok: true }),
		);

		expect(await fn({ userId: "   " }, "GET", "/system/health")).toEqual(
			apiFailure("appApiCall requires a non-empty userId in context"),
		);
	});

	it("returns validation failure for a blank method", async () => {
		const fn = createAppApiCallHostFunction(async () =>
			Response.json({ ok: true }),
		);

		expect(await fn({ userId: "user_1" }, "   ", "/system/health")).toEqual(
			apiFailure("appApiCall expects a non-empty method string"),
		);
	});

	it("returns validation failure for a blank path", async () => {
		const fn = createAppApiCallHostFunction(async () =>
			Response.json({ ok: true }),
		);

		expect(await fn({ userId: "user_1" }, "GET", "   ")).toEqual(
			apiFailure("appApiCall expects a non-empty path string"),
		);
	});

	it("rejects forbidden auth headers", async () => {
		const fn = createAppApiCallHostFunction(async () =>
			Response.json({ ok: true }),
		);

		expect(
			await fn({ userId: "user_1" }, "GET", "/system/health", {
				headers: { authorization: "Bearer nope" },
			}),
		).toEqual(
			apiFailure("appApiCall does not allow the 'authorization' header"),
		);
	});

	it("maps successful JSON responses", async () => {
		const fn = createAppApiCallHostFunction(async (input) => {
			expect(input).toEqual({
				method: "POST",
				userId: "user_1",
				body: { page: 1 },
				headers: { "x-test": "1" },
				path: "/api/query-engine/execute",
			});

			return Response.json(
				{ data: { items: [] } },
				{ status: 200, headers: { "x-source": "test" } },
			);
		});

		expect(
			await fn({ userId: "user_1" }, "post", "/api/query-engine/execute", {
				body: { page: 1 },
				headers: { "x-test": "1" },
			}),
		).toEqual(
			apiSuccess({
				status: 200,
				statusText: "",
				body: { data: { items: [] } },
				headers: {
					"x-source": "test",
					"content-type": "application/json;charset=utf-8",
				},
			}),
		);
	});

	it("maps non-json responses as text", async () => {
		const fn = createAppApiCallHostFunction(
			async () =>
				new Response("ok", {
					status: 200,
					statusText: "OK",
					headers: { "content-type": "text/plain" },
				}),
		);

		expect(await fn({ userId: "user_1" }, "GET", "/system/metrics")).toEqual(
			apiSuccess({
				body: "ok",
				status: 200,
				statusText: "OK",
				headers: { "content-type": "text/plain" },
			}),
		);
	});

	it("maps non-2xx responses into failures with response data", async () => {
		const fn = createAppApiCallHostFunction(async () =>
			Response.json(
				{ error: { message: "Bad input" } },
				{ status: 400, statusText: "Bad Request" },
			),
		);

		expect(
			await fn({ userId: "user_1" }, "GET", "/query-engine/execute"),
		).toEqual({
			...apiFailure("HTTP 400 Bad Request"),
			data: {
				status: 400,
				body: { error: { message: "Bad input" } },
				headers: { "content-type": "application/json;charset=utf-8" },
			},
		});
	});

	it("returns failures from internal request validation", async () => {
		const fn = createAppApiCallHostFunction(async () => {
			throw new Error("appApiCall cannot target /api/auth routes");
		});

		expect(await fn({ userId: "user_1" }, "GET", "/api/auth/session")).toEqual(
			apiFailure("appApiCall cannot target /api/auth routes"),
		);
	});
});
