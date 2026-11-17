import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	localDateOf,
	PluginLink,
	type ReportingCalendar,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	type Formatters,
	type RyotQueryResult,
	useFormatters,
	useRyotQuery,
	useRyotSchedule,
	useT,
	useUserPreferences,
} from "@ryot-app/plugin-client-sdk/react";
import { countUnit, StatStrip, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { CalendarHeatmap, RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";
import clsx from "clsx";
import { useEffect, useMemo } from "react";

import { type MediaActivity, mediaHomeActivityRecipe } from "../../shared/activity-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { type MediaRailStatus, MediaSectionFrame } from "../media/entity-rail";
import { classifyRyotQueryResult } from "../media/query-state";
import { useMediaMessages } from "../messages";
import {
	activityDays,
	activityShares,
	activityStreak,
	type ActivityWindow,
	activityWindow,
} from "./activity-model";

type MediaActivityInput = ReportingCalendar;
type MediaActivityResult = { readonly window: ActivityWindow; readonly activity: MediaActivity };

const mediaActivityQuery = createRyotQuery<MediaActivityInput, MediaActivityResult>(
	({ input, client, schedule }) => {
		const window = activityWindow(localDateOf(schedule.now(), input.timeZone), input);
		return client.data
			.query(mediaHomeActivityRecipe(client.pluginIdentity(PLUGIN_PACKAGE_ID)), {})
			.pipe(Effect.map((activity) => ({ window, activity })));
	},
	{ cancelOnUnmount: true },
);

const formatHours = (formatters: Formatters, minutes: number) =>
	formatters.number().format(Math.round(minutes / 60));

function ActivityBody(props: {
	readonly compact: boolean;
	readonly window: ActivityWindow;
	readonly activity: MediaActivity;
}) {
	const formatters = useFormatters();
	const { window, activity } = props;
	const t = useT();
	const text = useMediaMessages();
	const activityUnit = useMemo(
		() => countUnit((count) => text("home.activity.unit-update", { count })),
		[text],
	);
	const counts = new Map(activity.days.map(({ day, events }) => [day, events]));
	const shares = activityShares(
		activity.mediaTypes.map(({ slug, label, events }) => ({ slug, events, label: t(label) })),
		formatters,
		{
			other: text("home.activity.everything-else"),
			underOne: text("home.activity.share-under-one", { percent: 0.01 }),
		},
	);
	const shareLabels = new Map(shares.map(({ key, share }) => [key, share]));
	return (
		<div className={clsx("flex flex-col", props.compact ? "gap-5" : "gap-7")}>
			<StatStrip
				compact={props.compact}
				stats={[
					{
						key: "finished",
						label: text("log.when.finished"),
						value: formatters.number().format(activity.figures.finished),
					},
					{
						key: "hours",
						label: text("home.activity.hours"),
						value:
							activity.figures.minutesMissing > 0
								? text("home.activity.hours-at-least", {
										hours: Math.floor(activity.figures.minutes / 60),
									})
								: formatHours(formatters, activity.figures.minutes),
					},
					{
						key: "reviews",
						label: text("activity.figure-reviews"),
						value: formatters.number().format(activity.figures.reviews),
					},
					{
						key: "streak",
						label: text("home.activity.day-streak"),
						value: formatters.number().format(activityStreak(new Set(counts.keys()), window.end)),
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
					unit={activityUnit}
					compact={props.compact}
					weekStart={window.weekStart}
					days={activityDays(window, counts)}
					ariaLabel={text("home.activity.heatmap-label")}
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
	const text = useMediaMessages();
	const preferences = useUserPreferences();
	if (preferences.data === undefined) {
		return (
			<MediaSectionFrame
				compact={props.compact}
				action={<AnalyticsLink />}
				title={text("home.activity.title")}
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
			timeZone={preferences.data.timeZone}
			weekStart={preferences.data.weekStart}
			retryPreferences={preferences.refetch}
			preferencesRefreshingFailed={preferences.isError}
		/>
	);
}

export function ActivitySectionView(props: {
	readonly compact: boolean;
	readonly retryPreferences?: () => void;
	readonly preferencesRefreshingFailed?: boolean;
	readonly result: RyotQueryResult<MediaActivityResult>;
}) {
	const text = useMediaMessages();
	const state = classifyRyotQueryResult(props.result);
	const hasData = state.status === "ready";
	return (
		<MediaSectionFrame
			compact={props.compact}
			action={<AnalyticsLink />}
			title={text("home.activity.title")}
			placeholder={<ActivityPlaceholder compact={props.compact} />}
			status={hasData ? { kind: "ready" } : sectionStatus(state.status, props.result.refetch)}
		>
			{hasData ? (
				<div className="grid min-w-0 gap-3">
					{props.preferencesRefreshingFailed && props.retryPreferences !== undefined ? (
						<StatusMessage
							tone="error"
							action={{
								onClick: props.retryPreferences,
								label: text("home.activity.retry-preferences"),
							}}
						>
							{text("home.activity.preferences-failed")}
						</StatusMessage>
					) : null}
					{props.result.isError ? (
						<StatusMessage
							tone="error"
							action={{ onClick: props.result.refetch, label: text("common.action.try-again") }}
						>
							{text("home.activity.refresh-failed")}
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
	const text = useMediaMessages();
	return (
		<PluginLink
			to={{ kind: "saved-view", reference: { kind: "kernel", slug: "analytics" } }}
			className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
		>
			{text("home.activity.analytics-link")}
		</PluginLink>
	);
}

function ActivitySectionForTimeZone(props: {
	readonly compact: boolean;
	readonly retryPreferences: () => void;
	readonly preferencesRefreshingFailed: boolean;
	readonly timeZone: ReportingCalendar["timeZone"];
	readonly weekStart: ReportingCalendar["weekStart"];
}) {
	const schedule = useRyotSchedule();
	const result = useRyotQuery(mediaActivityQuery, {
		timeZone: props.timeZone,
		weekStart: props.weekStart,
	});
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
