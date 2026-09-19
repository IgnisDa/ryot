import { Context } from "effect";
import { describe, expect, it } from "vitest";

import { AuthMiddleware } from "./auth-middleware";
import { AppContract } from "./contract";
import { DemoAccessPolicy } from "./http-annotations";
import { IntegrationsGroup } from "./modules/integrations/contract";
import { PluginsGroup } from "./modules/plugins/contract";
import { AdminRyotQLGroup, RyotQLGroup } from "./modules/ryotql/contract";
import { LocalUploadsGroup } from "./modules/uploads/contract";

describe("authenticated mutation endpoints", () => {
	it("carry an explicit demo policy through the assembled contract", () => {
		for (const group of Object.values(AppContract.groups)) {
			for (const endpoint of Object.values(group.endpoints)) {
				if (
					!endpoint.middlewares.has(AuthMiddleware) ||
					!["POST", "PUT", "PATCH", "DELETE"].includes(endpoint.method)
				) {
					continue;
				}
				expect(endpoint.annotations.mapUnsafe.has(DemoAccessPolicy.key), endpoint.path).toBe(true);
			}
		}

		expect(Context.get(PluginsGroup.endpoints.install.annotations, DemoAccessPolicy)).toBe(
			"protected",
		);
		expect(Context.get(RyotQLGroup.endpoints.execute.annotations, DemoAccessPolicy)).toBe(
			"allowed",
		);
		expect(Context.get(PluginsGroup.endpoints.invoke.annotations, DemoAccessPolicy)).toBe(
			"allowed",
		);
	});

	it("keeps admin and signed-token mutations outside the demo policy", () => {
		for (const endpoint of [
			AdminRyotQLGroup.endpoints.execute,
			IntegrationsGroup.endpoints.webhook,
			LocalUploadsGroup.endpoints.put,
		]) {
			expect(endpoint.annotations.mapUnsafe.has(DemoAccessPolicy.key), endpoint.path).toBe(false);
		}
	});
});
