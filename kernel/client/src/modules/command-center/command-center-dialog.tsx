import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { HttpUrl } from "@ryot-app/contract/schema/utils";
import { ManagedAssetProvider, useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { ChipRadioGroup, Modal } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { Schema } from "effect";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

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
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly onRetry: () => void;
	readonly results: CommandResults;
	readonly failed: readonly string[];
	readonly onInterceptBack: () => boolean;
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

function CommandRow(props: {
	readonly id: string;
	readonly active: boolean;
	readonly children: ReactNode;
	readonly onHover: () => void;
	readonly onSelect: () => void;
}) {
	const ref = useRef<HTMLLIElement>(null);
	useEffect(() => {
		const element = ref.current;
		if (props.active && element !== null && typeof element.scrollIntoView === "function") {
			element.scrollIntoView({ block: "nearest" });
		}
	}, [props.active]);
	return (
		<li
			ref={ref}
			id={props.id}
			role="option"
			onClick={props.onSelect}
			onMouseMove={props.onHover}
			aria-selected={props.active}
			className={clsx(
				"flex min-h-9 cursor-pointer scroll-mt-8 items-center gap-2.5 rounded-md px-2.5 py-1.5",
				props.active ? "bg-nav-indicator" : "hover:bg-hover",
			)}
		>
			{props.children}
		</li>
	);
}

const managedImages = (options: readonly CommandOption[]) =>
	options.flatMap(({ art }): readonly ManagedAssetLocator[] =>
		art?.image === null || art === undefined || art.image.type === "remote" ? [] : [art.image],
	);

export function CommandCenterDialog(props: CommandCenterDialogProps) {
	const baseId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [activeOptionId, setActiveOptionId] = useState<string | undefined>(undefined);
	const { empty, filter, groups, filters } = props.results;
	const options = selectableOptions(groups);
	const assets = useMemo(() => managedImages(options), [options]);
	const ids = [...options.map(({ id }) => id), ...(props.ask === undefined ? [] : [ASK_ID])];
	const activeId = ids.find((id) => id === activeOptionId) ?? ids.at(0);
	const active = options.find(({ id }) => id === activeId);
	const optionDomId = (id: string) => `${baseId}-${id}`;
	const trimmed = props.query.trim();

	const move = (index: number) => {
		const next = ids.at(index);
		if (next !== undefined) {
			setActiveOptionId(next);
		}
	};
	const changeFilter = (key: string) => {
		props.onFilterChange(key);
		inputRef.current?.focus();
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const index = activeId === undefined ? -1 : ids.indexOf(activeId);
		if (event.key === "Tab" && filters.length > 1) {
			event.preventDefault();
			const current = filters.findIndex(({ key }) => key === filter);
			const step = event.shiftKey ? -1 : 1;
			const next = filters.at((current + step + filters.length) % filters.length);
			if (next !== undefined) {
				props.onFilterChange(next.key);
			}
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			move(index + 1 >= ids.length ? 0 : index + 1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			move(index <= 0 ? ids.length - 1 : index - 1);
		} else if (event.key === "Home") {
			event.preventDefault();
			move(0);
		} else if (event.key === "End") {
			event.preventDefault();
			move(ids.length - 1);
		} else if (event.key === "Enter" && activeId === ASK_ID) {
			event.preventDefault();
			props.ask?.onAsk();
		} else if (event.key === "Enter" && active !== undefined) {
			event.preventDefault();
			props.onSelect(active);
		}
	};

	return (
		<Modal
			label="Command center"
			onClose={props.onClose}
			initialFocusRef={inputRef}
			closeLabel="Close command center"
			onInterceptBack={props.onInterceptBack}
			containerClassName="items-start justify-center p-4 pt-[12vh]"
			className="flex h-[min(30rem,76vh)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card"
		>
			<div className="relative flex items-center gap-2.5 border-b border-border px-4">
				<AppIcon size={16} name="search" className="text-text-muted" />
				<input
					type="text"
					ref={inputRef}
					role="combobox"
					autoComplete="off"
					value={props.query}
					aria-expanded="true"
					onKeyDown={onKeyDown}
					aria-autocomplete="list"
					aria-busy={props.pending}
					aria-label="Search commands"
					placeholder="Search or jump to..."
					aria-controls={`${baseId}-listbox`}
					onChange={(event) => props.onQueryChange(event.currentTarget.value)}
					aria-activedescendant={activeId === undefined ? undefined : optionDomId(activeId)}
					className="h-12 min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-subtle pointer-fine:text-sm"
				/>
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
					label="Filter results"
					onChange={changeFilter}
					className="shrink-0 px-3 pt-2.5 pb-0.5"
					options={filters.map(({ key, label, count }) => ({
						value: key,
						label: count === undefined ? label : `${label} · ${count}`,
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
							No matches for "{trimmed}"
						</p>
					)}
					{props.failed.length > 0 && !props.pending && (
						<div className="flex items-center gap-2 px-2.5 py-1.5">
							<span className="min-w-0 flex-1 text-label text-text-muted">
								Could not search {props.failed.join(", ")}.
							</span>
							<button
								type="button"
								onClick={props.onRetry}
								className="rounded px-2 py-0.5 text-label font-medium text-text underline"
							>
								Retry
							</button>
						</div>
					)}
					<ul
						role="listbox"
						aria-label="Results"
						id={`${baseId}-listbox`}
						className="flex flex-col gap-2"
					>
						{groups.map((group) => (
							<li key={group.key} role="presentation">
								<ul
									role="group"
									className="flex flex-col gap-0.5"
									aria-labelledby={`${baseId}-group-${group.key}`}
								>
									<li
										role="presentation"
										className="flex justify-between px-2.5 py-1 text-micro font-semibold tracking-wide text-text-subtle uppercase"
									>
										<span id={`${baseId}-group-${group.key}`}>{group.heading}</span>
										{group.count !== undefined && (
											<span className="font-normal tabular-nums">{group.count}</span>
										)}
									</li>
									{group.options.map((option) => (
										<CommandRow
											key={option.id}
											id={optionDomId(option.id)}
											active={option.id === activeId}
											onSelect={() => props.onSelect(option)}
											onHover={() => setActiveOptionId(option.id)}
										>
											<OptionContent option={option} />
										</CommandRow>
									))}
								</ul>
							</li>
						))}
						{props.ask === undefined ? null : (
							<li role="presentation">
								<ul
									role="group"
									className="flex flex-col gap-0.5"
									aria-labelledby={`${baseId}-group-${ASK_ID}`}
								>
									<li
										role="presentation"
										className="px-2.5 py-1 text-micro font-semibold tracking-wide text-text-subtle uppercase"
									>
										<span id={`${baseId}-group-${ASK_ID}`}>Ask</span>
									</li>
									<CommandRow
										id={optionDomId(ASK_ID)}
										onSelect={props.ask.onAsk}
										active={activeId === ASK_ID}
										onHover={() => setActiveOptionId(ASK_ID)}
									>
										<AssistantSprite mood="thinking" className="w-6" />
										<span className="min-w-0 flex-1 truncate text-body text-text">
											Ask {ASSISTANT_NAME}{" "}
											<span className="text-accent-text">"{props.ask.text}"</span>
										</span>
									</CommandRow>
								</ul>
							</li>
						)}
					</ul>
				</div>
			</ManagedAssetProvider>
		</Modal>
	);
}
