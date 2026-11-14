import { describe, expect, it } from "bun:test";

import { Context } from "effect";
import { HttpApi } from "effect/http-api";

import { AuthMiddleware } from "./auth-middleware";
import { AppContract } from "./contract";
import { MutationPolicy } from "./http-annotations";
import { LocalUploadsGroup } from "./modules/assets/contract";
import { CalendarSourcesGroup } from "./modules/calendar-sources/contract";
import { EntitiesGroup } from "./modules/entities/contract";
import { EntityUserDataGroup } from "./modules/entity-user-data/contract";
import { IntegrationsGroup } from "./modules/integrations/contract";
import { PluginsGroup } from "./modules/plugins/contract";
import { RelationshipsGroup } from "./modules/relationships/contract";
import { AdminRyotQLGroup, RyotQLGroup } from "./modules/ryotql/contract";

describe("authenticated mutation endpoints", () => {
	it("carry an explicit mutation policy through the assembled contract", () => {
		HttpApi.reflect(AppContract, {
			onGroup: () => undefined,
			onEndpoint: ({ endpoint }) => {
				if (
					endpoint.middlewares.has(AuthMiddleware) &&
					["PUT", "POST", "PATCH", "DELETE"].includes(endpoint.method)
				) {
					expect(endpoint.annotations.mapUnsafe.has(MutationPolicy.key), endpoint.path).toBe(true);
				}
			},
		});

		expect(Context.get(PluginsGroup.endpoints.install.annotations, MutationPolicy)).toBe("write");
		expect(Context.get(RyotQLGroup.endpoints.execute.annotations, MutationPolicy)).toBe("read");
		expect(Context.get(PluginsGroup.endpoints.invoke.annotations, MutationPolicy)).toBe("read");
		expect(Context.get(EntitiesGroup.endpoints.saveEditor.annotations, MutationPolicy)).toBe(
			"write",
		);
		expect(Context.get(EntitiesGroup.endpoints.create.annotations, MutationPolicy)).toBe("write");
		for (const endpoint of [
			EntityUserDataGroup.endpoints.clearEntityUserData,
			EntityUserDataGroup.endpoints.mergeEntityUserData,
		]) {
			expect(Context.get(endpoint.annotations, MutationPolicy)).toBe("write");
		}
		expect(Context.get(EntitiesGroup.endpoints.requestEnrichment.annotations, MutationPolicy)).toBe(
			"demo-write",
		);
		expect(Context.get(RelationshipsGroup.endpoints.create.annotations, MutationPolicy)).toBe(
			"write",
		);
		expect(
			Context.get(CalendarSourcesGroup.endpoints.setVisibility.annotations, MutationPolicy),
		).toBe("write");
	});

	it("keeps admin and signed-token mutations outside the mutation policy", () => {
		for (const endpoint of [
			AdminRyotQLGroup.endpoints.execute,
			IntegrationsGroup.endpoints.webhook,
			LocalUploadsGroup.endpoints.put,
		]) {
			expect(endpoint.annotations.mapUnsafe.has(MutationPolicy.key), endpoint.path).toBe(false);
		}
	});
});
