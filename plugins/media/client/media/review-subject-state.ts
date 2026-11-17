import type { Text } from "@ryot-app/plugin-client-sdk/react";

import type { MediaPosition } from "../../shared/consumption";
import type { MediaText } from "../messages";
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
	text: MediaText,
	logger: undefined | MediaActivityLogger,
): readonly {
	readonly label: Text;
	readonly content: Text;
	readonly value: ReviewSubjectMode;
}[] => {
	if (logger === undefined) {
		return [];
	}
	const mode = (value: ReviewSubjectMode) => {
		const label =
			value === "whole"
				? text("review.mode-whole", { kind: logger.copy.kind })
				: text("review.mode", { mode: value });
		return { value, label, content: label };
	};
	if (logger.family === "show") {
		return [mode("whole"), mode("season"), mode("episode")];
	}
	if (logger.family === "podcast") {
		return [mode("whole"), mode("episode")];
	}
	if (logger.family === "positional") {
		return [mode("whole"), mode("position")];
	}
	return [];
};
