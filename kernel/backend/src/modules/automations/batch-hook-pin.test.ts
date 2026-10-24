import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect } from "effect";

import { restoreBatchHookPin } from "./batch-hook-pin";

const payload = {
	scriptSlug: "fixture.automation",
	scriptContentHash: "retained-hash",
	hook: {
		name: "Changed",
		slug: "fixture.changed",
		stage: "after" as const,
		frequency: "batch" as const,
		delivery: "required" as const,
		scriptSlug: "fixture.automation",
		targets: [
			{ resource: "entity" as const, entitySchemaSlug: "fixture", operation: "create" as const },
		],
	},
};
const references = {
	scopeUserId: null,
	pluginConfigRevisionId: null,
	sandboxScriptId: "retained-script",
	pluginRevisionId: "retained-revision",
	pluginId: PluginId.make("retained-plugin"),
};

it.effect("restores execution scope and nullable configuration from the canonical references", () =>
	Effect.gen(function* () {
		for (const scopeUserId of [null, UserId.make("execution-user")]) {
			for (const pluginConfigRevisionId of [null, "retained-config"]) {
				expect(
					yield* restoreBatchHookPin({
						payload,
						references: { ...references, scopeUserId, pluginConfigRevisionId },
					}),
				).toEqual({
					...payload,
					pluginConfigRevisionId,
					executionUserId: scopeUserId,
					pluginId: references.pluginId,
					sandboxScriptId: references.sandboxScriptId,
					pluginRevisionId: references.pluginRevisionId,
				});
			}
		}
	}),
);

it.effect("refuses missing executable references instead of selecting current artifacts", () =>
	Effect.gen(function* () {
		for (const field of ["pluginId", "sandboxScriptId", "pluginRevisionId"] as const) {
			assertExitFails(
				yield* restoreBatchHookPin({ payload, references: { ...references, [field]: null } }).pipe(
					Effect.exit,
				),
				new DbError({ message: "Missing pinned batch hook references" }),
			);
		}
	}),
);
