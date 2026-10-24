import { PluginLink, type TimeZone, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { paginationItems, useRyotInfiniteQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Dialog,
	EmptyState,
	LoadMoreButton,
	MotionPresence,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { useMemo } from "react";

import { analyticsPageInput, analyticsWorkoutsQuery, nextAnalyticsPage } from "./queries";
import type {
	AnalyticsDisplayPreferences,
	AnalyticsScope,
	WorkoutDrillRequest,
} from "./reporting-model";
import { formatExactValue } from "./reporting-model";

export function AnalyticsWorkoutDrill(props: {
	readonly compact: boolean;
	readonly onClose: () => void;
	readonly scope: AnalyticsScope;
	readonly request: WorkoutDrillRequest;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const viewport = useRyotViewport();
	const result = useRyotInfiniteQuery(
		analyticsWorkoutsQuery,
		{
			reference: props.scope.owner,
			timeZone: props.scope.timeZone,
			selection: props.request.selection,
			...(props.request.filter === undefined ? {} : { filter: props.request.filter }),
		},
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: nextAnalyticsPage,
		},
	);
	const items = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.items,
				({ id }) => id,
			),
		[result.pages],
	);
	const countCaption =
		result.pages.length === 0
			? null
			: `${items.length}${result.hasNextPage ? "+" : ""} ${items.length === 1 ? "workout" : "workouts"}`;
	let errorMessage = "The workouts couldn't be loaded.";
	if (result.errorOperation === "append") {
		errorMessage = "More workouts couldn't be loaded.";
	} else if (result.errorOperation === "refresh") {
		errorMessage = "The workouts couldn't be refreshed.";
	}
	const title = `${props.request.title} · ${props.request.periodCaption}`;

	return (
		<MotionPresence>
			<Dialog
				size="md"
				title={title}
				onClose={props.onClose}
				key="fitness-analytics-workout-drill"
				safeAreaBottom={viewport.safeAreaBottom}
				placement={props.compact ? "sheet" : "center"}
				closeLabel={`Close contributing workouts for ${props.request.title}`}
			>
				<section
					className="flex min-w-0 flex-col gap-3"
					aria-label={`Contributing workouts for ${props.request.title}`}
				>
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
						{countCaption === null ? null : (
							<span className="text-label text-text-muted tabular-nums">{countCaption} loaded</span>
						)}
						<Button
							size="sm"
							variant="secondary"
							onClick={result.refetch}
							disabled={result.isFetching}
						>
							Refresh
						</Button>
					</div>
					{result.pages.length === 0 && result.isError ? (
						<StatusMessage
							tone="error"
							action={{ label: "Try again", onClick: result.retry, disabled: result.isFetching }}
						>
							{errorMessage}
						</StatusMessage>
					) : null}
					{result.pages.length === 0 && !result.isError ? (
						<StatusMessage tone="pending">Loading workouts…</StatusMessage>
					) : null}
					{result.pages.length > 0 ? (
						<>
							{result.operation === "refresh" ? (
								<StatusMessage tone="pending">Refreshing workouts…</StatusMessage>
							) : null}
							{result.isError ? (
								<StatusMessage
									tone="error"
									action={{
										label: "Try again",
										onClick: result.retry,
										disabled: result.isFetching,
									}}
								>
									{errorMessage}
								</StatusMessage>
							) : null}
							{items.length === 0 ? (
								<EmptyState title="No contributing workouts" />
							) : (
								<WorkoutTable items={items} timeZone={props.scope.timeZone} />
							)}
							{result.hasNextPage && !result.isError ? (
								<LoadMoreButton
									variant="secondary"
									className="self-center"
									label="Show more workouts"
									disabled={result.isFetching}
									onClick={result.fetchNextPage}
									isFetchingNextPage={result.isFetchingNextPage}
								/>
							) : null}
						</>
					) : null}
				</section>
			</Dialog>
		</MotionPresence>
	);
}

function WorkoutTable(props: {
	readonly timeZone: TimeZone;
	readonly items: readonly {
		readonly id: string;
		readonly name: string;
		readonly startedAt: string;
		readonly activeDuration: null | number;
	}[];
}) {
	return (
		<Card padding="none" className="overflow-x-auto">
			<table className="w-full min-w-125 border-collapse text-sm tabular-nums">
				<caption className="sr-only">Contributing workouts</caption>
				<thead>
					<tr>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Workout
						</th>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Started
						</th>
						<th scope="col" className="px-3 py-2.5 text-right font-medium text-text-muted">
							Active duration
						</th>
					</tr>
				</thead>
				<tbody>
					{props.items.map((workout) => (
						<tr key={workout.id} className="border-t border-border">
							<td className="px-3 py-2.5">
								<PluginLink
									className="font-medium text-accent-text"
									to={{ kind: "entity", entityId: workout.id }}
								>
									{workout.name}
								</PluginLink>
							</td>
							<td className="px-3 py-2.5 text-text-muted">
								<time dateTime={workout.startedAt}>
									{formatWorkoutStart(workout.startedAt, props.timeZone)}
								</time>
							</td>
							<td className="px-3 py-2.5 text-right text-text-muted">
								{formatExactValue(workout.activeDuration, "seconds")}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</Card>
	);
}

const formatWorkoutStart = (startedAt: string, timeZone: TimeZone) =>
	new Intl.DateTimeFormat("en-US", { timeZone, timeStyle: "short", dateStyle: "medium" }).format(
		new Date(startedAt),
	);
