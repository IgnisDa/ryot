import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	type RyotQueryResult,
	useReportingPreferences,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { StatStrip, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { CalendarHeatmap, RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";
import clsx from "clsx";
import { useEffect } from "react";

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

type MediaActivityInput = { readonly timeZone: string };
type MediaActivityResult = { readonly window: ActivityWindow; readonly activity: MediaActivity };

const mediaActivityQuery = createRyotQuery<MediaActivityInput, MediaActivityResult>(
	({ input, client, schedule }) => {
		const window = activityWindow(
			localDateOf(new Date(schedule.now()).toISOString(), input.timeZone),
			input.timeZone,
		);
		return client.data
			.query(
				mediaActivityRecipe({
					from: window.from,
					until: window.until,
					timeZone: input.timeZone,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
			)
			.pipe(Effect.map((activity) => ({ window, activity })));
	},
	{ cancelOnUnmount: true, refreshWhile: ({ data }) => data.activity.processing === "pending" },
);

const formatHours = (minutes: number) => Math.round(minutes / 60).toLocaleString("en-US");

function ActivityBody(props: {
	readonly compact: boolean;
	readonly window: ActivityWindow;
	readonly activity: MediaActivity;
}) {
	const { window, activity } = props;
	if (activity.processing !== "ready") {
		return (
			<StatusMessage tone={activity.processing === "failed" ? "error" : "pending"}>
				{activity.processing === "failed" ? "Consumption repair failed." : "Updating consumption…"}
			</StatusMessage>
		);
	}
	const counts = new Map(activity.days.map(({ day, events }) => [day, events]));
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
					{
						key: "hours",
						label: "Hours",
						value:
							activity.figures.minutesMissing > 0
								? `≥${Math.floor(activity.figures.minutes / 60).toLocaleString("en-US")}`
								: formatHours(activity.figures.minutes),
					},
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

export function ActivitySection(props: { readonly compact: boolean }) {
	const preferences = useReportingPreferences();
	if (preferences.data === undefined) {
		return (
			<MediaSectionFrame
				title={TITLE}
				compact={props.compact}
				action={<AnalyticsLink />}
				placeholder={<ActivityPlaceholder compact={props.compact} />}
				status={
					preferences.isError ? { kind: "error", retry: preferences.refetch } : { kind: "pending" }
				}
			>
				{null}
			</MediaSectionFrame>
		);
	}
	return (
		<ActivitySectionForTimeZone
			compact={props.compact}
			retryPreferences={preferences.refetch}
			preferencesRefreshingFailed={preferences.isError}
			timeZone={resolveTimeZone(preferences.data.timeZone)}
		/>
	);
}

export function ActivitySectionView(props: {
	readonly compact: boolean;
	readonly retryPreferences?: () => void;
	readonly preferencesRefreshingFailed?: boolean;
	readonly result: RyotQueryResult<MediaActivityResult>;
}) {
	const state = classifyRyotQueryResult(props.result);
	const hasData = state.status === "ready";
	return (
		<MediaSectionFrame
			title={TITLE}
			compact={props.compact}
			action={<AnalyticsLink />}
			placeholder={<ActivityPlaceholder compact={props.compact} />}
			status={hasData ? { kind: "ready" } : sectionStatus(state.status, props.result.refetch)}
		>
			{hasData ? (
				<div className="grid min-w-0 gap-3">
					{props.preferencesRefreshingFailed && props.retryPreferences !== undefined ? (
						<StatusMessage
							tone="error"
							action={{ label: "Retry preferences", onClick: props.retryPreferences }}
						>
							Reporting preferences could not be refreshed. The last loaded time zone is being used.
						</StatusMessage>
					) : null}
					{props.result.isError ? (
						<StatusMessage
							tone="error"
							action={{ label: "Try again", onClick: props.result.refetch }}
						>
							Your activity could not be refreshed. The last loaded activity is being shown.
						</StatusMessage>
					) : null}
					<ActivityBody
						compact={props.compact}
						window={state.value.window}
						activity={state.value.activity}
					/>
				</div>
			) : null}
		</MediaSectionFrame>
	);
}

function ActivityPlaceholder(props: { readonly compact: boolean }) {
	return (
		<div
			className={clsx(
				"animate-pulse motion-reduce:animate-none rounded-lg bg-surface-2",
				props.compact ? "h-56" : "h-64",
			)}
		/>
	);
}

function AnalyticsLink() {
	return (
		<PluginLink
			to={{ kind: "saved-view", reference: { kind: "kernel", slug: "analytics" } }}
			className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
		>
			Analytics
		</PluginLink>
	);
}

function ActivitySectionForTimeZone(props: {
	readonly compact: boolean;
	readonly timeZone: string;
	readonly retryPreferences: () => void;
	readonly preferencesRefreshingFailed: boolean;
}) {
	const schedule = useRyotSchedule();
	const result = useRyotQuery(mediaActivityQuery, { timeZone: props.timeZone });
	const until = result.data?.window.until;
	useEffect(() => {
		if (until === undefined) {
			return undefined;
		}
		const delay = Date.parse(until) - schedule.now();
		return delay > 0 ? schedule.after(delay, result.refetch) : undefined;
	}, [result.refetch, schedule, until]);
	return (
		<ActivitySectionView
			result={result}
			compact={props.compact}
			retryPreferences={props.retryPreferences}
			preferencesRefreshingFailed={props.preferencesRefreshingFailed}
		/>
	);
}
