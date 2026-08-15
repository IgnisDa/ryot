import { createRyotMutation, createRyotQuery } from "@ryot-app/client-sdk/react";
import type { ContractRequest } from "@ryot-app/contract/client";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import {
	importRunRecipe,
	manualImportRunsRecipe,
	type ImportRunDetail,
	type ImportRunList,
} from "@ryot-app/ryotql-recipes/import-runs";
import {
	importSourcesRecipe,
	type ImportSourcesPage,
} from "@ryot-app/ryotql-recipes/import-sources";
import { Context, Data, Effect, Layer } from "effect";

import { ImportsApi } from "#/api/imports";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { KernelHostServices } from "#/host-services";

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

export const importRunsQuery = createRyotQuery<
	{ readonly limit: number },
	ImportRunList,
	KernelHostServices
>(({ input, client, signal, hostServices }) =>
	hostServices.runtime.runPromise(
		Effect.flatMap(ImportsService, (service) => service.loadRuns(client, input)),
		{ signal },
	),
);

export const importRunQuery = createRyotQuery<
	{ readonly runId: string; readonly failureLimit: number },
	ImportRunDetail,
	KernelHostServices
>(({ input, client, signal, hostServices }) =>
	hostServices.runtime.runPromise(
		Effect.flatMap(ImportsService, (service) => service.loadRun(client, input)),
		{ signal },
	),
);

export const importSourcesQuery = createRyotQuery<
	void,
	readonly ImportSourceItem[],
	KernelHostServices
>(({ client, signal }) => {
	const load = async (
		after?: string,
		previous: readonly ImportSourceItem[] = [],
	): Promise<readonly ImportSourceItem[]> => {
		const page = await client.data.query(importSourcesRecipe({ after, limit: 100 }), { signal });
		const sources = [
			...previous,
			...page.items.map(({ id: _id, exportHelp, ...source }) => ({
				...source,
				...(exportHelp === null ? {} : { exportHelp }),
			})),
		];
		return page.pageInfo.nextCursor === null ? sources : load(page.pageInfo.nextCursor, sources);
	};
	return load();
});

export type ImportSourceItem = Omit<ImportSourcesPage["items"][number], "id" | "exportHelp"> & {
	readonly exportHelp?: NonNullable<ImportSourcesPage["items"][number]["exportHelp"]>;
};

type CreateRunPayload = ContractRequest<"imports", "createRun">["payload"];

export const createImportRunMutation = createRyotMutation<
	CreateRunPayload,
	unknown,
	KernelHostServices
>(async ({ input, client, signal, hostServices }) => {
	const created = await hostServices.runtime.runPromise(
		Effect.flatMap(ImportsApi, (api) => api.createRun(hostServices.scope, { payload: input })),
		{ signal },
	);
	client.mutationCompleted.hint();
	return created;
});

export const deleteImportRunMutation = createRyotMutation<string, unknown, KernelHostServices>(
	async ({ input, client, signal, hostServices }) => {
		const deleted = await hostServices.runtime.runPromise(
			Effect.flatMap(ImportsApi, (api) =>
				api.deleteRun(hostServices.scope, { params: { runId: ImportRunId.make(input) } }),
			),
			{ signal },
		);
		client.mutationCompleted.hint();
		return deleted;
	},
);
