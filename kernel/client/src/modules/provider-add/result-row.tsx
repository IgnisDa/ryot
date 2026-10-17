import type { EntityId } from "@ryot-app/contract/schema/brands";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import { Match } from "effect";

import type { ProviderEntityImportEntry } from "#/modules/provider-add/import-controller";
import { describeProviderSearchResultItem } from "#/modules/provider-add/result-display";
import type { ProviderSearchResultItem } from "#/modules/provider-add/search-controller";

const IMAGE_CLASS_NAME = "h-16 w-11 shrink-0 overflow-hidden rounded-md object-cover";

function InLibraryLink(props: { readonly title: string; readonly entityId: EntityId }) {
	return (
		<Link
			to="/e/$entityId"
			aria-label={`Open ${props.title}`}
			params={{ entityId: props.entityId }}
			className="flex items-center gap-1.5"
		>
			<AppIcon size={14} name="check" className="text-text-muted" />
			<span className="text-xs text-text-muted">Added</span>
		</Link>
	);
}

function ResultAction(props: {
	readonly title: string;
	readonly onAdd: () => void;
	readonly entry: ProviderEntityImportEntry;
	readonly linkedEntityId: EntityId | undefined;
}) {
	if (props.linkedEntityId !== undefined) {
		return <InLibraryLink title={props.title} entityId={props.linkedEntityId} />;
	}
	if (props.entry.status === "queued" || props.entry.status === "importing") {
		const importing = props.entry.status === "importing";
		return (
			<span
				role="status"
				aria-label={`${importing ? "Adding" : "Queued"} ${props.title}`}
				className="inline-flex min-h-8 shrink-0 items-center gap-2 rounded-md bg-accent-soft px-2.5 text-xs font-semibold whitespace-nowrap text-accent-text"
			>
				{importing ? (
					<span
						aria-hidden="true"
						className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
					/>
				) : (
					<AppIcon size={16} name="clock" />
				)}
				{importing ? "Adding…" : "Queued"}
			</span>
		);
	}
	return Match.value(props.entry).pipe(
		Match.when({ status: "imported" }, (entry) => (
			<InLibraryLink title={props.title} entityId={entry.entityId} />
		)),
		Match.when({ status: "failed" }, () => (
			<button
				type="button"
				onClick={props.onAdd}
				aria-label={`Retry adding ${props.title}`}
				className="flex h-7 shrink-0 items-center px-1 text-xs font-medium text-accent-text"
			>
				Retry
			</button>
		)),
		Match.when({ status: "idle" }, () => (
			<button
				type="button"
				onClick={props.onAdd}
				aria-label={`Add ${props.title}`}
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
}) {
	const display = describeProviderSearchResultItem(props.item);
	const pending =
		props.linkedEntityId === undefined &&
		(props.entry.status === "queued" || props.entry.status === "importing");
	return (
		<div
			aria-busy={pending || undefined}
			className={clsx(
				"flex items-center gap-3 rounded-lg px-3 py-2.5",
				pending
					? "bg-accent-soft ring-1 ring-accent-border ring-inset"
					: "bg-surface-2 md:bg-transparent",
			)}
		>
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
				linkedEntityId={props.linkedEntityId}
			/>
		</div>
	);
}
