import {
	type Reported,
	reportingExecution,
	type ReportingSelection,
	type ResolvedReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { TimeZone } from "@ryot-app/contract/schema/time-zone";
import type { Recipe } from "@ryot-app/ryotql";
import * as Effect from "effect/Effect";

import { consistencySelection } from "../analytics/reporting";
import type { RyotClient } from "../client/client";
import type { RyotClientError } from "../client/errors";
import { createRyotQuery, type RyotQuery, type RyotQueryOptions } from "./definitions";
import { nextPageCursor } from "./pagination";

export type ReportedPageInput<Input> = Input & { readonly page: ReportingPageParam };
export type Compared<Data> = Reported<{ readonly current: Data; readonly previous: null | Data }>;
export type ReportingInput = {
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
};
export type ReportingPageParam = null | {
	readonly after: string;
	readonly selection: ReportingSelection;
};

type ReportedContext<Input> = {
	readonly input: Input;
	readonly selection: ReportingSelection;
	readonly comparison: "current" | "previous";
	readonly query: <Data, const Parameters extends AppSchema, Output>(
		recipe: Recipe<Data, Parameters>,
		arguments_: NoInfer<Recipe.Arguments<Recipe<Data, Parameters>>>,
		options: undefined | Omit<ExecutionRequest, "source" | "arguments">,
		project: (data: Data, reporting: ResolvedReportingSelection) => Output,
	) => Effect.Effect<Reported<Output>, RyotClientError>;
};

export const reportingPageParam = (page: {
	readonly reporting: { readonly requestedSelection: ReportingSelection };
	readonly pageInfo: { readonly hasMore?: boolean; readonly nextCursor: null | string };
}): ReportingPageParam => {
	const after = nextPageCursor(page);
	return after === null ? null : { after, selection: page.reporting.requestedSelection };
};

const reportedContext = <Input extends ReportingInput>(
	input: Input,
	client: RyotClient,
	selection: ReportingSelection,
	consistency = false,
	comparison: "current" | "previous" = "current",
): ReportedContext<Input> => ({
	input,
	selection,
	comparison,
	query: (recipe, arguments_, options, project) =>
		client.data.queryWithExecution(recipe, arguments_, options).pipe(
			Effect.map(({ data, execution }) => {
				const resolvedSelection = consistency
					? consistencySelection({ selection, timeZone: execution.timeZone }, execution.now)
							.selection
					: selection;
				const reporting = {
					...reportingExecution(resolvedSelection, execution),
					requestedSelection: selection,
				};
				return Object.assign({}, project(data, reporting.resolved), { reporting });
			}),
		),
});

export const createReportedQuery = <
	Input extends ReportingInput,
	Data extends object,
	Failure extends Error = RyotClientError,
>(
	read: (context: ReportedContext<Input>) => Effect.Effect<Reported<Data>, Failure>,
	options?: RyotQueryOptions<Input, Reported<Data>>,
): RyotQuery<Input, Reported<Data>, Failure> =>
	createRyotQuery(({ input, client }) => read(reportedContext(input, client, input.selection)), {
		cancelOnUnmount: true,
		...options,
	});

export const createReportedPageQuery = <
	Input extends ReportingInput,
	Data extends object,
	Failure extends Error = RyotClientError,
>(
	read: (
		context: { readonly after: string | undefined } & ReportedContext<ReportedPageInput<Input>>,
	) => Effect.Effect<Reported<Data>, Failure>,
	options?: RyotQueryOptions<ReportedPageInput<Input>, Reported<Data>>,
): RyotQuery<ReportedPageInput<Input>, Reported<Data>, Failure> =>
	createRyotQuery(
		({ input, client }) =>
			read({
				...reportedContext(input, client, input.page?.selection ?? input.selection),
				after: input.page?.after,
			}),
		{ cancelOnUnmount: true, ...options },
	);

export const createComparedQuery = <
	Input extends ReportingInput,
	Data,
	Failure extends Error = RyotClientError,
>(
	read: (context: ReportedContext<Input>) => Effect.Effect<Reported<Data>, Failure>,
	options?: RyotQueryOptions<Input, Compared<Data>>,
): RyotQuery<Input, Compared<Data>, Failure> =>
	createRyotQuery<Input, Compared<Data>, Failure>(
		({ input, client }) =>
			Effect.all(
				{
					current: read(reportedContext(input, client, input.selection)),
					previous:
						input.selection.comparison === "none" || input.selection.range.kind === "all-time"
							? Effect.succeed(null)
							: read(reportedContext(input, client, input.selection, false, "previous")),
				},
				{ concurrency: 2 },
			).pipe(
				Effect.map(({ current, previous }) => ({
					current,
					previous,
					reporting: {
						...current.reporting,
						resolved:
							current.reporting.resolved.current === null
								? current.reporting.resolved
								: {
										...current.reporting.resolved,
										previous: previous?.reporting.resolved.previous ?? null,
									},
					},
				})),
			),
		{ cancelOnUnmount: true, ...options },
	);

export const createConsistencyQuery = <
	Input extends ReportingInput,
	Data extends object,
	Failure extends Error = RyotClientError,
>(
	read: (context: ReportedContext<Input>) => Effect.Effect<Reported<Data>, Failure>,
): RyotQuery<Input, Reported<Data & { readonly clipped: boolean }>, Failure> =>
	createRyotQuery<Input, Reported<Data & { readonly clipped: boolean }>, Failure>(
		({ input, client }) =>
			read(reportedContext(input, client, input.selection, true)).pipe(
				Effect.map((data) =>
					Object.assign({}, data, {
						clipped: consistencySelection(
							{ selection: input.selection, timeZone: data.reporting.resolved.timeZone },
							data.reporting.now,
						).clipped,
					}),
				),
			),
		{ cancelOnUnmount: true },
	);
