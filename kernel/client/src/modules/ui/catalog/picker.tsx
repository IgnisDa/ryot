import { Button, TextField } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useState } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";
import {
	availableCatalogEntries,
	groupCatalogEntries,
	type CatalogEntry,
} from "#/modules/ui/catalog/selection";
import { StatusState } from "#/modules/ui/status-state";

export type CatalogPickerState<Source> =
	| { readonly status: "empty" }
	| { readonly status: "failed" }
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly sources: readonly Source[] };

export type CatalogPickerCopy = {
	readonly emptyTitle: string;
	readonly errorTitle: string;
	readonly emptyDetail: string;
	readonly errorDetail: string;
	readonly loadingLabel: string;
	readonly loadingDetail: string;
};

function CatalogOption(props: {
	readonly isFirst: boolean;
	readonly entry: CatalogEntry;
	readonly onChoose: () => void;
	readonly chooseLabel: (entry: CatalogEntry) => string;
}) {
	return (
		<button
			type="button"
			onClick={props.onChoose}
			disabled={!props.entry.isAvailable}
			aria-label={props.chooseLabel(props.entry)}
			className={clsx(
				"flex w-full items-center gap-3 border-b border-border py-3 text-left",
				props.isFirst && "border-t",
				!props.entry.isAvailable && "opacity-70",
			)}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium text-text">{props.entry.name}</span>
				<span className="line-clamp-2 text-xs text-text-muted">{props.entry.description}</span>
				{props.entry.requirement === undefined ? null : (
					<span className="text-xs text-danger">{props.entry.requirement}</span>
				)}
			</span>
			<span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-text-muted">
				{props.entry.badge}
			</span>
			{props.entry.isAvailable ? (
				<AppIcon size={16} name="chevron-right" className="shrink-0 text-text-subtle" />
			) : null}
		</button>
	);
}

export function CatalogPicker<
	Source extends { name: string; pluginSlug: string; description: string },
>(props: {
	readonly onRetry: () => void;
	readonly copy: CatalogPickerCopy;
	readonly onChoose: (slug: string) => void;
	readonly state: CatalogPickerState<Source>;
	readonly toEntry: (source: Source) => CatalogEntry;
	readonly chooseLabel: (entry: CatalogEntry) => string;
}) {
	const [query, setQuery] = useState("");

	if (props.state.status === "loading") {
		return (
			<StatusState
				className="py-12"
				detail={props.copy.loadingDetail}
				icon={<span role="status" aria-label={props.copy.loadingLabel} />}
			/>
		);
	}
	if (props.state.status === "failed") {
		return (
			<StatusState
				className="py-10"
				detailTone="danger"
				title={props.copy.errorTitle}
				detail={props.copy.errorDetail}
				action={
					<Button type="button" variant="secondary" onClick={props.onRetry}>
						Try again
					</Button>
				}
			/>
		);
	}
	if (props.state.status === "empty") {
		return (
			<StatusState
				className="py-12"
				title={props.copy.emptyTitle}
				detail={props.copy.emptyDetail}
				icon={<AppIcon size={36} name="inbox" className="text-text-subtle" />}
			/>
		);
	}

	const groups = groupCatalogEntries(props.state.sources, query, props.toEntry);
	const available = availableCatalogEntries(groups);
	const chooseOnly = () => {
		const only = available.length === 1 ? available.at(0) : undefined;
		if (only !== undefined) {
			props.onChoose(only.slug);
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<form
				role="search"
				onSubmit={(event) => {
					event.preventDefault();
					chooseOnly();
				}}
			>
				<TextField
					type="search"
					value={query}
					density="compact"
					autoComplete="off"
					className="w-full"
					aria-label="Search services"
					placeholder="Search services"
					onChange={(event) => setQuery(event.currentTarget.value)}
				/>
			</form>
			{groups.length === 0 ? (
				<StatusState
					className="py-10"
					title="Nothing matches that"
					detail="Try a shorter word, or clear the search to see everything."
					icon={<AppIcon size={36} name="search-x" className="text-text-subtle" />}
				/>
			) : (
				groups.map((group) => (
					<div key={group.pluginSlug} className="flex flex-col gap-1.5">
						<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
							{group.heading}
						</span>
						<div>
							{group.entries.map((entry, index) => (
								<CatalogOption
									entry={entry}
									key={entry.slug}
									isFirst={index === 0}
									chooseLabel={props.chooseLabel}
									onChoose={() => props.onChoose(entry.slug)}
								/>
							))}
						</div>
					</div>
				))
			)}
		</div>
	);
}
