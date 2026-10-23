import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { fixturePlugin } from "./plugin";

describe("fixture calendar sources", () => {
	it("declares one instant Pokemon source that the manifest schema accepts", () => {
		const manifest = Schema.decodeSync(AuthoredPluginManifest)(fixturePlugin);
		expect(manifest.calendarSources).toEqual([
			expect.objectContaining({
				caption: "source",
				startAt: "addedAt",
				precision: "instant",
				slug: "pokemon-added",
				subject: { entityAlias: "entity", schemas: [{ slug: "pokemon", owner: { kind: "self" } }] },
			}),
		]);
		expect(manifest.calendarSources?.[0]).not.toHaveProperty("art");
		expect(manifest.calendarSources?.[0]).not.toHaveProperty("done");
	});
});
