import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

export type AddAction = {
	readonly label: Text;
	readonly searchesOnline: boolean;
	readonly open: (initialQuery?: string) => void;
};

const panel = "grid min-h-96 place-content-center justify-items-center gap-2 text-center";

export function BrowserSearching() {
	const t = useT();
	return (
		<section className={panel}>
			<AppIcon size={36} name="search" className="animate-pulse text-text-subtle" />
			<p className="text-sm text-text-muted">{t(kernelMessage("sdk.browser.searching"))}</p>
		</section>
	);
}

export function BrowserInlineError({
	title,
	message,
	onRetry,
}: {
	readonly title: Text;
	readonly message: Text;
	readonly onRetry: () => void;
}) {
	const t = useT();
	return (
		<section className={panel}>
			<h2 className="text-xl font-semibold">{title}</h2>
			<p className="text-sm text-text-muted">{message}</p>
			<Button variant="link" className="mt-2" onClick={onRetry}>
				{t(kernelMessage("common.action.try-again"))}
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
	readonly message?: Text | undefined;
}) {
	const t = useT();
	return (
		<section className={panel}>
			<AppIcon size={40} name="library" className="text-text-subtle" />
			<h2 className="text-xl font-semibold">
				{t(kernelMessage("sdk.browser.empty-title", { name }))}
			</h2>
			<p className="text-sm text-text-muted">
				{message ??
					t(
						kernelMessage(
							add?.searchesOnline ? "sdk.browser.empty-search-online" : "sdk.browser.empty-detail",
						),
					)}
			</p>
			{add && (
				<Button
					onClick={() => add.open()}
					className="mt-2 flex items-center gap-2 rounded-pill py-2"
				>
					<AppIcon size={16} name={add.searchesOnline ? "search" : "plus"} />
					{add.searchesOnline ? t(kernelMessage("sdk.browser.search-online")) : add.label}
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
	const t = useT();
	if (!hasMore) {
		return (
			<p className="text-center text-xs text-text-subtle">
				{t(kernelMessage("sdk.browser.end-of-results", { name, count: loaded }))}
			</p>
		);
	}
	return (
		<LoadMoreButton
			disabled={disabled}
			onClick={onLoadMore}
			isFetchingNextPage={isFetchingNextPage}
			icon={<AppIcon size={16} name="chevron-down" className="text-text" />}
			aria-label={t(
				kernelMessage(
					isFetchingNextPage ? "sdk.browser.loading-more-results" : "sdk.browser.load-more-results",
				),
			)}
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
	const t = useT();
	const searched = query !== "";
	let message = t(kernelMessage("sdk.browser.no-filter-matches"));
	if (searched) {
		message = t(
			kernelMessage("sdk.browser.no-search-matches", {
				query,
				filters: filtered ? "filtered" : "unfiltered",
			}),
		);
	}
	return (
		<section className={panel}>
			<AppIcon size={36} name="search-x" className="text-text-subtle" />
			<h2 className="text-xl font-semibold">
				{t(kernelMessage("sdk.browser.no-matches-title", { name }))}
			</h2>
			<p className="text-sm text-text-muted">{message}</p>
			{filtered && (
				<Button className="mt-2" variant="secondary" onClick={onClearFilters}>
					{t(kernelMessage("sdk.filters.clear"))}
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
							{t(kernelMessage("sdk.browser.search-online-for", { query }))}
						</span>
						<AppIcon size={15} name="arrow-right" className="text-text-subtle" />
					</button>
				</div>
			)}
		</section>
	);
}
