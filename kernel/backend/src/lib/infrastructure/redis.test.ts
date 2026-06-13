import { PluginSlug, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS,
	IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
	ImportSourceStateFromJson,
	hashPluginClientArtifactSessionToken,
	PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS,
	PluginClientArtifactSessionPayloadFromJson,
	redisKeys,
} from "./redis";

describe("sandbox cache keys", () => {
	it("includes the executing user in sandbox cache keys", () => {
		expect(redisKeys.sandboxCache("user-1", "script-1", "key")).toBe(
			"ryot:sandbox:cache:user:user-1:script-1:key",
		);
	});

	it("isolates the same script cache key between executing users", () => {
		expect(redisKeys.sandboxCache("user-2", "script-1", "key")).not.toBe(
			redisKeys.sandboxCache("user-1", "script-1", "key"),
		);
	});

	it("keeps userless kernel executions in a distinct partition", () => {
		expect(redisKeys.sandboxCache(null, "script-1", "key")).toBe(
			"ryot:sandbox:cache:kernel:script-1:key",
		);
	});

	it("adds a server-run partition to transient sandbox cache keys", () => {
		expect(redisKeys.sandboxRunCache("run-1", "user-1", "script-1", "key")).toBe(
			"ryot:sandbox:cache:run:run-1:user:user-1:script-1:key",
		);
		expect(redisKeys.sandboxRunCache("run-2", "user-1", "script-1", "key")).not.toBe(
			redisKeys.sandboxRunCache("run-1", "user-1", "script-1", "key"),
		);
	});

	it("keys provider search options by provider and script", () => {
		expect(redisKeys.providerSearchOptions("provider-1", "script-1")).toBe(
			"ryot:provider:search-options:provider-1:script-1",
		);
		expect(redisKeys.providerSearchOptions("provider-1", "script-1")).not.toBe(
			redisKeys.providerSearchOptions("provider-1", "script-2"),
		);
	});
});

describe("import source state", () => {
	it("uses bounded pending and execution-specific claimed keys", () => {
		expect(IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS).toBeGreaterThan(0);
		expect(IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS).toBeGreaterThan(0);
		expect(redisKeys.importSourceState("state-1")).toBe("ryot:imports:source-state:state-1");
		expect(redisKeys.importSourceStateClaim("state-1", "execution-1")).toBe(
			"ryot:imports:source-state:state-1:claim:execution-1",
		);
	});

	it("round-trips secret-bearing file source state through the shared codec", () => {
		const state = {
			source: "movary",
			pluginId: "example-plugin-id",
			uploadIntentIds: ["intent-1"],
			pluginInstallationId: "example-installation",
			namedArtifactPaths: { history: "/tmp/history.csv" },
			sourcePayload: { apiKey: "secret", history: "history" },
			workflowScriptId: SandboxScriptId.make("script-1"),
		};
		const encoded = Schema.encodeSync(ImportSourceStateFromJson)(state);

		expect(Schema.decodeUnknownSync(ImportSourceStateFromJson)(encoded)).toEqual(state);
	});
});

describe("plugin client artifact sessions", () => {
	it("uses a centralized session key and a fifteen-minute lease", () => {
		expect(redisKeys.pluginClientArtifactSession("session-1")).toBe(
			"ryot:plugins:client-artifact-session:session-1",
		);
		expect(PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS).toBe(900);
	});

	it("derives an opaque lease key from a stable SHA-256 fixture", () => {
		const token = "artifact-session-token";
		const sessionId = hashPluginClientArtifactSessionToken(token);

		expect(sessionId).toBe("22fded508748d6ee69f7a3a1e3ac0f1eaaef6f00b79d54acc02cbd9022f604d6");
		expect(redisKeys.pluginClientArtifactSession(sessionId)).not.toContain(token);
	});

	it("round-trips strict lease payloads without storing the raw token", () => {
		const payload = {
			pluginId: "plugin-1",
			sourceHash: "source-hash",
			artifactHash: "artifact-hash",
			installationId: "installation-1",
			userId: UserId.make("user-1"),
			pluginSlug: PluginSlug.make("plugin-slug"),
		};
		const encoded = Schema.encodeSync(PluginClientArtifactSessionPayloadFromJson)(payload);

		expect(encoded).not.toContain("raw-token");
		expect(Schema.decodeUnknownSync(PluginClientArtifactSessionPayloadFromJson)(encoded)).toEqual(
			payload,
		);
		expect(() =>
			Schema.decodeUnknownSync(PluginClientArtifactSessionPayloadFromJson)(
				JSON.stringify({ ...payload, token: "raw-token" }),
			),
		).toThrow();
	});
});
