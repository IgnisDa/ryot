import { describe, expect, it } from "@effect/vitest";
import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { objectContaining } from "@ryot-app/testing/matchers";
import { Effect, Schema } from "effect";

import { fixturePlugin } from "./plugin";

describe("fixture calendar sources", () => {
	it.effect("declares one instant Pokemon source that the manifest schema accepts", () =>
		Effect.gen(function* () {
			const manifest = yield* Schema.decodeEffect(AuthoredPluginManifest)(fixturePlugin);
			expect(manifest.calendarSources).toEqual([
				objectContaining({
					caption: "source",
					startAt: "addedAt",
					precision: "instant",
					slug: "pokemon-added",
					subject: {
						entityAlias: "entity",
						schemas: [{ slug: "pokemon", owner: { kind: "self" } }],
					},
				}),
			]);
			expect(manifest.calendarSources?.[0]).not.toHaveProperty("art");
			expect(manifest.calendarSources?.[0]).not.toHaveProperty("done");
		}),
	);
});
