import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from "react";

import type { MediaLinkedReview, MediaReviewLinks } from "../../shared/review-link-recipes";
import { mediaReviewOccurrenceLabel } from "./activity-copy";
import { MediaActivityActionsContext } from "./activity-row-menu";
import type { MediaActivityEventRef, MediaActivityRowBase } from "./activity-timeline";
import { MediaReviewEditForm } from "./review";
import { linkedOccurrenceId, reviewLinksQuery } from "./review-about";

type ReviewLinks = { readonly segmentNoun: string; readonly data: undefined | MediaReviewLinks };

const ReviewLinksContext = createContext<undefined | ReviewLinks>(undefined);

const isReviewRow = (
	row: MediaActivityRowBase,
): row is MediaActivityRowBase & { readonly event: MediaActivityEventRef } =>
	row.type === "review" && "event" in row;

export const rowConsumptionEventIds = (row: MediaActivityRowBase) => [
	...(row.events ?? []).map(({ id }) => id),
	...(row.consumptionEventIds ?? []),
];

const linkEventIds = (rows: readonly MediaActivityRowBase[]) =>
	[
		...new Set(
			rows.flatMap((row) => {
				const linked = isReviewRow(row) ? linkedOccurrenceId(row.event) : null;
				return [...rowConsumptionEventIds(row), ...(linked === null ? [] : [linked])];
			}),
		),
	].sort();

/** Resolves review links once for `rows`; nested timelines reuse the nearest resolution. */
export function MediaReviewLinksScope(props: {
	readonly segmentNoun: string;
	readonly children: ReactNode;
	readonly rows: readonly MediaActivityRowBase[];
}) {
	const parent = useContext(ReviewLinksContext);
	const eventIds = linkEventIds(props.rows);
	if (parent !== undefined || eventIds.length === 0) {
		return props.children;
	}
	return (
		<ResolvedReviewLinks eventIds={eventIds} segmentNoun={props.segmentNoun}>
			{props.children}
		</ResolvedReviewLinks>
	);
}

/** "About your watch on …" for a review that names one of its subject's occurrences. */
export function MediaReviewOccurrenceNote(props: { readonly event: MediaActivityEventRef }) {
	const links = useContext(ReviewLinksContext);
	const linked = linkedOccurrenceId(props.event);
	const occurrence = links?.data?.occurrences.find(({ id }) => id === linked);
	if (links === undefined || occurrence === undefined) {
		return null;
	}
	return (
		<p className="text-micro text-text-subtle">
			{mediaReviewOccurrenceLabel(links.segmentNoun, occurrence)}
		</p>
	);
}

function ResolvedReviewLinks(props: {
	readonly segmentNoun: string;
	readonly children: ReactNode;
	readonly eventIds: readonly string[];
}) {
	const { data } = useRyotQuery(reviewLinksQuery, { eventIds: props.eventIds });
	const links = useMemo(
		() => ({ data, segmentNoun: props.segmentNoun }),
		[data, props.segmentNoun],
	);
	return <ReviewLinksContext value={links}>{props.children}</ReviewLinksContext>;
}

/** The review naming one of a row's records, when one does. */
export const useLinkedReview = (events: readonly MediaActivityEventRef[]) => {
	const links = useContext(ReviewLinksContext);
	const ids = new Set(events.map(({ id }) => id));
	return links?.data?.reviews.find(({ consumptionEventId }) => ids.has(consumptionEventId));
};

/** Marks a consumption row that a review names and opens that review. */
export function MediaReviewedBadge(props: { readonly review: MediaLinkedReview }) {
	const { review } = props;
	const actions = useContext(MediaActivityActionsContext);
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button
				type="button"
				ref={triggerRef}
				onClick={() => setOpen(true)}
				className="rounded-pill border border-accent-border px-1.5 text-micro font-medium text-accent-text hover:bg-hover"
			>
				Reviewed
			</button>
			{open ? (
				<MediaReviewEditForm
					record={review}
					triggerRef={triggerRef}
					entityId={review.entityId}
					onClose={() => setOpen(false)}
					position={review.position ?? undefined}
					logger={actions?.entityId === review.entityId ? actions.logger : undefined}
					initial={{
						text: review.text,
						rating: review.rating,
						isSpoiler: review.isSpoiler ?? false,
					}}
				/>
			) : null}
		</>
	);
}
