import { createRyotQuery, useRyotQuery, type RyotQueryResult } from "@ryot-app/client-sdk/react";
import { CalendarHeatmap, RankedBarList } from "@ryot-app/client-ui-sdk/charts";
import clsx from "clsx";

import { mediaActivityRecipe, type MediaActivity } from "../../shared/activity-recipes";
import { MediaActivitySummaryFigures } from "../media/activity-rows";
import { formatDateOnlyLabel } from "../media/date";
import { MediaSectionFrame, type MediaRailStatus } from "../media/entity-rail";
import { classifyRyotQueryResult } from "../media/query-state";
import { mediaCountLabel } from "../media/summary-state";
import {
	activityDays,
	activityShares,
	activityStreak,
	activityWindow,
	localDateOf,
	resolveTimeZone,
	type ActivityWindow,
} from "./activity-model";

const TITLE = "Your activity";

type MediaActivityInput = ActivityWindow & { readonly timeZone: string };

export const mediaActivityQuery = createRyotQuery<MediaActivityInput, MediaActivity>(
	({ input, client, signal }) =>
		client.data.query(
			mediaActivityRecipe({ from: input.from, until: input.until, timeZone: input.timeZone }),
			{ signal },
		),
);

const formatHours = (minutes: number) => Math.round(minutes / 60).toLocaleString("en-US");

function ActivityBody(props: {
	readonly compact: boolean;
	readonly timeZone: string;
	readonly window: ActivityWindow;
	readonly activity: MediaActivity;
}) {
	const { window, activity } = props;
	const counts = new Map(
		activity.days.map(({ day, events }) => [localDateOf(day, props.timeZone), events]),
	);
	const shares = activityShares(activity.mediaTypes);
	const shareLabels = new Map(shares.map(({ key, share }) => [key, share]));
	return (
		<div className={clsx("flex flex-col", props.compact ? "gap-4" : "gap-6")}>
			<MediaActivitySummaryFigures
				compact={props.compact}
				figures={[
					{
						label: "Finished",
						detail: undefined,
						value: activity.figures.finished.toLocaleString("en-US"),
					},
					{ label: "Hours", detail: undefined, value: formatHours(activity.figures.minutes) },
					{
						label: "Reviews",
						detail: undefined,
						value: activity.figures.reviews.toLocaleString("en-US"),
					},
					{
						detail: undefined,
						label: "Day streak",
						value: String(activityStreak(new Set(counts.keys()), window.end)),
					},
				]}
			/>
			<CalendarHeatmap
				weekStart={1}
				compact={props.compact}
				days={activityDays(window, counts)}
				ariaLabel="Activity over the last 52 weeks"
				formatTooltip={({ date, value }) =>
					`${value === 0 ? "No activity" : mediaCountLabel(value, "update")} on ${formatDateOnlyLabel(date)}`
				}
			/>
			{shares.length === 0 ? null : (
				<RankedBarList rows={shares} formatValue={({ key }) => shareLabels.get(key) ?? ""} />
			)}
		</div>
	);
}

const sectionStatus = (
	status: ReturnType<typeof classifyRyotQueryResult>["status"],
	retry: () => void,
): MediaRailStatus => {
	if (status === "ready") {
		return { kind: "ready" };
	}
	return status === "loading" ? { kind: "pending" } : { retry, kind: "error" };
};

/** The activity section for one query result; `window` and `timeZone` are what the query ran with. */
export function ActivitySectionView(props: {
	readonly compact: boolean;
	readonly timeZone: string;
	readonly window: ActivityWindow;
	readonly result: RyotQueryResult<MediaActivity>;
}) {
	const state = classifyRyotQueryResult(props.result);
	return (
		<MediaSectionFrame
			title={TITLE}
			compact={props.compact}
			status={sectionStatus(state.status, props.result.refetch)}
			placeholder={
				<div
					className={clsx("animate-pulse rounded-lg bg-surface-2", props.compact ? "h-56" : "h-64")}
				/>
			}
		>
			{state.status === "ready" ? (
				<ActivityBody
					window={props.window}
					activity={state.value}
					compact={props.compact}
					timeZone={props.timeZone}
				/>
			) : null}
		</MediaSectionFrame>
	);
}

export function ActivitySection(props: { readonly compact: boolean; readonly today: string }) {
	const timeZone = resolveTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
	const window = activityWindow(props.today, timeZone);
	const result = useRyotQuery(mediaActivityQuery, { ...window, timeZone });
	return (
		<ActivitySectionView
			window={window}
			result={result}
			timeZone={timeZone}
			compact={props.compact}
		/>
	);
}
