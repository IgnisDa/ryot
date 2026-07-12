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

	it("documents the admin plugin management surface", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/plugins"]?.get?.security).toEqual([{ adminToken: [] }]);
		expect(spec.paths["/plugins"]?.post?.description).toContain("source file map");
		expect(spec.paths["/plugins/{pluginSlug}"]?.delete?.responses["409"]).toBeDefined();
	});
});
