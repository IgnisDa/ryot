import { Button, TextField } from "@ryot-app/client-ui-sdk";
import type { ListedIntegrationProvider } from "@ryot-app/contract/modules/integrations/schemas";
import clsx from "clsx";
import { useState } from "react";

import {
	availableCatalogEntries,
	groupIntegrationProviders,
	integrationProviderChooseLabel,
	type CatalogEntry,
} from "#/modules/integrations/provider-selection";
import { StatusState } from "#/modules/integrations/status-state";
import { AppIcon } from "#/modules/navigation/app-icon";

export type CatalogPickerState =
	| { readonly status: "empty" }
	| { readonly status: "failed" }
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly providers: readonly ListedIntegrationProvider[] };

function CatalogOption(props: {
	readonly isFirst: boolean;
	readonly entry: CatalogEntry;
	readonly onChoose: () => void;
}) {
	return (
		<button
			type="button"
			onClick={props.onChoose}
			disabled={!props.entry.isAvailable}
			aria-label={integrationProviderChooseLabel(props.entry)}
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

export function IntegrationCatalogPicker(props: {
	readonly onRetry: () => void;
	readonly state: CatalogPickerState;
	readonly onChoose: (slug: string) => void;
}) {
	const [query, setQuery] = useState("");

	if (props.state.status === "loading") {
		return (
			<StatusState
				className="py-12"
				detail="Loading the services you can connect..."
				icon={<span role="status" aria-label="Loading services" />}
			/>
		);
	}
	if (props.state.status === "failed") {
		return (
			<StatusState
				className="py-10"
				detailTone="danger"
				title="Unable to load services"
				detail="The list of services could not be loaded. Check the server and try again."
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
				title="No services yet"
				icon={<AppIcon size={36} name="inbox" className="text-text-subtle" />}
				detail="Once a plugin on this server contributes an integration, it shows up here."
			/>
		);
	}

	const groups = groupIntegrationProviders(props.state.providers, query);
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
