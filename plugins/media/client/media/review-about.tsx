import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Select } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useEffect, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	mediaReviewableOccurrencesRecipe,
	type MediaReviewOccurrence,
} from "../../shared/review-link-recipes";
import { mediaReviewOccurrenceChoiceLabel } from "./activity-copy";
import type { MediaActivityEventRef } from "./activity-timeline";

const REVIEWABLE_OCCURRENCE_LIMIT = 20;

const NO_OCCURRENCE = "none";

export const reviewableOccurrencesQuery = createRyotQuery<
	{ readonly entityId: string },
	readonly MediaReviewOccurrence[]
>(({ input, client }) =>
	client.data.query(
		mediaReviewableOccurrencesRecipe({
			entityId: input.entityId,
			limit: REVIEWABLE_OCCURRENCE_LIMIT,
			reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
		}),
	),
);

/** The occurrence a stored review names, if any. */
export const linkedOccurrenceId = (event: Pick<MediaActivityEventRef, "properties">) => {
	const id = event.properties["consumptionEventId"];
	return typeof id === "string" ? id : null;
};

export type ReviewCompletion = "saved" | "failed" | "pending";

const newestCompletion = (occurrences: readonly MediaReviewOccurrence[]) =>
	occurrences
		.filter(
			({ eventSchemaSlug }) =>
				eventSchemaSlug === "complete" || eventSchemaSlug === "item-complete",
		)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

/**
 * Chooses which of the subject's recent occurrences a review is about. After a just-logged
 * completion settles, its occurrence is chosen unless one already is.
 */
export function ReviewAboutSelect(props: {
	readonly entityId: string;
	readonly value: null | string;
	readonly completion?: undefined | ReviewCompletion;
	readonly onChange: (eventId: null | string) => void;
}) {
	const result = useRyotQuery(reviewableOccurrencesQuery, { entityId: props.entityId });
	const [refresh, setRefresh] = useState<
		| { readonly phase: "idle" | "done" }
		| { readonly phase: "requested"; readonly before: typeof result.data }
	>({ phase: "idle" });
	const preselected = useRef(false);
	const { data, refetch, isFetching } = result;
	const saved = props.completion === "saved";
	if (saved && refresh.phase === "idle") {
		setRefresh({ before: data, phase: "requested" });
	} else if (
		refresh.phase === "requested" &&
		!isFetching &&
		data !== undefined &&
		data !== refresh.before
	) {
		setRefresh({ phase: "done" });
	}
	useEffect(() => {
		if (saved) {
			refetch();
		}
	}, [saved, refetch]);
	const { value, onChange } = props;
	useEffect(() => {
		if (refresh.phase !== "done" || preselected.current || data === undefined) {
			return;
		}
		preselected.current = true;
		const completion = newestCompletion(data);
		if (value === null && completion !== undefined) {
			onChange(completion.id);
		}
	}, [refresh, data, value, onChange]);
	const occurrences = data ?? [];
	if (occurrences.length === 0 && props.completion !== "pending") {
		return null;
	}
	return (
		<div className="flex flex-col gap-1.5">
			<Select
				label="About"
				disabled={data === undefined}
				value={value ?? NO_OCCURRENCE}
				checkIcon={<AppIcon size={16} name="check" />}
				chevronIcon={<AppIcon size={16} name="chevron-down" />}
				onChange={(choice) => onChange(choice === NO_OCCURRENCE ? null : choice)}
				choices={[
					{ value: NO_OCCURRENCE, label: "Not a specific time" },
					...occurrences.map((occurrence) => ({
						value: occurrence.id,
						label: mediaReviewOccurrenceChoiceLabel(occurrence),
					})),
				]}
			/>
			{props.completion === "pending" ? (
				<p className="text-micro text-text-subtle">Saving your activity…</p>
			) : null}
		</div>
	);
}
