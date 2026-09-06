import { layer } from "@effect/vitest";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { expect as vitestExpect } from "vitest";

import { databaseLayer } from "#lib/test-utils/effect";

import { ImportsService } from "../service";
import { markImportRunStarted } from "./import-run-status";

type ImportRunUpdate = Parameters<ImportsService["Service"]["markStarted"]>[0] & {
	status: "running";
};

class FakeImportRunUpdates extends Context.Service<
	FakeImportRunUpdates,
	{ readonly updates: Effect.Effect<ReadonlyArray<ImportRunUpdate>> }
>()("test/FakeImportRunUpdates") {}

const recordingImportsServiceLayer = Layer.mergeAll(
	databaseLayer,
	Layer.unwrap(
		Effect.gen(function* () {
			const updates = yield* Ref.make<ReadonlyArray<ImportRunUpdate>>([]);
			return Layer.merge(
				Layer.succeed(FakeImportRunUpdates, { updates: Ref.get(updates) }),
				Layer.mock(ImportsService)({
					markStarted: (input) =>
						Ref.update(updates, (all) => [...all, { ...input, status: "running" as const }]).pipe(
							Effect.as("started" as const),
						),
				}),
			);
		}),
	),
);

layer(recordingImportsServiceLayer)((test) => {
	test.effect("marks import runs as running", () =>
		Effect.gen(function* () {
			yield* markImportRunStarted(ImportRunId.make("run_1"));

			vitestExpect(yield* (yield* FakeImportRunUpdates).updates).toEqual([
				{ runId: "run_1", status: "running", startedAt: vitestExpect.any(Date) },
			]);
		}),
	);
});
