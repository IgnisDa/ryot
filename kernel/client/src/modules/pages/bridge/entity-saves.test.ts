import { describe, expect, layer } from "@effect/vitest";
import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { EntityEditorRefused } from "@ryot-app/contract/modules/entities/editor";
import type { EntityEditorSaveRequest } from "@ryot-app/contract/modules/entities/editor";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { EntitiesApi } from "#/api/entities";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { PluginEntitySaves } from "#/modules/pages/bridge/entity-saves";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const contributor = PluginId.make("plugin-1");
const contributors: PreparedClientPage["identity"]["contributors"] = [
	{
		kind: "plugin",
		pluginId: contributor,
		revisionId: "revision-1",
		contentHash: "source-hash",
		installationId: "installation-1",
		packageId: PluginPackageId.make("test/fixture"),
	},
	{ name: "table", kind: "kernel-renderer", sourceHash: "source-hash" },
];

const requestFor = (
	owner: EntityEditorSaveRequest["submission"]["entitySchema"]["owner"],
): EntityEditorSaveRequest => ({
	idempotencyKey: "form-1",
	submittedAt: "2026-10-19T00:00:00.000Z",
	submission: {
		name: "Item",
		properties: {},
		relationships: [],
		target: { kind: "create" },
		entitySchema: { owner, slug: EntitySchemaSlug.make("item") },
	},
});

const calls: EntityEditorSaveRequest[] = [];
const failures: unknown[] = [];

const entitiesApi = Layer.succeed(EntitiesApi, {
	requestEnrichment: () => Effect.die("unused"),
	saveEditor: (_scope, { payload }) => {
		calls.push(payload);
		const failure = failures.shift();
		return failure === undefined
			? Effect.succeed({
					warnings: [],
					output: { kind: "saved" as const, entityId: EntityId.make("entity-1") },
				})
			: Effect.fail(new AuthenticatedApiError({ cause: failure }));
	},
});

const outcome = (request: EntityEditorSaveRequest) =>
	Effect.flatMap(PluginEntitySaves, (saves) => saves.outcome(scope, contributors, request));

describe("plugin entity saves", () => {
	layer(PluginEntitySaves.layer.pipe(Layer.provide(entitiesApi)))((test) => {
		test.effect("refuses schemas whose owner does not contribute to the document", () =>
			Effect.gen(function* () {
				calls.length = 0;
				for (const owner of [
					{ kind: "plugin" as const, pluginId: PluginId.make("plugin-2") },
					{ kind: "kernel" as const },
				]) {
					expect(yield* outcome(requestFor(owner))).toEqual({
						outcome: "failure",
						reason: "invalid-request",
					});
				}
				expect(calls).toEqual([]);
			}),
		);

		test.effect("saves for a contributing owner and classifies endpoint failures", () =>
			Effect.gen(function* () {
				calls.length = 0;
				const request = requestFor({ kind: "plugin", pluginId: contributor });
				expect(yield* outcome(request)).toEqual({
					outcome: "success",
					output: { kind: "saved", entityId: "entity-1" },
				});
				expect(calls).toEqual([request]);

				failures.push(
					new EntityEditorRefused({ message: "reused" }),
					new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
					new Error("network"),
				);
				for (const reason of ["entity-save-failed", "entity-save-failed", "transport"]) {
					expect(yield* outcome(request)).toEqual({ reason, outcome: "failure" });
				}
			}),
		);
	});
});
