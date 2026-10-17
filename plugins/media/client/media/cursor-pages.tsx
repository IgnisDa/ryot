import { RyotClientError, type ManagedAssetLocator } from "@ryot-app/plugin-client-sdk";
import {
	ManagedAssetProvider,
	PaginationError,
	nextPageCursor,
	useRyotInfiniteQuery,
	type RyotQuery,
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
	readonly renderPage: (items: readonly Item[], index: number) => ReactNode;
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
	if (result.pages[0]?.items.length === 0) {
		return <p className="font-ui text-[13px] text-text-muted">{props.copy.empty}</p>;
	}
	return (
		<>
			{result.errorOperation === "refresh" ? <MediaRefreshStatus result={result} /> : null}
			{result.pages.map((page, index) => (
				<ManagedAssetProvider
					assets={props.assets(page.items)}
					key={JSON.stringify(result.pageParams[index])}
				>
					{props.renderPage(page.items, index)}
				</ManagedAssetProvider>
			))}
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
						isFetchingNextPage={result.isFetchingNextPage}
					/>
				</div>
			)}
		</>
	);
}
