import clsx from "clsx";
import { Match } from "effect";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AppStatusState } from "@/modules/ui/status-state";

import {
	showActivityDateLabel,
	showActivityEpisodesLabel,
	showActivityError,
	showActivityRatingLabel,
	showActivityRowLabel,
	showActivitySpanLabel,
	showActivityTimeLabel,
	showActivityWatchesLabel,
	type ShowActivityCollectionRow,
	type ShowActivityCompletedWatch,
	type ShowActivityCoverage,
	type ShowActivityReviewRow,
	type ShowActivityRow,
	type ShowActivitySeasonCoverage,
	type ShowActivityState,
	type ShowActivitySummary,
	type ShowActivityTimeline,
	type ShowActivityView,
	type ShowActivityWatchRow,
} from "./show-activity-state";
import { ShowFact, ShowLinkButton, ShowStatusMessage } from "./show-primitives";

function ShowActivitySummaryFigures(props: { readonly summary: ShowActivitySummary }) {
	const { summary } = props;
	const span = showActivitySpanLabel(summary);
	const figures = [
		{ label: "Episodes", value: showActivityEpisodesLabel(summary), detail: undefined },
		{ label: "Watches", value: showActivityWatchesLabel(summary), detail: undefined },
		{ label: "Time", value: showActivityTimeLabel(summary), detail: undefined },
		{ label: span.label, value: span.value, detail: span.detail },
	];
	return (
		<View className="flex-row flex-wrap gap-y-4 rounded-lg border border-border bg-surface px-3.5 py-3">
			{figures.map((figure) => (
				<View key={figure.label} className="w-1/2 gap-0.5 md:w-1/4">
					<ShowFact label={figure.label} value={figure.value} />
					{figure.detail === undefined ? null : (
						<Text className="font-ui text-[11px] text-text-subtle">{figure.detail}</Text>
					)}
				</View>
			))}
		</View>
	);
}

function ShowActivityCoverageRow(props: { readonly season: ShowActivitySeasonCoverage }) {
	const { season } = props;
	return (
		<View className="h-4 flex-row items-center gap-3">
			<Text className="w-16 font-ui text-[11.5px] text-text-muted">{season.label}</Text>
			<View className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-2">
				<View
					className={clsx(
						"h-full rounded-pill",
						season.watched === season.total ? "bg-success" : "bg-accent",
					)}
					style={{ width: `${season.percent ?? 0}%` }}
				/>
			</View>
			<Text className="w-14 text-right font-ui text-[11.5px] text-text-subtle tabular-nums">
				{`${season.watched}/${season.total}`}
			</Text>
		</View>
	);
}

function ShowActivityCoverageStrip(props: { readonly coverage: ShowActivityCoverage }) {
	const { coverage } = props;
	const rows = [
		...coverage.seasons,
		...(coverage.specials === undefined ? [] : [coverage.specials]),
	];
	if (rows.length === 0) {
		return null;
	}
	return (
		<View className="gap-2.5">
			<Text className="font-ui-medium text-[11px] tracking-widest text-text-subtle uppercase">
				Coverage
			</Text>
			<View className="gap-2">
				{rows.map((season) => (
					<ShowActivityCoverageRow key={season.seasonNumber} season={season} />
				))}
			</View>
		</View>
	);
}

function ShowActivityMarker(props: { readonly row: ShowActivityRow }) {
	const tone = Match.value(props.row).pipe(
		Match.when({ type: "watch" }, () => "bg-success"),
		Match.when({ type: "review" }, () => "bg-gold"),
		Match.when({ type: "progress" }, () => "bg-accent"),
		Match.when({ type: "completion" }, () => "bg-accent"),
		Match.when({ type: "beat" }, () => "bg-border-strong"),
		Match.when({ type: "collection" }, () => "bg-transparent"),
		Match.exhaustive,
	);
	const isBeat = props.row.type === "completion";
	return (
		<View
			className={clsx(
				"rounded-pill",
				tone,
				isBeat && "h-3 w-3 border-2 border-accent bg-transparent",
				!isBeat && "h-2 w-2",
				props.row.type === "collection" && "border border-border-strong",
			)}
		/>
	);
}

function ShowActivityReviewBody(props: { readonly text: string; readonly isSpoiler: boolean }) {
	const [isRevealed, setIsRevealed] = useState(false);
	if (props.isSpoiler && !isRevealed) {
		return (
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Show spoiler review"
				onPress={() => setIsRevealed(true)}
				className="self-start rounded-md border border-border bg-surface-2 px-2.5 py-1.5"
			>
				<Text className="font-ui text-[12px] text-text-muted">Spoiler — show review</Text>
			</Pressable>
		);
	}
	return <Text className="font-ui text-[13px] leading-5 text-text-muted">{props.text}</Text>;
}

function ShowActivityWatchBody(props: { readonly row: ShowActivityWatchRow }) {
	if (props.row.episodes.length === 1) {
		return null;
	}
	return (
		<View className="gap-0.5">
			{props.row.episodes.map((episode) => (
				<View key={episode.id} className="flex-row gap-2">
					<Text className="w-14 font-ui text-[12px] text-text-subtle">{episode.origin}</Text>
					<Text numberOfLines={1} className="min-w-0 flex-1 font-ui text-[12px] text-text-muted">
						{episode.name}
					</Text>
				</View>
			))}
		</View>
	);
}

function ShowActivityReviewDetail(props: { readonly row: ShowActivityReviewRow }) {
	const { row } = props;
	return (
		<View className="gap-1 border-l-2 border-gold pl-2.5">
			{row.rating === undefined ? null : (
				<Text className="font-ui-medium text-[11px] text-gold">
					{showActivityRatingLabel(row.rating)}
				</Text>
			)}
			{row.body === undefined ? null : (
				<ShowActivityReviewBody text={row.body.text} isSpoiler={row.body.isSpoiler} />
			)}
		</View>
	);
}

function ShowActivityRowBody(props: { readonly row: ShowActivityRow }) {
	return Match.value(props.row).pipe(
		Match.when({ type: "watch" }, (row) => <ShowActivityWatchBody row={row} />),
		Match.when({ type: "review" }, (row) => <ShowActivityReviewDetail row={row} />),
		Match.orElse(() => null),
	);
}

const rowSource = (row: ShowActivityRow) =>
	row.type === "watch" || row.type === "progress" ? row.source : undefined;

const isQuietRow = (row: ShowActivityRow): row is ShowActivityCollectionRow =>
	row.type === "collection";

function ShowActivityEntry(props: {
	readonly isLast: boolean;
	readonly row: ShowActivityRow;
	readonly showDate: boolean;
}) {
	const { row } = props;
	const source = rowSource(row);
	const isHeading = row.type === "completion" || row.type === "beat";
	return (
		<View className="flex-row">
			<View className="w-16 pt-1.5">
				{props.showDate ? (
					<Text className="font-ui text-[11px] text-text-subtle">{showActivityDateLabel(row)}</Text>
				) : null}
			</View>
			<View className="w-3.5 items-center pt-2">
				<ShowActivityMarker row={row} />
				{props.isLast ? null : <View className="w-px flex-1 bg-border" />}
			</View>
			<View className={clsx("min-w-0 flex-1 gap-1.5 pl-3", !props.isLast && "pb-4")}>
				<View className="flex-row items-baseline justify-between gap-2.5">
					<Text
						className={clsx(
							"min-w-0 flex-1",
							isHeading && "font-display-semibold text-[15px] text-text",
							!isHeading &&
								(isQuietRow(row)
									? "font-ui text-[13px] text-text-muted"
									: "font-ui-medium text-[13.5px] text-text"),
						)}
					>
						{showActivityRowLabel(row)}
					</Text>
					{source === undefined ? null : (
						<Text className="rounded-pill border border-border px-1.5 font-ui text-[10.5px] text-text-subtle">
							{source}
						</Text>
					)}
				</View>
				<ShowActivityRowBody row={row} />
			</View>
		</View>
	);
}

function ShowActivityRows(props: { readonly rows: readonly ShowActivityRow[] }) {
	return (
		<View>
			{props.rows.map((row, index) => (
				<ShowActivityEntry
					row={row}
					key={row.key}
					isLast={index === props.rows.length - 1}
					showDate={props.rows[index - 1]?.dateKey !== row.dateKey}
				/>
			))}
		</View>
	);
}

function ShowActivityWatchSeparator(props: { readonly label: string }) {
	return (
		<View className="flex-row items-center gap-2.5 pb-3.5">
			<Text className="font-ui-medium text-[11px] tracking-widest text-text-subtle uppercase">
				{props.label}
			</Text>
			<View className="h-px flex-1 bg-border" />
		</View>
	);
}

const watchSeparatorLabel = (watch: ShowActivityCompletedWatch, index: number, total: number) =>
	`Watch ${total - index} · ${showActivityDateLabel(watch.completion)}`;

function ShowActivityTimelineView(props: { readonly timeline: ShowActivityTimeline }) {
	if (props.timeline.layout === "flat") {
		return <ShowActivityRows rows={props.timeline.rows} />;
	}
	const { open, completed } = props.timeline;
	return (
		<View className="gap-5">
			{open === undefined ? null : (
				<View>
					<ShowActivityWatchSeparator label="Since the last watch" />
					<ShowActivityRows rows={open} />
				</View>
			)}
			{completed.map((watch, index) => (
				<View key={watch.key}>
					<ShowActivityWatchSeparator label={watchSeparatorLabel(watch, index, completed.length)} />
					<ShowActivityRows rows={watch.rows} />
				</View>
			))}
		</View>
	);
}

function ShowActivityFooter(props: { readonly summary: ShowActivitySummary }) {
	return (
		<View className="items-start gap-2 border-t border-border pt-4">
			{props.summary.span.bound === "partial" ? (
				<Text className="font-ui text-[12px] text-text-subtle">
					Only your most recent activity is shown here.
				</Text>
			) : null}
			<ShowLinkButton
				label="View complete history"
				onPress={() => console.log("TODO: open complete activity history")}
			/>
		</View>
	);
}

function ShowActivityEmpty() {
	return (
		<AppStatusState
			className="min-h-96"
			title="No activity yet"
			detail="Nothing has been recorded for this show. Whatever you watch will appear here as your watch record."
			action={
				<ShowLinkButton
					label="Log activity"
					onPress={() => console.log("TODO: open activity form")}
				/>
			}
		/>
	);
}

function ShowActivityRecord(props: { readonly view: ShowActivityView }) {
	const { view } = props;
	return (
		<View className="gap-6 pt-6 md:flex-row md:justify-center md:gap-10 md:pt-8">
			<View className="gap-5 md:w-72 md:shrink-0">
				<ShowActivitySummaryFigures summary={view.summary} />
				<ShowActivityCoverageStrip coverage={view.coverage} />
			</View>
			<View
				accessibilityRole="list"
				accessibilityLabel="Watch record"
				className="min-w-0 gap-5 md:max-w-2xl md:flex-1"
			>
				<ShowActivityTimelineView timeline={view.timeline} />
				<ShowActivityFooter summary={view.summary} />
			</View>
		</View>
	);
}

export function ShowActivity(props: {
	readonly refresh: () => void;
	readonly state: ShowActivityState;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return (
			<ShowStatusMessage
				title="Loading activity..."
				detail="Fetching everything you have recorded for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <ShowStatusMessage {...showActivityError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "empty") {
		return <ShowActivityEmpty />;
	}
	return <ShowActivityRecord view={state.view} />;
}
