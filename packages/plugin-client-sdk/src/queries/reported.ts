import {
	type Reported,
	reportingExecution,
	type ReportingSelection,
	type ResolvedReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import type { TimeZone } from "@ryot-app/contract/schema/time-zone";
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
	readonly client: RyotClient;
	readonly reporting: ResolvedReportingSelection;
};

/** Later pages reuse the first page's pinned selection so clock movement cannot shift the period. */
export const reportingPageParam = (page: {
	readonly reporting: { readonly selection: ReportingSelection };
	readonly pageInfo: { readonly hasMore?: boolean; readonly nextCursor: null | string };
}): ReportingPageParam => {
	const after = nextPageCursor(page);
	return after === null ? null : { after, selection: page.reporting.selection };
};

const reportedQuery = <Input extends ReportingInput, Data extends object, Failure extends Error>(
	window: (input: Input, now: number) => ReportingSelection,
	read: (
		context: ReportedContext<Input> & { readonly now: number },
	) => Effect.Effect<Data, Failure>,
	options: undefined | RyotQueryOptions<Input, Reported<Data>>,
) =>
	createRyotQuery<Input, Reported<Data>, undefined, Failure>(
		({ input, client, schedule }) => {
			const now = schedule.now();
			const reporting = reportingExecution(window(input, now), { now, timeZone: input.timeZone });
			return read({ now, input, client, reporting: reporting.resolved }).pipe(
				Effect.map((data) => ({ ...data, reporting })),
			);
		},
		{ cancelOnUnmount: true, ...options },
	);

const selected = (input: ReportingInput) => input.selection;

export const createReportedQuery = <
	Input extends ReportingInput,
	Data extends object,
	Failure extends Error = RyotClientError,
>(
	read: (context: ReportedContext<Input>) => Effect.Effect<Data, Failure>,
	options?: RyotQueryOptions<Input, Reported<Data>>,
): RyotQuery<Input, Reported<Data>, undefined, Failure> => reportedQuery(selected, read, options);

export const createReportedPageQuery = <
	Input extends ReportingInput,
	Data extends object,
	Failure extends Error = RyotClientError,
>(
	read: (
		context: { readonly after: string | undefined } & ReportedContext<ReportedPageInput<Input>>,
	) => Effect.Effect<Data, Failure>,
	options?: RyotQueryOptions<ReportedPageInput<Input>, Reported<Data>>,
): RyotQuery<ReportedPageInput<Input>, Reported<Data>, undefined, Failure> =>
	reportedQuery(
		(input: ReportedPageInput<Input>) => input.page?.selection ?? input.selection,
		(context) => read({ ...context, after: context.input.page?.after }),
		options,
	);

export const createComparedQuery = <
	Input extends ReportingInput,
	Data,
	Failure extends Error = RyotClientError,
>(
	read: (context: ReportedContext<Input>) => Effect.Effect<Data, Failure>,
	options?: RyotQueryOptions<Input, Compared<Data>>,
): RyotQuery<Input, Compared<Data>, undefined, Failure> =>
	reportedQuery(
		selected,
		(context) =>
			Effect.all(
				{
					current: read(context),
					previous:
						context.reporting.previous === null
							? Effect.succeed(null)
							: read({
									...context,
									reporting: {
										...context.reporting,
										previous: null,
										current: context.reporting.previous,
									},
								}),
				},
				{ concurrency: 2 },
			),
		options,
	);

export const createConsistencyQuery = <
	Input extends ReportingInput,
	Data extends object,
	Failure extends Error = RyotClientError,
>(
	read: (context: ReportedContext<Input>) => Effect.Effect<Data, Failure>,
): RyotQuery<Input, Reported<Data & { readonly clipped: boolean }>, undefined, Failure> =>
	reportedQuery(
		(input: Input, now) => consistencySelection(input, now).selection,
		(context) =>
			read(context).pipe(
				Effect.map((data) =>
					Object.assign({}, data, {
						clipped: consistencySelection(context.input, context.now).clipped,
					}),
				),
			),
		undefined,
	);
