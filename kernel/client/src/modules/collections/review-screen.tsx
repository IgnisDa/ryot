import type { RatingScale } from "@ryot-app/contract/modules/events/rating-scale";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import type {
	ManageCollectionReviewsOutcome,
	ManageCollectionReviewsRequest,
} from "@ryot-app/plugin-client-contract";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, Dialog, LoadMoreButton, Notice, RatingValue } from "@ryot-app/plugin-ui-sdk";
import { useRef, useState } from "react";

import { collectionHeaderQuery } from "#/modules/collections/collection-header";
import { CollectionLoadDialog } from "#/modules/collections/collection-load-dialog";
import { preferencesQuery } from "#/modules/settings/preferences-service";
import { useHostScreenSession } from "#/modules/ui/host-screen-session";

import { CollectionReviewEditor } from "./review-editor";
import { type CollectionReview, collectionReviewsQuery } from "./review-service";

export function useCollectionReviewScreen() {
	const host = useHostScreenSession<ManageCollectionReviewsRequest, ManageCollectionReviewsOutcome>(
		{ kind: "cancelled" },
	);
	const session = host.session;
	return {
		open: session !== null,
		onManageCollectionReviews: host.open,
		screen:
			session === null ? null : (
				<CollectionReviewScreen
					complete={session.complete}
					collectionId={session.request.collectionId}
				/>
			),
	};
}

export function CollectionReviewScreen(props: {
	readonly collectionId: EntityId;
	readonly complete: (outcome: ManageCollectionReviewsOutcome) => void;
}) {
	const header = useRyotQuery(collectionHeaderQuery, props.collectionId);
	const changed = useRef(false);
	const close = () => props.complete({ kind: changed.current ? "changed" : "cancelled" });
	if (!header.data) {
		return (
			<CollectionLoadDialog
				onClose={close}
				failed={header.isError}
				onRetry={header.refetch}
				title="Collection reviews"
				closeLabel="Close reviews"
				missing={header.data === null}
			/>
		);
	}
	return (
		<Dialog
			size="lg"
			onClose={close}
			closeLabel="Close reviews"
			title={`Reviews of ${header.data.name}`}
		>
			<CollectionReviews
				collectionId={props.collectionId}
				onChanged={() => {
					changed.current = true;
				}}
			/>
		</Dialog>
	);
}

const initialCursor: string | undefined = undefined;

function CollectionReviewCard(props: {
	readonly onEdit: () => void;
	readonly review: CollectionReview;
	readonly scale: undefined | RatingScale;
}) {
	const { review } = props;
	const [revealed, setRevealed] = useState(false);
	const { text, rating, isSpoiler } = review.properties;
	return (
		<Card className="grid gap-3">
			<div className="flex items-center justify-between gap-3">
				<time dateTime={review.occurredAt}>
					{new Intl.DateTimeFormat(undefined, { timeStyle: "short", dateStyle: "medium" }).format(
						new Date(review.occurredAt),
					)}
				</time>
				{rating == null || props.scale === undefined ? null : (
					<RatingValue rating={rating} scale={props.scale} className="font-semibold" />
				)}
			</div>
			{text && isSpoiler && !revealed ? (
				<Button variant="secondary" onClick={() => setRevealed(true)}>
					Show spoiler
				</Button>
			) : null}
			{text && (!isSpoiler || revealed) ? (
				<p className="whitespace-pre-wrap break-words">{text}</p>
			) : null}
			<Button variant="ghost" onClick={props.onEdit}>
				Edit review
			</Button>
		</Card>
	);
}

function CollectionReviews(props: {
	readonly onChanged: () => void;
	readonly collectionId: EntityId;
}) {
	const [editor, setEditor] = useState<null | "new" | CollectionReview>(null);
	const scale = useRyotQuery(preferencesQuery).data?.ratingScale;
	const query = useRyotInfiniteQuery(
		collectionReviewsQuery,
		{ collectionId: props.collectionId },
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after, limit: 20 }),
		},
	);
	const reviews = paginationItems(
		query.pages,
		(page) => page.items,
		(row) => row.id,
	);
	return (
		<div className="grid gap-4">
			<Button onClick={() => setEditor("new")}>Post a review</Button>
			{query.isPending ? <p role="status">Loading reviews…</p> : null}
			{query.isError ? (
				<Notice tone="danger" action={<Button onClick={query.retry}>Retry</Button>}>
					Reviews could not be loaded.
				</Notice>
			) : null}
			{!query.isPending && !query.isError && reviews.length === 0 ? <p>No reviews yet.</p> : null}
			<ul className="grid gap-3">
				{reviews.map((review) => (
					<li key={review.id}>
						<CollectionReviewCard scale={scale} review={review} onEdit={() => setEditor(review)} />
					</li>
				))}
			</ul>
			{query.hasNextPage ? (
				<LoadMoreButton
					label="Load more reviews"
					onClick={query.fetchNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			) : null}
			{editor === null || scale === undefined ? null : (
				<CollectionReviewEditor
					scale={scale}
					collectionId={props.collectionId}
					initial={editor === "new" ? null : editor}
					onClose={() => {
						setEditor(null);
						query.refetch();
					}}
					onSaved={() => {
						props.onChanged();
						setEditor(null);
						query.refetch();
					}}
				/>
			)}
		</div>
	);
}
