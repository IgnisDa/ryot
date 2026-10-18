import { type ManagedAssetLocator, RyotClientError } from "@ryot-app/plugin-client-sdk";
import {
	ManagedAssetProvider,
	nextPageCursor,
	PaginationError,
	type RyotQuery,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

import type { MediaCursorPage, MediaCursorPageFailure } from "./cursor-page-state";
import type { MediaStatusCopy } from "./detail-screen";
import { MediaRefreshStatus, MediaStatusMessage } from "./primitives";

export type MediaCursorPagesCopy = {
	readonly empty: string;
	readonly loading: MediaStatusCopy;
	readonly error: (state: MediaCursorPageFailure) => MediaStatusCopy;
};

type MediaCursorPagesProps<Item, Selection, Input> = {
	readonly copy: MediaCursorPagesCopy;
	readonly input: Selection;
	readonly getPageInput: (input: Selection, after: string | null) => Input;
	readonly query: RyotQuery<Input, MediaCursorPage<Item>>;
	readonly assets: (items: readonly Item[]) => readonly ManagedAssetLocator[];
	readonly renderItems: (items: readonly Item[]) => ReactNode;
};

const mediaCursorPageFailure = (error: Error | null): MediaCursorPageFailure => ({
	status:
		error instanceof PaginationError ||
		(error instanceof RyotClientError && error.reason === "malformed-result")
			? "malformed"
			: "transport-error",
});

export function MediaCursorPages<Item, Selection, Input>(
	props: MediaCursorPagesProps<Item, Selection, Input>,
) {
	const result = useRyotInfiniteQuery(props.query, props.input, {
		initialPageParam: null,
		getPageInput: props.getPageInput,
		getNextPageParam: nextPageCursor,
	});
	if (result.pages.length === 0 && result.isPending) {
		return <MediaStatusMessage {...props.copy.loading} />;
	}
	if (result.pages.length === 0 && result.isError) {
		return (
			<MediaStatusMessage
				{...props.copy.error(mediaCursorPageFailure(result.error))}
				onRetry={result.retry}
			/>
		);
	}
	const items = result.pages.flatMap((page) => page.items);
	if (items.length === 0) {
		return <p className="font-ui text-[13px] text-text-muted">{props.copy.empty}</p>;
	}
	return (
		<>
			{result.errorOperation === "refresh" ? <MediaRefreshStatus result={result} /> : null}
			<ManagedAssetProvider assets={props.assets(items)}>
				{props.renderItems(items)}
			</ManagedAssetProvider>
			{result.errorOperation === "append" && result.isError ? (
				<MediaStatusMessage
					{...props.copy.error(mediaCursorPageFailure(result.error))}
					onRetry={result.retry}
				/>
			) : null}
			{!result.hasNextPage || result.errorOperation === "append" ? null : (
				<div className="pt-1">
					<LoadMoreButton
						label="Load more"
						disabled={result.isFetching}
						onClick={result.fetchNextPage}
						onVisible={result.fetchNextPage}
						isFetchingNextPage={result.isFetchingNextPage}
					/>
				</div>
			)}
		</>
	);
}
