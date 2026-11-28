import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import deleteDefinition, { manifest } from "./measurement-reading-delete.sandbox";
import { executeMeasurementRyotql } from "./measurement-ryotql.test-support";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

describe("measurement reading delete operation", () => {
	it.live(
		"deletes the entry so all session children are removed, without client reading IDs",
		() =>
			Effect.gen(function* () {
				const host = defineSandboxTestHost(manifest, { executeRyotql: executeMeasurementRyotql });
				expect(
					yield* runSandboxTestScript(deleteDefinition, { entryId: "entry-1" }, host, execution),
				).toEqual<unknown>({
					output: { count: 2 },
					changes: {
						entities: { deletes: [{ entityId: "entry-1", entitySchemaSlug: "measurement-entry" }] },
					},
				});
			}),
		testTimeout,
	);

	it.live(
		"rejects missing, wrong-schema and non-owned entries",
		() =>
			Effect.gen(function* () {
				const host = defineSandboxTestHost(manifest, { executeRyotql: executeMeasurementRyotql });
				for (const entryId of ["missing", "weight", "fake-reading"]) {
					expect(
						yield* Effect.flip(
							runSandboxTestScript(deleteDefinition, { entryId }, host, execution),
						),
					).toMatchObject({
						_tag: "OperationRejectedError",
						reason: { key: "rejection.measurement-entry.missing" },
					});
				}
				yield* Effect.flip(
					runSandboxTestScript(deleteDefinition, { entryId: "" }, host, execution),
				);
			}),
		testTimeout,
	);
});
