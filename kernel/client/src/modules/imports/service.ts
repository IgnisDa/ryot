import { importRunRecipe, manualImportRunsRecipe } from "@ryot-app/ryotql-recipes/import-runs";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";

export const IMPORT_RUNS_PAGE_SIZE = 20;
export const IMPORT_FAILURES_PAGE_SIZE = 25;

type ImportsClient = Pick<KernelRyotClient, "data">;

export class ImportsLoadError extends Data.TaggedError("ImportsLoadError")<{
	readonly cause: unknown;
	readonly stage: "run" | "runs";
}> {}

export class ImportsService extends Context.Service<ImportsService>()("ImportsService", {
	make: Effect.sync(() => {
		const loadRuns = Effect.fn("ImportsService.loadRuns")(function* (
			client: ImportsClient,
			input: { readonly limit: number },
		) {
			return yield* Effect.tryPromise({
				catch: (cause) => new ImportsLoadError({ cause, stage: "runs" }),
				try: (signal) =>
					client.data.query(manualImportRunsRecipe({ limit: input.limit }), { signal }),
			});
		});
		const loadRun = Effect.fn("ImportsService.loadRun")(function* (
			client: ImportsClient,
			input: { readonly runId: string; readonly failureLimit: number },
		) {
			return yield* Effect.tryPromise({
				catch: (cause) => new ImportsLoadError({ cause, stage: "run" }),
				try: (signal) =>
					client.data.query(
						importRunRecipe({ runId: input.runId, failureLimit: input.failureLimit }),
						{ signal },
					),
			});
		});

		return { loadRun, loadRuns };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
