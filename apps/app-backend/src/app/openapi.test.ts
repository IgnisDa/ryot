import { AppContract } from "@ryot/contract/contract";
import { OpenApi } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

describe("OpenAPI documentation", () => {
	it("describes every group and route", () => {
		const spec = OpenApi.fromApi(AppContract);
		const undocumentedGroups = spec.tags
			.filter((tag) => !tag.description?.trim())
			.map((tag) => tag.name);
		const undocumentedRoutes = Object.entries(spec.paths).flatMap(([path, item]) =>
			methods.flatMap((method) => {
				const operation = item[method];
				return operation && !operation.description?.trim()
					? [`${method.toUpperCase()} ${path}`]
					: [];
			}),
		);

		expect(undocumentedGroups).toEqual([]);
		expect(undocumentedRoutes).toEqual([]);
	});

	it("documents the user plugin installation surface", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/plugins"]?.get?.security).toEqual([{ apiKey: [] }]);
		expect(spec.paths["/plugins"]?.post?.description).toContain("source file map");
		expect(spec.paths["/plugins/{pluginSlug}"]?.delete?.responses["409"]).toBeDefined();
		expect(spec.paths["/test-support/system-plugins"]?.get?.security).toEqual([{ adminToken: [] }]);
	});

	it("documents API key authentication without Better Auth cookie internals", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/ryotql/execute"]?.post?.security).toEqual([{ apiKey: [] }]);
		expect(spec.components.securitySchemes["apiKey"]).toEqual({
			in: "header",
			name: "x-api-key",
			type: "apiKey",
		});
	});

	it("documents durable user lifecycle operations as admin-only asynchronous requests", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/god-mode/users/{userId}"]?.delete?.responses["202"]).toBeDefined();
		expect(spec.paths["/god-mode/users/{userId}/reset"]?.post?.responses["202"]).toBeDefined();
		expect(spec.paths["/god-mode/user-lifecycle-operations/{operationId}"]?.get?.security).toEqual([
			{ adminToken: [] },
		]);
	});

	it("documents migration reports as admin-only", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/god-mode/migration-report"]?.get?.security).toEqual([{ adminToken: [] }]);
	});
});
