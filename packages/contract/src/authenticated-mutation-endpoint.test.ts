import { Context } from "effect";
import { describe, expect, it } from "vitest";

import { AuthMiddleware } from "./auth-middleware";
import { AppContract } from "./contract";
import { DemoAccessPolicy } from "./http-annotations";
import { LocalUploadsGroup } from "./modules/assets/contract";
import { CalendarSourcesGroup } from "./modules/calendar-sources/contract";
import { EntitiesGroup } from "./modules/entities/contract";
import { EntityUserDataGroup } from "./modules/entity-user-data/contract";
import { IntegrationsGroup } from "./modules/integrations/contract";
import { PluginsGroup } from "./modules/plugins/contract";
import { RelationshipsGroup } from "./modules/relationships/contract";
import { AdminRyotQLGroup, RyotQLGroup } from "./modules/ryotql/contract";

describe("authenticated mutation endpoints", () => {
	it("carry an explicit demo policy through the assembled contract", () => {
		for (const group of Object.values(AppContract.groups)) {
			for (const endpoint of Object.values(group.endpoints)) {
				if (
					!endpoint.middlewares.has(AuthMiddleware) ||
					!["PUT", "POST", "PATCH", "DELETE"].includes(endpoint.method)
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
		expect(Context.get(EntitiesGroup.endpoints.saveEditor.annotations, DemoAccessPolicy)).toBe(
			"protected",
		);
		expect(Context.get(EntitiesGroup.endpoints.create.annotations, DemoAccessPolicy)).toBe(
			"protected",
		);
		for (const endpoint of [
			EntityUserDataGroup.endpoints.clearEntityUserData,
			EntityUserDataGroup.endpoints.mergeEntityUserData,
		]) {
			expect(Context.get(endpoint.annotations, DemoAccessPolicy)).toBe("protected");
		}
		expect(
			Context.get(EntitiesGroup.endpoints.requestEnrichment.annotations, DemoAccessPolicy),
		).toBe("allowed");
		expect(Context.get(RelationshipsGroup.endpoints.create.annotations, DemoAccessPolicy)).toBe(
			"protected",
		);
		expect(
			Context.get(CalendarSourcesGroup.endpoints.setVisibility.annotations, DemoAccessPolicy),
		).toBe("protected");
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
