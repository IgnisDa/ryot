import {
	createRyotQuery,
	type RyotQueryResult,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { StatStrip } from "@ryot-app/plugin-ui-sdk";
import { CalendarHeatmap, RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";
import clsx from "clsx";

import { type MediaActivity, mediaActivityRecipe } from "../../shared/activity-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { formatDateOnlyLabel } from "../media/date";
import { type MediaRailStatus, MediaSectionFrame } from "../media/entity-rail";
import { classifyRyotQueryResult } from "../media/query-state";
import { mediaCountLabel } from "../media/summary-state";
import {
	activityDays,
	activityShares,
	activityStreak,
	type ActivityWindow,
	activityWindow,
	localDateOf,
	resolveTimeZone,
} from "./activity-model";

const TITLE = "Your activity";

type MediaActivityInput = ActivityWindow & { readonly timeZone: string };

const mediaActivityQuery = createRyotQuery<MediaActivityInput, MediaActivity>(({ input, client }) =>
	client.data.query(
		mediaActivityRecipe({
			from: input.from,
			until: input.until,
			timeZone: input.timeZone,
			reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
		}),
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
		<div className={clsx("flex flex-col", props.compact ? "gap-5" : "gap-7")}>
			<StatStrip
				compact={props.compact}
				stats={[
					{
						key: "finished",
						label: "Finished",
						value: activity.figures.finished.toLocaleString("en-US"),
					},
					{ key: "hours", label: "Hours", value: formatHours(activity.figures.minutes) },
					{
						key: "reviews",
						label: "Reviews",
						value: activity.figures.reviews.toLocaleString("en-US"),
					},
					{
						key: "streak",
						label: "Day streak",
						value: String(activityStreak(new Set(counts.keys()), window.end)),
					},
				]}
			/>
			<div
				className={clsx(
					"grid gap-6",
					!props.compact && shares.length > 0 && "grid-cols-[minmax(0,1fr)_16rem] items-start",
				)}
			>
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

export function ActivitySection(props: { readonly today: string; readonly compact: boolean }) {
	const timeZone = resolveTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);
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
