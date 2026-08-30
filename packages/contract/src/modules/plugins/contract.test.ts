import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { UserId } from "../../schema/brands";
import {
	decodePluginCatalogInvalidatedMessage,
	encodePluginCatalogInvalidatedMessage,
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
	PluginCatalogEventStream,
	PluginsGroup,
} from "./contract";

describe("PluginsGroup", () => {
	it("defines the authenticated plugin event stream", () => {
		const endpoint = PluginsGroup.endpoints.events;

		expect(endpoint.method).toBe("GET");
		expect(endpoint.path).toBe("/plugins/events");
		expect(endpoint.middlewares.size).toBeGreaterThan(0);
		expect(endpoint.success.has(PluginCatalogEventStream)).toBe(true);
		expect(PluginCatalogEventStream.contentType).toBe("text/event-stream");
	});

	it("exports payload-free event names separately from the Redis message", () => {
		expect(PLUGIN_CATALOG_CONNECTED_EVENT).toBe("connected");
		expect(PLUGIN_CATALOG_INVALIDATED_EVENT).toBe("catalog-invalidated");

		const encoded = encodePluginCatalogInvalidatedMessage({ userId: UserId.make("user-1") });
		expect(encoded).toBe('{"userId":"user-1"}');
		expect(decodePluginCatalogInvalidatedMessage(encoded)).toEqual(
			expect.objectContaining({ success: { userId: "user-1" } }),
		);
	});

	it("rejects invalid Redis messages and excess fields", () => {
		for (const message of [
			"not-json",
			"{}",
			'{"userId":1}',
			'{"userId":"user-1","event":"catalog-invalidated"}',
		]) {
			expect(Result.isFailure(decodePluginCatalogInvalidatedMessage(message))).toBe(true);
		}
	});

	it("defines the authenticated home-view selection endpoint", () => {
		const endpoint = PluginsGroup.endpoints.setHomeView;

		expect(endpoint.method).toBe("PUT");
		expect(endpoint.path).toBe("/plugins/:pluginSlug/home-view");
		expect(endpoint.middlewares.size).toBeGreaterThan(0);
	});
});
