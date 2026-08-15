import { Button } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";

const panel = "grid min-h-96 place-content-center justify-items-center gap-2 text-center";

export function BrowserSearching() {
	return (
		<section className={panel}>
			<AppIcon name="search" size={36} className="animate-pulse text-text-subtle" />
			<p className="text-sm text-text-muted">Searching...</p>
		</section>
	);
}

export function BrowserEmpty({
	name,
	onAdd,
	canAdd,
}: {
	readonly name: string;
	readonly canAdd: boolean;
	readonly onAdd: () => void;
}) {
	return (
		<section className={panel}>
			<AppIcon name="library" size={40} className="text-text-subtle" />
			<h2 className="text-xl font-semibold">{name} is empty</h2>
			<p className="text-sm text-text-muted">
				{canAdd
					? "Search online to add your first item."
					: "No items have been added to this view yet."}
			</p>
			{canAdd && (
				<Button onClick={onAdd} className="mt-2 flex items-center gap-2 rounded-pill py-2">
					<AppIcon name="search" size={16} />
					Search online
				</Button>
			)}
		</section>
	);
}

export function BrowserNoMatches({
	name,
	query,
	onAdd,
	canAdd,
}: {
	readonly name: string;
	readonly query: string;
	readonly canAdd: boolean;
	readonly onAdd: () => void;
}) {
	return (
		<section className={panel}>
			<AppIcon name="search-x" size={36} className="text-text-subtle" />
			<h2 className="text-xl font-semibold">No matches in {name}</h2>
			<p className="text-sm text-text-muted">Nothing in this view matches “{query}”.</p>
			{canAdd && (
				<div className="mt-2 grid w-full max-w-md justify-items-center gap-2">
					<button
						type="button"
						onClick={onAdd}
						className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left"
					>
						<AppIcon name="globe" size={16} className="text-accent-text" />
						<span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
							Search online for “{query}”
						</span>
						<AppIcon name="arrow-right" size={15} className="text-text-subtle" />
					</button>
				</div>
			)}
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
			<Button variant="text" onClick={onRetry} className="mt-2 text-sm text-accent-text">
				Try again
			</Button>
		</section>
	);
}

export function BrowserPagination({
	name,
	loaded,
	hasMore,
	isLoading,
	onLoadMore,
}: {
	readonly name: string;
	readonly loaded: number;
	readonly hasMore: boolean;
	readonly isLoading: boolean;
	readonly onLoadMore: () => void;
}) {
	if (!hasMore) {
		return (
			<p className="text-center text-xs text-text-subtle">
				End of {name} · {loaded.toLocaleString()} items
			</p>
		);
	}
	return (
		<button
			type="button"
			disabled={isLoading}
			onClick={onLoadMore}
			aria-label={isLoading ? "Loading more results" : "Load more results"}
			className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-surface-2 px-4 text-[15px] text-text disabled:opacity-60 @2xl:h-8.5 @2xl:w-auto @2xl:border @2xl:border-border @2xl:bg-surface @2xl:text-[13px]"
		>
			<AppIcon
				size={16}
				name="chevron-down"
				className={isLoading ? "animate-pulse" : "text-text"}
			/>
			{isLoading ? "Loading..." : "Load more"}
		</button>
	);
}
