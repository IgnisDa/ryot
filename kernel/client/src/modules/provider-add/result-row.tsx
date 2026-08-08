import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/client-ui-sdk/sync";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { Link } from "@tanstack/react-router";
import { Match } from "effect";

import type { ProviderEntityImportEntry } from "#/modules/provider-add/import-controller";
import { describeProviderSearchResultItem } from "#/modules/provider-add/result-display";
import type { ProviderSearchResultItem } from "#/modules/provider-add/search-controller";

const IMAGE_CLASS_NAME = "h-16 w-11 shrink-0 overflow-hidden rounded-md object-cover";

function InLibraryBadge(props: { readonly libraryName: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<AppIcon size={14} name="check" className="text-text-muted" />
			<span className="text-xs text-text-muted">In {props.libraryName}</span>
		</div>
	);
}

function InLibraryLink(props: {
	readonly title: string;
	readonly entityId: EntityId;
	readonly libraryName: string;
}) {
	return (
		<Link
			to="/e/$entityId"
			params={{ entityId: props.entityId }}
			aria-label={`Open ${props.title} in ${props.libraryName}`}
		>
			<InLibraryBadge libraryName={props.libraryName} />
		</Link>
	);
}

function ResultAction(props: {
	readonly title: string;
	readonly onAdd: () => void;
	readonly entry: ProviderEntityImportEntry;
	readonly linkedEntityId: EntityId | undefined;
	readonly libraryName: string;
}) {
	if (props.linkedEntityId !== undefined) {
		return (
			<InLibraryLink
				title={props.title}
				entityId={props.linkedEntityId}
				libraryName={props.libraryName}
			/>
		);
	}
	return Match.value(props.entry).pipe(
		Match.when({ status: "imported" }, (entry) => (
			<InLibraryLink
				title={props.title}
				entityId={entry.entityId}
				libraryName={props.libraryName}
			/>
		)),
		Match.when({ status: "importing" }, () => (
			<span role="status" aria-label={`Adding to ${props.libraryName}`}>
				<AppIcon size={16} name="plus" className="animate-pulse text-text-muted" />
			</span>
		)),
		Match.when({ status: "failed" }, () => (
			<button
				type="button"
				onClick={props.onAdd}
				aria-label={`Retry adding ${props.title} to ${props.libraryName}`}
				className="flex h-7 shrink-0 items-center px-1 text-xs font-medium text-accent-text"
			>
				Retry
			</button>
		)),
		Match.when({ status: "idle" }, () => (
			<button
				type="button"
				onClick={props.onAdd}
				aria-label={`Add ${props.title} to ${props.libraryName}`}
				className="flex h-7 shrink-0 items-center gap-1 rounded-pill bg-accent-soft px-2.5 md:rounded-md md:border md:border-border-strong md:bg-transparent md:px-3"
			>
				<AppIcon size={13} name="plus" className="text-accent-text md:hidden" />
				<span className="text-xs font-medium text-accent-text md:text-text">Add</span>
			</button>
		)),
		Match.exhaustive,
	);
}

export function ProviderSearchResultRow(props: {
	readonly onAdd: () => void;
	readonly item: ProviderSearchResultItem;
	readonly entry: ProviderEntityImportEntry;
	readonly linkedEntityId: EntityId | undefined;
	readonly libraryName: string;
}) {
	const display = describeProviderSearchResultItem(props.item);
	return (
		<div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5 md:bg-transparent">
			<EntityArtWell
				state="absent"
				url={display.imageUrl}
				monogram={display.title}
				className={IMAGE_CLASS_NAME}
			/>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<p className="line-clamp-2 text-[15px] font-medium text-text">{display.title}</p>
				{display.metaText === undefined ? null : (
					<p className="truncate text-xs text-text-muted">{display.metaText}</p>
				)}
				{props.entry.status === "failed" ? (
					<p className="text-xs text-text-muted">{props.entry.message}</p>
				) : null}
			</div>
			<ResultAction
				entry={props.entry}
				onAdd={props.onAdd}
				title={display.title}
				libraryName={props.libraryName}
				linkedEntityId={props.linkedEntityId}
			/>
		</div>
	);
}
