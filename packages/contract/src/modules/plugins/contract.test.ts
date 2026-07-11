import { Context, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { LogRouteTemplate } from "../../http-annotations";
import { UserId } from "../../schema/brands";
import {
	decodePluginCatalogInvalidatedMessage,
	encodePluginCatalogInvalidatedMessage,
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
	PluginCatalogEventStream,
	PluginArtifactSessionsGroup,
	PluginsGroup,
} from "./contract";
import {
	CreatePluginClientArtifactSessionBody,
	CreatePluginClientArtifactSessionResponse,
	RenewPluginClientArtifactSessionResponse,
} from "./schemas";

describe("PluginArtifactSessionsGroup", () => {
	it("defines the unauthenticated raw artifact endpoint", () => {
		const endpoint = PluginArtifactSessionsGroup.endpoints.file;

		expect(endpoint.method).toBe("GET");
		expect(endpoint.path).toBe("/plugin-artifact-sessions/:token/:fileName");
		expect(Context.get(endpoint.annotations, LogRouteTemplate)).toBe(true);
		expect(endpoint.success.size).toBe(1);
	});

	it("does not expose the old public artifact path", () => {
		expect(PluginArtifactSessionsGroup.endpoints.file.path).not.toContain("/plugins/artifacts/");
	});
});

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

	it("defines authenticated artifact session management endpoints", () => {
		const renew = PluginsGroup.endpoints.renewArtifactSession;
		const create = PluginsGroup.endpoints.createArtifactSession;
		const remove = PluginsGroup.endpoints.revokeArtifactSession;

		expect(create.method).toBe("POST");
		expect(create.path).toBe(
			"/plugins/:pluginSlug/installations/:installationId/client-artifact-sessions",
		);
		expect(renew.method).toBe("POST");
		expect(renew.path).toBe("/plugins/client-artifact-sessions/:sessionId/renew");
		expect(remove.method).toBe("DELETE");
		expect(remove.path).toBe("/plugins/client-artifact-sessions/:sessionId");
		for (const endpoint of [create, renew, remove]) {
			expect(endpoint.middlewares.size).toBeGreaterThan(0);
		}
	});

	it("defines the authenticated home-view selection endpoint", () => {
		const endpoint = PluginsGroup.endpoints.setHomeView;

		expect(endpoint.method).toBe("PUT");
		expect(endpoint.path).toBe("/plugins/:pluginSlug/home-view");
		expect(endpoint.middlewares.size).toBeGreaterThan(0);
	});

	it("uses strict artifact session request and response schemas", () => {
		const strictFixtures = [
			[
				CreatePluginClientArtifactSessionBody,
				{ sourceHash: "source", artifactHash: "artifact", extra: true },
			],
			[
				CreatePluginClientArtifactSessionResponse,
				{ sessionId: "session", token: "token", expiresAt: "expires", extra: true },
			],
			[RenewPluginClientArtifactSessionResponse, { expiresAt: "expires", extra: true }],
		] as const;

		for (const [schema, fixture] of strictFixtures) {
			expect(() => Schema.decodeUnknownSync(schema)(fixture)).toThrow();
		}
	});
});
