import { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { mediaPlugin } from "./manifest";

it("declares the complete media-owned source", () => {
	expect(() => Schema.decodeUnknownSync(PluginManifest)(mediaPlugin)).not.toThrow();
	expect(mediaPlugin.entitySchemas.map(({ slug }) => slug)).toContain("library");
	expect(mediaPlugin.relationshipSchemas.map(({ slug }) => slug)).toContain("in-library");
	expect(mediaPlugin.scripts).toHaveLength(62);
	expect(mediaPlugin.crons).toEqual([
		{
			slug: "media-trending",
			schedule: "0 0 * * *",
			driverRef: "media-trending",
			description: "Refresh global media trending rankings daily",
		},
	]);
	expect(mediaPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "media")).toBe(true);
});
