import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import { ManagedAssetProvider, useRyotQuery, type RyotQuery } from "@ryot-app/client-sdk/react";
import { useState, type ReactNode } from "react";

import {
	mapMediaCursorPage,
	type MediaCursorPage,
	type MediaCursorPageFailure,
} from "./cursor-page-state";
import type { MediaStatusCopy } from "./detail-screen";
import { MediaLinkButton, MediaRefreshStatus, MediaStatusMessage } from "./primitives";

export type MediaCursorPagesCopy = {
	readonly empty: string;
	readonly loading: MediaStatusCopy;
	readonly error: (state: MediaCursorPageFailure) => MediaStatusCopy;
};

type MediaCursorPagesProps<Item, Input> = {
	readonly copy: MediaCursorPagesCopy;
	readonly input: (after: string | null) => Input;
	readonly query: RyotQuery<Input, MediaCursorPage<Item>>;
	readonly assets: (items: readonly Item[]) => readonly ManagedAssetLocator[];
	readonly renderPage: (items: readonly Item[], index: number) => ReactNode;
};

function MediaCursorPageView<Item, Input>(
	props: MediaCursorPagesProps<Item, Input> & {
		readonly index: number;
		readonly after: string | null;
	},
) {
	const [expanded, setExpanded] = useState(false);
	const result = useRyotQuery(props.query, props.input(props.after));
	const state = mapMediaCursorPage(result);
	if (state.status === "loading") {
		return <MediaStatusMessage {...props.copy.loading} />;
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...props.copy.error(state)} onRetry={result.refetch} />;
	}
	const { items, nextCursor } = state;
	if (props.index === 0 && items.length === 0) {
		return <p className="font-ui text-[13px] text-text-muted">{props.copy.empty}</p>;
	}
	return (
		<>
			<MediaRefreshStatus result={result} />
			<ManagedAssetProvider assets={props.assets(items)}>
				{props.renderPage(items, props.index)}
			</ManagedAssetProvider>
			{nextCursor !== null && expanded ? (
				<MediaCursorPageView {...props} after={nextCursor} index={props.index + 1} />
			) : null}
			{nextCursor === null || expanded ? null : (
				<div className="pt-1">
					<MediaLinkButton label="Load more" onClick={() => setExpanded(true)} />
				</div>
			)}
		</>
	);
}

/**
 * Cursor-paged list. Every page owns its query and its own managed assets, so pressing
 * Load more appends a page without refetching the ones already on screen.
 */
export function MediaCursorPages<Item, Input>(props: MediaCursorPagesProps<Item, Input>) {
	return <MediaCursorPageView {...props} index={0} after={null} />;
}
