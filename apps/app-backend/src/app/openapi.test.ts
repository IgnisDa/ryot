import { OpenApi } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
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
});
