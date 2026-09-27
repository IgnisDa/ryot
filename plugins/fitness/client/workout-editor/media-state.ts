import type { ManagedAssetLocator } from "@ryot-app/plugin-client-sdk";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type { WorkoutSetAssetLocator } from "../../shared/workout-set";

export type WorkoutMediaTarget =
	| { readonly kind: "workout" }
	| { readonly kind: "occurrence"; readonly occurrenceId: string };
export type WorkoutMediaKind = "images" | "videos";

export const sameMedia = (left: WorkoutSetAssetLocator, right: WorkoutSetAssetLocator) =>
	left.type === "remote"
		? right.type === "remote" && left.url === right.url
		: right.type !== "remote" && left.type === right.type && left.key === right.key;

export const draftMedia = (draft: WorkoutEditorDraft) => [
	...draft.images,
	...draft.videos,
	...draft.occurrences.flatMap((occurrence) => [...occurrence.images, ...occurrence.videos]),
];

export const targetMedia = (draft: WorkoutEditorDraft, target: WorkoutMediaTarget) =>
	target.kind === "workout"
		? draft
		: draft.occurrences.find(({ clientId }) => clientId === target.occurrenceId);

export const attachDraftMedia = (
	draft: WorkoutEditorDraft,
	target: WorkoutMediaTarget,
	kind: WorkoutMediaKind,
	asset: ManagedAssetLocator,
): WorkoutEditorDraft => {
	const current = targetMedia(draft, target);
	if (current === undefined) {
		return draft;
	}
	const media = [...current[kind], asset];
	const uploadedAssets = [...(draft.uploadedAssets ?? []), asset];
	return target.kind === "workout"
		? { ...draft, [kind]: media, uploadedAssets }
		: {
				...draft,
				uploadedAssets,
				occurrences: draft.occurrences.map((occurrence) =>
					occurrence.clientId === target.occurrenceId
						? { ...occurrence, [kind]: media }
						: occurrence,
				),
			};
};

export const removeDraftMedia = (
	draft: WorkoutEditorDraft,
	target: WorkoutMediaTarget,
	kind: WorkoutMediaKind,
	asset: WorkoutSetAssetLocator,
): WorkoutEditorDraft => {
	const current = targetMedia(draft, target);
	if (current === undefined) {
		return draft;
	}
	const media = current[kind].filter((candidate) => !sameMedia(candidate, asset));
	return target.kind === "workout"
		? { ...draft, [kind]: media }
		: {
				...draft,
				occurrences: draft.occurrences.map((occurrence) =>
					occurrence.clientId === target.occurrenceId
						? { ...occurrence, [kind]: media }
						: occurrence,
				),
			};
};
