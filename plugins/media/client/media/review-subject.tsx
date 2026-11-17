import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { SegmentedControl, Stepper } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import type { MediaActivityLogContext } from "../../shared/activity-log-recipes";
import { useMediaMessages } from "../messages";
import { activityLogContextQuery } from "./activity-log/queries";
import {
	defaultSeasonNumber,
	latestPositionIn,
	type MediaActivityLogger,
	parsePositionNumber,
	positionLogUnit,
} from "./activity-log/state";
import { ActivitySeasonSelector, EpisodeChoice } from "./episode-picker";
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
		const unit = positionLogUnit(logger, draft.unit);
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
	const text = useMediaMessages();
	const result = useRyotQuery(activityLogContextQuery, { entityId });
	const context = result.data;
	if (context === undefined || context === null) {
		return null;
	}
	return (
		<div className="flex flex-col gap-3">
			<SegmentedControl
				fill
				value={draft.mode}
				optionClassName="px-3"
				label={text("review.of-label")}
				options={reviewSubjectModes(text, logger)}
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
				<ReviewEpisodeChoice
					draft={draft}
					logger={logger}
					entityId={entityId}
					onChange={props.onChange}
				/>
			) : null}
		</div>
	);
}

function ReviewEpisodeChoice(props: {
	readonly entityId: string;
	readonly draft: ReviewSubjectDraft;
	readonly logger: MediaActivityLogger;
	readonly onChange: (draft: ReviewSubjectDraft) => void;
}) {
	const { draft, logger, entityId } = props;
	const text = useMediaMessages();
	return (
		<EpisodeChoice
			entityId={entityId}
			selectedId={draft.episodeId}
			seasonNumber={draft.season?.seasonNumber}
			emptyMessage={text("review.episodes-none")}
			family={logger.family === "podcast" ? "podcast" : "show"}
			onSelect={(episodeId) => props.onChange({ ...draft, episodeId })}
			onSeason={(season) => props.onChange({ ...draft, season, episodeId: undefined })}
		/>
	);
}

function PositionChoice(props: {
	readonly draft: ReviewSubjectDraft;
	readonly context: MediaActivityLogContext;
	readonly onChange: (draft: ReviewSubjectDraft) => void;
	readonly logger: Extract<MediaActivityLogger, { family: "positional" }>;
}) {
	const { draft, logger, context } = props;
	const text = useMediaMessages();
	const unit = positionLogUnit(logger, draft.unit);
	return (
		<div className="flex flex-col gap-2">
			{logger.units.length > 1 ? (
				<SegmentedControl
					value={unit}
					optionClassName="px-3"
					label={text("property.unit")}
					onChange={(next) =>
						props.onChange({
							...draft,
							unit: next,
							position: Math.max(1, latestPositionIn(context, next)),
						})
					}
					options={logger.units.map((option) => {
						const label = text("log.unit.label", { unit: option });
						return { label, value: option, content: label };
					})}
				/>
			) : null}
			<Stepper
				min={1}
				step={1}
				className="w-44"
				value={draft.position}
				label={text("log.unit.label", { unit })}
				incrementIcon={<AppIcon size={16} name="plus" />}
				decrementIcon={<AppIcon size={16} name="minus" />}
				parse={(input) => parsePositionNumber(unit, input)}
				inputMode={unit === "episodes" ? "numeric" : "decimal"}
				onChange={(position) => props.onChange({ ...draft, position })}
			/>
		</div>
	);
}
