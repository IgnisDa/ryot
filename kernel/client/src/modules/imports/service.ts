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

import type { AuthenticatedApiError } from "#/api/authenticated";
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
			return yield* client.data
				.query(manualImportRunsRecipe({ limit: input.limit }))
				.pipe(Effect.mapError((cause) => new ImportsLoadError({ cause, stage: "runs" })));
		});
		const loadRun = Effect.fn("ImportsService.loadRun")(function* (
			client: ImportsClient,
			input: { readonly runId: string; readonly failureLimit: number },
		) {
			return yield* client.data
				.query(importRunRecipe({ runId: input.runId, failureLimit: input.failureLimit }))
				.pipe(Effect.mapError((cause) => new ImportsLoadError({ cause, stage: "run" })));
		});

		return { loadRun, loadRuns };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const importRunsQuery = createRyotQuery<
	{ readonly limit: number },
	ImportRunList,
	KernelHostServices,
	ImportsLoadError
>(({ input, client, hostServices }) =>
	hostServices.runtime.runSync(ImportsService).loadRuns(client, input),
);

export const importRunQuery = createRyotQuery<
	{ readonly runId: string; readonly failureLimit: number },
	ImportRunDetail,
	KernelHostServices,
	ImportsLoadError
>(({ input, client, hostServices }) =>
	hostServices.runtime.runSync(ImportsService).loadRun(client, input),
);

export const importSourcesQuery = createRyotQuery<
	void,
	readonly ImportSourceItem[],
	KernelHostServices
>(({ client }) =>
	Effect.gen(function* () {
		const sources: ImportSourceItem[] = [];
		let after: string | null | undefined;
		do {
			const page = yield* client.data.query(
				importSourcesRecipe({ limit: 100, after: after ?? undefined }),
			);
			sources.push(
				...page.items.map(({ id: _id, exportHelp, ...source }) => ({
					...source,
					...(exportHelp === null ? {} : { exportHelp }),
				})),
			);
			after = page.pageInfo.nextCursor;
		} while (after !== null);
		return sources;
	}),
);

export type ImportSourceItem = Omit<ImportSourcesPage["items"][number], "id" | "exportHelp"> & {
	readonly exportHelp?: NonNullable<ImportSourcesPage["items"][number]["exportHelp"]>;
};

type CreateRunPayload = ContractRequest<"imports", "createRun">["payload"];

export const createImportRunMutation = createRyotMutation<
	CreateRunPayload,
	unknown,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(ImportsApi)
		.createRun(hostServices.scope, { payload: input })
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);

export const deleteImportRunMutation = createRyotMutation<
	string,
	unknown,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(ImportsApi)
		.deleteRun(hostServices.scope, { params: { runId: ImportRunId.make(input) } })
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);

export const cancelImportRunMutation = createRyotMutation<
	string,
	unknown,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(ImportsApi)
		.cancelRun(hostServices.scope, { params: { runId: ImportRunId.make(input) } })
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);
