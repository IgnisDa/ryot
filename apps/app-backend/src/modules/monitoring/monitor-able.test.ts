import { describe, expect, it } from "vitest";

import { isMonitorAbleEntity } from "./monitorable";

const entity = (overrides: Parameters<typeof isMonitorAbleEntity>[0]) => overrides;

describe("isMonitorableEntity", () => {
	it("accepts provider-backed top-level media, people, and companies", () => {
		for (const entitySchemaSlug of ["movie", "person", "company"]) {
			expect(
				isMonitorAbleEntity(
					entity({
						entitySchemaSlug,
						entityUserId: null,
						provenance: { externalId: "provider-id", sandboxScriptId: "provider-script" },
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
				provenance: { externalId: "season", sandboxScriptId: "provider-script" },
			}),
			entity({
				entityUserId: null,
				entitySchemaSlug: "movie-group",
				provenance: { externalId: "group", sandboxScriptId: "provider-script" },
			}),
			entity({
				entityUserId: "user-id",
				entitySchemaSlug: "movie",
				provenance: { externalId: "movie", sandboxScriptId: "provider-script" },
			}),
			entity({ entitySchemaSlug: "movie", entityUserId: null, provenance: null }),
		]) {
			expect(isMonitorAbleEntity(value)).toBe(false);
		}
	});
});
