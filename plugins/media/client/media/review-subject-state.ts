import type { MediaPosition } from "../../shared/consumption";
import type { MediaActivityLogger } from "./activity-log/state";

export type ReviewSubjectMode = "whole" | "season" | "episode" | "position";

export type ReviewSubjectDraft = {
	readonly mode: ReviewSubjectMode;
	readonly position: number | undefined;
	readonly episodeId: string | undefined;
	readonly unit: undefined | MediaPosition["unit"];
	readonly season: undefined | { readonly seasonNumber: number; readonly id: string | undefined };
};

export const WHOLE_REVIEW_SUBJECT: ReviewSubjectDraft = {
	mode: "whole",
	unit: undefined,
	season: undefined,
	position: undefined,
	episodeId: undefined,
};

export const positionalReviewSubject = (position: undefined | MediaPosition): ReviewSubjectDraft =>
	position === undefined
		? WHOLE_REVIEW_SUBJECT
		: {
				...WHOLE_REVIEW_SUBJECT,
				mode: "position",
				unit: position.unit,
				position: position.position,
			};

/** The entity a review is written on and the position it names, or undefined while the subject is incomplete. */
export const reviewTarget = (
	entityId: string,
	draft: ReviewSubjectDraft,
): undefined | { readonly entityId: string; readonly position?: MediaPosition } => {
	if (draft.mode === "whole") {
		return { entityId };
	}
	if (draft.mode === "position") {
		return draft.unit === undefined || draft.position === undefined || draft.position <= 0
			? undefined
			: { entityId, position: { unit: draft.unit, position: draft.position } };
	}
	if (draft.mode === "season") {
		return draft.season?.id === undefined ? undefined : { entityId: draft.season.id };
	}
	return draft.episodeId === undefined ? undefined : { entityId: draft.episodeId };
};

export const reviewSubjectModes = (
	logger: undefined | MediaActivityLogger,
): readonly {
	readonly label: string;
	readonly content: string;
	readonly value: ReviewSubjectMode;
}[] => {
	const whole = `Whole ${logger?.copy.noun ?? "title"}`;
	if (logger?.family === "show") {
		return [
			{ label: whole, value: "whole", content: whole },
			{ value: "season", label: "Season", content: "Season" },
			{ value: "episode", label: "Episode", content: "Episode" },
		];
	}
	if (logger?.family === "podcast") {
		return [
			{ label: whole, value: "whole", content: whole },
			{ value: "episode", label: "Episode", content: "Episode" },
		];
	}
	if (logger?.family === "positional") {
		return [
			{ label: whole, value: "whole", content: whole },
			{ value: "position", label: "Specific part", content: "Specific part" },
		];
	}
	return [];
};
