import type { ShowActivityEvent } from "@ryot/media-plugin/query-recipes";
import clsx from "clsx";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AppStatusState } from "@/modules/ui/status-state";

import {
	showActivityEpisodeAsset,
	showActivityError,
	showActivityLabel,
	showActivityMetaLabel,
	showActivityReviewText,
	showActivityToneClass,
	type ShowActivityCycle,
	type ShowActivityDay,
	type ShowActivityFact,
	type ShowActivityJournal,
	type ShowActivityState,
} from "./show-activity-state";
import { ShowAssetImage } from "./show-image";
import { ShowLinkButton, ShowStatusMessage } from "./show-primitives";

const HISTORY_FACT_MINIMUM = 2;

function ShowActivityHistory(props: { readonly facts: readonly ShowActivityFact[] }) {
	if (props.facts.length < HISTORY_FACT_MINIMUM) {
		return null;
	}
	return (
		<View className="gap-2 rounded-lg border border-border bg-surface px-3.5 py-3 md:w-64 md:shrink-0">
			<Text className="font-ui-medium text-[11px] tracking-widest text-text-subtle uppercase">
				Your history
			</Text>
			<View className="gap-1.5">
				{props.facts.map((fact) => (
					<View key={fact.label} className="flex-row items-baseline justify-between gap-3">
						<Text className="font-ui text-[12px] text-text-subtle">{fact.label}</Text>
						<Text className="min-w-0 shrink font-ui-medium text-[12px] text-text">
							{fact.value}
						</Text>
					</View>
				))}
			</View>
		</View>
	);
}

function ShowActivityReview(props: { readonly text: string; readonly isSpoiler: boolean }) {
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

function ShowActivityEntry(props: { readonly isLast: boolean; readonly event: ShowActivityEvent }) {
	const { event } = props;
	const meta = showActivityMetaLabel(event);
	const review = showActivityReviewText(event);
	const still = event.kind === "episode" ? showActivityEpisodeAsset(event.episode) : undefined;
	return (
		<View className="flex-row gap-3">
			<View className="w-2 items-center pt-2">
				<View className={clsx("h-2 w-2 rounded-full", showActivityToneClass(event))} />
				{props.isLast ? null : <View className="w-px flex-1 bg-border" />}
			</View>
			<View className={clsx("min-w-0 flex-1 flex-row items-start gap-3", !props.isLast && "pb-4")}>
				{still === undefined ? null : (
					<ShowAssetImage asset={still} className="aspect-video w-20 shrink-0 sm:w-24 md:w-28" />
				)}
				<View className="min-w-0 flex-1 gap-1">
					<Text className="font-ui-medium text-[14px] text-text">{showActivityLabel(event)}</Text>
					{meta === "" ? null : (
						<Text className="font-ui text-[12px] text-text-subtle">{meta}</Text>
					)}
					{review === undefined ? null : (
						<ShowActivityReview text={review} isSpoiler={event.isSpoiler === true} />
					)}
				</View>
			</View>
		</View>
	);
}

function ShowActivityDayGroup(props: { readonly day: ShowActivityDay }) {
	return (
		<View className="gap-2.5">
			<Text className="font-ui-medium text-[12px] text-text-subtle">{props.day.label}</Text>
			<View>
				{props.day.entries.map((event, index) => (
					<ShowActivityEntry
						event={event}
						key={event.id}
						isLast={index === props.day.entries.length - 1}
					/>
				))}
			</View>
		</View>
	);
}

function ShowActivityCycleGroup(props: {
	readonly divided: boolean;
	readonly cycle: ShowActivityCycle;
}) {
	return (
		<View className={clsx("gap-4", props.divided && "border-t border-border pt-5")}>
			{props.cycle.heading === undefined ? null : (
				<Text className="font-display-semibold text-[15px] text-text md:text-[17px]">
					{props.cycle.heading}
				</Text>
			)}
			{props.cycle.days.map((day) => (
				<ShowActivityDayGroup key={day.key} day={day} />
			))}
		</View>
	);
}

function ShowActivityFooter(props: { readonly truncated: boolean }) {
	return (
		<View className="items-start gap-2 border-t border-border pt-4">
			{props.truncated ? (
				<Text className="font-ui text-[12px] text-text-subtle">
					Older activity is not shown here.
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
			detail="Nothing has been recorded for this show. Whatever you watch will appear here as a journal."
			action={
				<ShowLinkButton
					label="Log activity"
					onPress={() => console.log("TODO: open activity form")}
				/>
			}
		/>
	);
}

function ShowActivityJournalView(props: { readonly journal: ShowActivityJournal }) {
	return (
		<View className="gap-6 pt-6 md:flex-row-reverse md:justify-center md:gap-10 md:pt-8">
			<ShowActivityHistory facts={props.journal.facts} />
			<View
				accessibilityRole="list"
				accessibilityLabel="Watching journal"
				className="min-w-0 gap-5 md:max-w-2xl md:flex-1"
			>
				{props.journal.cycles.map((cycle, index) => (
					<ShowActivityCycleGroup key={cycle.key} cycle={cycle} divided={index > 0} />
				))}
				<ShowActivityFooter truncated={props.journal.truncated} />
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
	return <ShowActivityJournalView journal={state.journal} />;
}
