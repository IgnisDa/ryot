import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS,
	IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
	ImportSourceStateFromJson,
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
			pluginId: "media-plugin-id",
			uploadIntentIds: ["intent-1"],
			pluginInstallationId: "media-installation",
			namedArtifactPaths: { history: "/tmp/history.csv" },
			sourcePayload: { apiKey: "secret", history: "history" },
			workflowScriptId: SandboxScriptId.make("script-1"),
		};
		const encoded = Schema.encodeSync(ImportSourceStateFromJson)(state);

		expect(Schema.decodeUnknownSync(ImportSourceStateFromJson)(encoded)).toEqual(state);
	});
});
