import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { HttpUrl } from "@ryot-app/contract/schema/utils";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { ManagedAssetProvider, useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import {
	ActionSearch,
	ActionSearchInput,
	ActionSearchResults,
	ChipRadioGroup,
	Modal,
	ModalClose,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { Schema } from "effect";
import { useMemo, useRef } from "react";

import { ASSISTANT_NAME } from "#/modules/assistant/presentation";
import { AssistantSprite } from "#/modules/assistant/sprite";
import {
	type CommandOption,
	type CommandResults,
	selectableOptions,
} from "#/modules/command-center/model";

type CommandCenterDialogProps = {
	readonly query: string;
	readonly stale: boolean;
	readonly open?: boolean;
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly onRetry: () => void;
	readonly onClosed?: () => void;
	readonly results: CommandResults;
	readonly failed: readonly string[];
	readonly onQueryChange: (query: string) => void;
	readonly onFilterChange: (filter: string) => void;
	readonly onSelect: (option: CommandOption) => void;
	readonly ask: undefined | { readonly text: string; readonly onAsk: () => void };
};

const ASK_ID = "ask";

const isHttpUrl = Schema.is(HttpUrl);

const displayableImage = (image: null | AssetLocator) =>
	image === null || (image.type === "remote" && !isHttpUrl(image.url)) ? undefined : image;

function OptionArt(props: { readonly label: string; readonly image: null | AssetLocator }) {
	const url = useAssetUrl(displayableImage(props.image));
	return (
		<EntityArtWell
			url={url}
			state="absent"
			monogram={props.label}
			referrerPolicy="no-referrer"
			className="h-9 w-6.5 shrink-0 rounded-sm text-xs"
		/>
	);
}

function OptionContent(props: { readonly option: CommandOption }) {
	return (
		<>
			{props.option.art === undefined ? (
				<AppIcon size={16} name={props.option.icon} className="shrink-0 text-text-muted" />
			) : (
				<OptionArt label={props.option.label} image={props.option.art.image} />
			)}
			<span className="min-w-0 flex-1 truncate text-body text-text">{props.option.label}</span>
			{props.option.description !== undefined && (
				<span className="shrink-0 truncate text-micro text-text-subtle">
					{props.option.description}
				</span>
			)}
			{props.option.tag !== undefined && (
				<span className="max-w-32 shrink-0 truncate rounded-pill border border-border px-1.5 text-micro text-text-subtle">
					{props.option.tag}
				</span>
			)}
		</>
	);
}

const managedImages = (options: readonly CommandOption[]) =>
	options.flatMap(({ art }): readonly ManagedAssetLocator[] =>
		art?.image === null || art === undefined || art.image.type === "remote" ? [] : [art.image],
	);

export function CommandCenterDialog(props: CommandCenterDialogProps) {
	const t = useT();
	const formatters = useFormatters();
	const inputRef = useRef<HTMLInputElement>(null);
	const { empty, filter, groups, filters } = props.results;
	const options = selectableOptions(groups);
	const assets = useMemo(() => managedImages(options), [options]);
	const trimmed = props.query.trim();
	const actionGroups = groups.map((group) => ({
		key: group.key,
		label: group.heading,
		count: group.count === undefined ? undefined : formatters.number().format(group.count),
		items: group.options.map((option) => ({
			key: option.id,
			label: option.label,
			onSelect: () => props.onSelect(option),
			content: <OptionContent option={option} />,
		})),
	}));
	if (props.ask !== undefined) {
		const ask = t(kernelMessage("client.shell.sidebar.ask", { name: ASSISTANT_NAME }));
		const text = t(kernelMessage("client.command-center.ask-text", { text: props.ask.text }));
		actionGroups.push({
			key: ASK_ID,
			count: undefined,
			label: t(kernelMessage("client.command-center.ask-heading")),
			items: [
				{
					key: ASK_ID,
					label: `${ask} ${text}`,
					onSelect: props.ask.onAsk,
					content: (
						<>
							<AssistantSprite mood="thinking" className="w-6" />
							<span className="min-w-0 flex-1 truncate text-body text-text">
								{ask} <span className="text-accent-text">{text}</span>
							</span>
						</>
					),
				},
			],
		});
	}

	return (
		<Modal
			onClose={props.onClose}
			onClosed={props.onClosed}
			open={props.open ?? true}
			initialFocusRef={inputRef}
			label={t(kernelMessage("client.command-center.label"))}
			containerClassName="items-start justify-center p-4 pt-[12vh]"
			className="flex h-[min(30rem,76vh)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card"
		>
			<ActionSearch
				query={props.query}
				groups={actionGroups}
				autoHighlight={options.length > 0}
				onQueryChange={props.onQueryChange}
			>
				<div className="relative flex items-center gap-2.5 border-b border-border px-4">
					<AppIcon size={16} name="search" className="text-text-muted" />
					<ActionSearchInput
						ref={inputRef}
						busy={props.pending}
						label={t(kernelMessage("client.command-center.search-label"))}
						placeholder={t(kernelMessage("client.command-center.search-placeholder"))}
					/>
					<ModalClose label={t(kernelMessage("client.command-center.close"))} />
					<div
						aria-hidden="true"
						className={clsx(
							"pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden transition-opacity motion-reduce:transition-none",
							props.pending ? "opacity-100 delay-150" : "opacity-0",
						)}
					>
						<div className="h-full w-full animate-sync-sweep bg-linear-to-r from-transparent via-accent to-transparent motion-reduce:animate-none" />
					</div>
				</div>
				{filters.length > 1 && (
					<ChipRadioGroup
						value={filter}
						overflow="scroll"
						className="shrink-0 px-3 pt-2.5 pb-0.5"
						label={t(kernelMessage("client.command-center.filter-label"))}
						onChange={(key) => {
							props.onFilterChange(key);
							inputRef.current?.focus();
						}}
						options={filters.map(({ key, label, count }) => ({
							value: key,
							label:
								count === undefined
									? label
									: t(kernelMessage("ui.multi-select.chip-count", { label, count })),
						}))}
					/>
				)}
				<ManagedAssetProvider assets={assets}>
					<div
						className={clsx(
							"min-h-0 flex-1 overflow-y-auto p-2 transition-opacity motion-reduce:transition-none",
							props.stale && "opacity-50 delay-150",
						)}
					>
						{empty && (
							<p role="status" className="px-2.5 py-6 text-center text-body text-text-muted">
								{t(kernelMessage("client.command-center.no-matches", { query: trimmed }))}
							</p>
						)}
						{props.failed.length > 0 && !props.pending && (
							<div className="flex items-center gap-2 px-2.5 py-1.5">
								<span className="min-w-0 flex-1 text-label text-text-muted">
									{t(
										kernelMessage("client.command-center.search-failed", {
											sources: formatters.list().format(props.failed),
										}),
									)}
								</span>
								<button
									type="button"
									onClick={props.onRetry}
									className="rounded px-2 py-0.5 text-label font-medium text-text underline"
								>
									{t(kernelMessage("common.action.retry"))}
								</button>
							</div>
						)}
						<ActionSearchResults label={t(kernelMessage("client.command-center.results"))} />
					</div>
				</ManagedAssetProvider>
			</ActionSearch>
		</Modal>
	);
}
