import { describe, expect, it } from "vitest";

import { PluginPackageId } from "../../schema/brands";
import { pluginConfigEnvironmentKey } from "./plugin-config";

describe("pluginConfigEnvironmentKey", () => {
	it("separates publisher, name, and key with double underscores", () => {
		expect(pluginConfigEnvironmentKey(PluginPackageId.make("ryot/media"), "tmdbAccessToken")).toBe(
			"RYOT_PLUGIN__RYOT__MEDIA__TMDB_ACCESS_TOKEN",
		);
		expect(pluginConfigEnvironmentKey(PluginPackageId.make("acme-labs/movie-db"), "api.key")).toBe(
			"RYOT_PLUGIN__ACME_LABS__MOVIE_DB__API_KEY",
		);
	});

	it("keeps packages that only differ in segment boundaries distinct", () => {
		const keys = [
			["a-b/c", "d"],
			["a/b-c", "d"],
			["a/b", "c-d"],
			["a/b-c-d", "e"],
			["a-b-c/d", "e"],
		].map(([packageId = "", key = ""]) =>
			pluginConfigEnvironmentKey(PluginPackageId.make(packageId), key),
		);

		expect(new Set(keys).size).toBe(keys.length);
	});
});
