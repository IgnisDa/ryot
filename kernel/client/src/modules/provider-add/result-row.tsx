import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import { Link } from "@tanstack/react-router";
import { Match } from "effect";
import { useState } from "react";

import type { ProviderEntityImportEntry } from "#/modules/provider-add/import-controller";
import { describeProviderSearchResultItem } from "#/modules/provider-add/result-display";
import type { ProviderSearchResultItem } from "#/modules/provider-add/search-controller";

const IMAGE_CLASS_NAME = "h-16 w-11 shrink-0 overflow-hidden rounded-md object-cover";

export function ProviderSearchResultRow(props: {
	readonly item: ProviderSearchResultItem;
	readonly entry: ProviderEntityImportEntry;
	readonly linkedEntityId: EntityId | undefined;
	readonly entryEventLabel?: Message | undefined;
	readonly onAdd: (withEntryEvent: boolean) => void;
}) {
	const t = useT();
	const display = describeProviderSearchResultItem(props.item);
	const [withEntryEvent, setWithEntryEvent] = useState(false);
	const add = (next: boolean) => {
		setWithEntryEvent(next);
		props.onAdd(next);
	};
	const pending =
		props.linkedEntityId === undefined &&
		(props.entry.status === "queued" || props.entry.status === "importing");
	return (
		<div
			aria-busy={pending || undefined}
			className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5 md:bg-transparent"
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
					<p className="text-xs text-text-muted">{t(props.entry.message)}</p>
				) : null}
			</div>
			<ResultAction
				onAdd={add}
				entry={props.entry}
				title={display.title}
				withEntryEvent={withEntryEvent}
				linkedEntityId={props.linkedEntityId}
				entryEventLabel={props.entryEventLabel}
			/>
		</div>
	);
}

function InLibraryLink(props: { readonly title: string; readonly entityId: EntityId }) {
	const t = useT();
	return (
		<Link
			to="/e/$entityId"
			params={{ entityId: props.entityId }}
			className="flex items-center gap-1.5"
			aria-label={t(kernelMessage("client.provider-add.row.open", { title: props.title }))}
		>
			<AppIcon size={14} name="check" className="text-text-muted" />
			<span className="text-xs text-text-muted">
				{t(kernelMessage("client.provider-add.row.added"))}
			</span>
		</Link>
	);
}

function ResultAction(props: {
	readonly title: string;
	readonly withEntryEvent: boolean;
	readonly entry: ProviderEntityImportEntry;
	readonly entryEventLabel: Message | undefined;
	readonly linkedEntityId: EntityId | undefined;
	readonly onAdd: (withEntryEvent: boolean) => void;
}) {
	const t = useT();
	if (props.linkedEntityId !== undefined) {
		return <InLibraryLink title={props.title} entityId={props.linkedEntityId} />;
	}
	if (props.entry.status === "queued" || props.entry.status === "importing") {
		const importing = props.entry.status === "importing";
		return (
			<span
				role="status"
				className="inline-flex h-7 shrink-0 items-center gap-1.5 px-1 text-xs whitespace-nowrap text-text-muted"
				aria-label={t(
					kernelMessage("client.provider-add.row.progress-label", {
						title: props.title,
						state: importing ? "importing" : "queued",
					}),
				)}
			>
				{importing ? (
					<span
						aria-hidden="true"
						className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
					/>
				) : (
					<AppIcon size={14} name="clock" />
				)}
				{t(
					importing
						? kernelMessage("client.provider-add.row.adding")
						: kernelMessage("client.provider-add.row.queued"),
				)}
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
				onClick={() => props.onAdd(props.withEntryEvent)}
				className="flex h-7 shrink-0 items-center px-1 text-xs font-medium text-accent-text"
				aria-label={t(kernelMessage("client.provider-add.row.retry-label", { title: props.title }))}
			>
				{t(kernelMessage("common.action.retry"))}
			</button>
		)),
		Match.when({ status: "idle" }, () => (
			<div className="flex shrink-0 items-center gap-1.5">
				{props.entryEventLabel === undefined ? null : (
					<button
						type="button"
						onClick={() => props.onAdd(true)}
						className="flex h-7 shrink-0 items-center px-2 text-xs font-medium whitespace-nowrap text-text-muted"
						aria-label={t(
							kernelMessage("client.provider-add.row.event-label", {
								title: props.title,
								action: props.entryEventLabel,
							}),
						)}
					>
						{t(props.entryEventLabel)}
					</button>
				)}
				<button
					type="button"
					onClick={() => props.onAdd(false)}
					aria-label={t(kernelMessage("client.provider-add.row.add-label", { title: props.title }))}
					className="flex h-7 shrink-0 items-center gap-1 rounded-pill bg-accent-soft px-2.5 md:rounded-md md:border md:border-border-strong md:bg-transparent md:px-3"
				>
					<AppIcon size={13} name="plus" className="text-accent-text md:hidden" />
					<span className="text-xs font-medium text-accent-text md:text-text">
						{t(kernelMessage("common.action.add"))}
					</span>
				</button>
			</div>
		)),
		Match.exhaustive,
	);
}
