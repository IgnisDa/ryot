import { describe, expect, it } from "vitest";

import { isMediaMonitorableEntity } from "./monitorable";

const entity = (overrides: Parameters<typeof isMediaMonitorableEntity>[0]) => overrides;

describe("isMediaMonitorableEntity", () => {
	it("accepts provider-backed top-level media, people, and companies", () => {
		for (const entitySchemaSlug of ["movie", "person", "company"]) {
			expect(
				isMediaMonitorableEntity(
					entity({
						entitySchemaSlug,
						entityUserId: null,
						provenance: { externalId: "provider-id", providerId: "provider" },
					}),
				),
			).toBe(true);
		}
	});

	it("rejects unsupported, user-owned, and incomplete provider entities", () => {
		for (const value of [
			entity({
				entityUserId: null,
				entitySchemaSlug: "show-season",
				provenance: { externalId: "season", providerId: "provider" },
			}),
			entity({
				entityUserId: null,
				entitySchemaSlug: "movie-group",
				provenance: { externalId: "group", providerId: "provider" },
			}),
			entity({
				entityUserId: "user-id",
				entitySchemaSlug: "movie",
				provenance: { externalId: "movie", providerId: "provider" },
			}),
			entity({ entitySchemaSlug: "movie", entityUserId: null, provenance: null }),
		]) {
			expect(isMediaMonitorableEntity(value)).toBe(false);
		}
	});
});
