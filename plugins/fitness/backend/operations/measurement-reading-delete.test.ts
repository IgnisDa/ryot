import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import deleteDefinition, { manifest } from "./measurement-reading-delete.sandbox";
import { MeasurementReadingNotFoundError } from "./measurement-readings";
import { executeMeasurementRyotql } from "./measurement-readings.test-support";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

const recordingHost = (deletes: (readonly string[])[]) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: executeMeasurementRyotql,
		deleteEvents: (ids) =>
			Effect.sync(() => {
				deletes.push(ids);
				return { count: ids.length };
			}),
	});

describe("measurement reading delete operation", () => {
	it.live("deletes every reading in the request once", () =>
		Effect.gen(function* () {
			const deletes: (readonly string[])[] = [];

			expect(
				yield* runSandboxTestScript(
					deleteDefinition,
					{ readingIds: ["reading-1", "reading-2", "reading-1"] },
					recordingHost(deletes),
					execution,
				),
			).toEqual({ count: 2 });
			expect(deletes).toEqual([["reading-1", "reading-2"]]);
		}),
	);

	it.live("rejects any id that is not a measurement reading without deleting", () =>
		Effect.gen(function* () {
			const deletes: (readonly string[])[] = [];
			const host = recordingHost(deletes);

			for (const readingIds of [
				["reading-1", "missing"],
				["reading-1", "note-1"],
				["fake-reading"],
			]) {
				const failure = yield* Effect.flip(
					runSandboxTestScript(deleteDefinition, { readingIds }, host, execution),
				);
				expect(failure).toBeInstanceOf(MeasurementReadingNotFoundError);
			}
			yield* Effect.flip(
				runSandboxTestScript(deleteDefinition, { readingIds: [] }, host, execution),
			);

			expect(deletes).toEqual([]);
		}),
	);
});
