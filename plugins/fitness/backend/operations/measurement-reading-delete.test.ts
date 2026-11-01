import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { executeMeasurementRyotql } from "./in-memory-ryotql.test-support";
import deleteDefinition, { manifest } from "./measurement-reading-delete.sandbox";
import { MeasurementEntryNotFoundError } from "./measurement-readings";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

describe("measurement reading delete operation", () => {
	it.live("deletes the entry so all session children are removed, without client reading IDs", () =>
		Effect.gen(function* () {
			const deletes: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: executeMeasurementRyotql,
				deleteUserEntity: (item) =>
					Effect.sync(() => {
						deletes.push(item);
						return { entityId: item.entityId };
					}),
			});
			expect(
				yield* runSandboxTestScript(deleteDefinition, { entryId: "entry-1" }, host, execution),
			).toEqual({ count: 2 });
			expect(deletes).toEqual([{ entityId: "entry-1", entitySchemaSlug: "measurement-entry" }]);
		}),
	);

	it.live("rejects missing, wrong-schema and non-owned entries before deleting", () =>
		Effect.gen(function* () {
			const deletes: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: executeMeasurementRyotql,
				deleteUserEntity: (item) =>
					Effect.sync(() => {
						deletes.push(item);
						return { entityId: item.entityId };
					}),
			});
			for (const entryId of ["missing", "weight", "fake-reading"]) {
				expect(
					yield* Effect.flip(runSandboxTestScript(deleteDefinition, { entryId }, host, execution)),
				).toBeInstanceOf(MeasurementEntryNotFoundError);
			}
			yield* Effect.flip(runSandboxTestScript(deleteDefinition, { entryId: "" }, host, execution));
			expect(deletes).toEqual([]);
		}),
	);
});
