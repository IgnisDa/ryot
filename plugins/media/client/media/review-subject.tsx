import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { SegmentedControl, Stepper } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import type { MediaActivityLogContext } from "../../shared/activity-log-recipes";
import { activityLogContextQuery } from "./activity-log/queries";
import {
	defaultSeasonNumber,
	latestPositionIn,
	type MediaActivityLogger,
	parsePositionNumber,
	positionLogUnit,
} from "./activity-log/state";
import {
	ActivitySeasonSelector,
	EpisodeList,
	type EpisodePager,
	PodcastEpisodes,
	ShowEpisodes,
} from "./episode-picker";
import {
	type ReviewSubjectDraft,
	type ReviewSubjectMode,
	reviewSubjectModes,
} from "./review-subject-state";

const modeDraft = (
	mode: ReviewSubjectMode,
	draft: ReviewSubjectDraft,
	logger: MediaActivityLogger,
	context: MediaActivityLogContext,
): ReviewSubjectDraft => {
	if (mode === "position" && logger.family === "positional") {
		const unit = positionLogUnit(logger, draft.unit).value;
		return { ...draft, mode, unit, position: Math.max(1, latestPositionIn(context, unit)) };
	}
	if (mode === "season") {
		const [first] = context.seasons;
		const season = draft.season?.id === undefined ? first : draft.season;
		return { ...draft, mode, season, episodeId: undefined };
	}
	if (mode === "episode") {
		const seasonNumber = defaultSeasonNumber(context);
		const season =
			draft.season ?? (seasonNumber === undefined ? undefined : { seasonNumber, id: undefined });
		return { ...draft, mode, season };
	}
	return { ...draft, mode };
};

export function ReviewSubjectPicker(props: {
	readonly entityId: string;
	readonly draft: ReviewSubjectDraft;
	readonly logger: MediaActivityLogger;
	readonly onChange: (draft: ReviewSubjectDraft) => void;
}) {
	const { draft, logger, entityId } = props;
	const result = useRyotQuery(activityLogContextQuery, { entityId });
	const context = result.data;
	if (context === undefined || context === null) {
		return null;
	}
	return (
		<div className="flex flex-col gap-3">
			<SegmentedControl
				fill
				label="Review of"
				value={draft.mode}
				optionClassName="px-3"
				options={reviewSubjectModes(logger)}
				onChange={(mode) => props.onChange(modeDraft(mode, draft, logger, context))}
			/>
			{draft.mode === "position" && logger.family === "positional" ? (
				<PositionChoice draft={draft} logger={logger} context={context} onChange={props.onChange} />
			) : null}
			{draft.mode === "season" ? (
				<ActivitySeasonSelector
					entityId={entityId}
					seasonNumber={draft.season?.seasonNumber}
					onSeason={(season) => props.onChange({ ...draft, season })}
				/>
			) : null}
			{draft.mode === "episode" ? (
				<EpisodeChoice
					draft={draft}
					logger={logger}
					entityId={entityId}
					onChange={props.onChange}
				/>
			) : null}
		</div>
	);
}

function EpisodeChoice(props: {
	readonly entityId: string;
	readonly draft: ReviewSubjectDraft;
	readonly logger: MediaActivityLogger;
	readonly onChange: (draft: ReviewSubjectDraft) => void;
}) {
	const { draft, logger, entityId } = props;
	const family = logger.family === "podcast" ? "podcast" : "show";
	const list = (pager: EpisodePager) => (
		<EpisodeList
			pager={pager}
			family={family}
			selectedId={draft.episodeId}
			emptyMessage="There are no episodes to review yet."
			onSelect={(episodeId) => props.onChange({ ...draft, episodeId })}
		/>
	);
	if (logger.family === "podcast") {
		return <PodcastEpisodes entityId={entityId}>{list}</PodcastEpisodes>;
	}
	return (
		<div className="flex flex-col gap-3">
			<ActivitySeasonSelector
				entityId={entityId}
				seasonNumber={draft.season?.seasonNumber}
				onSeason={(season) => props.onChange({ ...draft, season, episodeId: undefined })}
			/>
			{draft.season === undefined ? null : (
				<ShowEpisodes entityId={entityId} seasonNumber={draft.season.seasonNumber}>
					{list}
				</ShowEpisodes>
			)}
		</div>
	);
}

function PositionChoice(props: {
	readonly draft: ReviewSubjectDraft;
	readonly context: MediaActivityLogContext;
	readonly onChange: (draft: ReviewSubjectDraft) => void;
	readonly logger: Extract<MediaActivityLogger, { family: "positional" }>;
}) {
	const { draft, logger, context } = props;
	const unit = positionLogUnit(logger, draft.unit);
	return (
		<div className="flex flex-col gap-2">
			{logger.units.length > 1 ? (
				<SegmentedControl
					label="Unit"
					value={unit.value}
					optionClassName="px-3"
					options={logger.units.map((option) => ({
						value: option.value,
						label: option.label,
						content: option.label,
					}))}
					onChange={(next) =>
						props.onChange({
							...draft,
							unit: next,
							position: Math.max(1, latestPositionIn(context, next)),
						})
					}
				/>
			) : null}
			<Stepper
				min={1}
				step={1}
				className="w-44"
				label={unit.label}
				value={draft.position}
				incrementIcon={<AppIcon size={16} name="plus" />}
				decrementIcon={<AppIcon size={16} name="minus" />}
				parse={(text) => parsePositionNumber(unit.value, text)}
				inputMode={unit.value === "episodes" ? "numeric" : "decimal"}
				onChange={(position) => props.onChange({ ...draft, position })}
			/>
		</div>
	);
}
