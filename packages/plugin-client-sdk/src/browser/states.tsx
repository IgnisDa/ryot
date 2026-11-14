import { Button, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

export type AddAction = {
	readonly label: string;
	readonly searchesOnline: boolean;
	readonly open: (initialQuery?: string) => void;
};

const panel = "grid min-h-96 place-content-center justify-items-center gap-2 text-center";

export function BrowserSearching() {
	return (
		<section className={panel}>
			<AppIcon size={36} name="search" className="animate-pulse text-text-subtle" />
			<p className="text-sm text-text-muted">Searching...</p>
		</section>
	);
}

export function BrowserInlineError({
	title,
	message,
	onRetry,
}: {
	readonly title: string;
	readonly message: string;
	readonly onRetry: () => void;
}) {
	return (
		<section className={panel}>
			<h2 className="text-xl font-semibold">{title}</h2>
			<p className="text-sm text-text-muted">{message}</p>
			<Button variant="link" className="mt-2" onClick={onRetry}>
				Try again
			</Button>
		</section>
	);
}

export function BrowserEmpty({
	add,
	name,
	message,
}: {
	readonly name: string;
	readonly add: undefined | AddAction;
	readonly message?: string | undefined;
}) {
	return (
		<section className={panel}>
			<AppIcon size={40} name="library" className="text-text-subtle" />
			<h2 className="text-xl font-semibold">{name} is empty</h2>
			<p className="text-sm text-text-muted">
				{message ??
					(add?.searchesOnline
						? "Search online to add your first item."
						: "No items have been added to this view yet.")}
			</p>
			{add && (
				<Button
					onClick={() => add.open()}
					className="mt-2 flex items-center gap-2 rounded-pill py-2"
				>
					<AppIcon size={16} name={add.searchesOnline ? "search" : "plus"} />
					{add.searchesOnline ? "Search online" : add.label}
				</Button>
			)}
		</section>
	);
}

export function BrowserPagination({
	name,
	loaded,
	hasMore,
	disabled,
	onLoadMore,
	isFetchingNextPage,
}: {
	readonly name: string;
	readonly loaded: number;
	readonly hasMore: boolean;
	readonly disabled: boolean;
	readonly onLoadMore: () => void;
	readonly isFetchingNextPage: boolean;
}) {
	if (!hasMore) {
		return (
			<p className="text-center text-xs text-text-subtle">
				End of {name} · {loaded.toLocaleString()} items
			</p>
		);
	}
	return (
		<LoadMoreButton
			label="Load more"
			disabled={disabled}
			onClick={onLoadMore}
			isFetchingNextPage={isFetchingNextPage}
			icon={<AppIcon size={16} name="chevron-down" className="text-text" />}
			aria-label={isFetchingNextPage ? "Loading more results" : "Load more results"}
			className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-surface-2 px-4 text-[15px] text-text disabled:opacity-60 @2xl:h-8.5 @2xl:w-auto @2xl:border @2xl:border-border @2xl:bg-surface @2xl:text-[13px]"
		/>
	);
}

export function BrowserNoMatches({
	add,
	name,
	query,
	filtered,
	onClearFilters,
}: {
	readonly name: string;
	readonly query: string;
	readonly filtered: boolean;
	readonly onClearFilters: () => void;
	readonly add: undefined | AddAction;
}) {
	const searched = query !== "";
	let message = "No items in this view match the current filters.";
	if (searched) {
		message = filtered
			? `Nothing in this view matches “${query}” with the current filters.`
			: `Nothing in this view matches “${query}”.`;
	}
	return (
		<section className={panel}>
			<AppIcon size={36} name="search-x" className="text-text-subtle" />
			<h2 className="text-xl font-semibold">No matches in {name}</h2>
			<p className="text-sm text-text-muted">{message}</p>
			{filtered && (
				<Button className="mt-2" variant="secondary" onClick={onClearFilters}>
					Clear filters
				</Button>
			)}
			{add?.searchesOnline && searched && (
				<div className="mt-2 grid w-full max-w-md justify-items-center gap-2">
					<button
						type="button"
						onClick={() => add.open(query)}
						className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left"
					>
						<AppIcon size={16} name="globe" className="text-accent-text" />
						<span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
							Search online for “{query}”
						</span>
						<AppIcon size={15} name="arrow-right" className="text-text-subtle" />
					</button>
				</div>
			)}
		</section>
	);
}
