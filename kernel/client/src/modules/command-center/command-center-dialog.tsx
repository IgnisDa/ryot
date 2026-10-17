import { Modal } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import {
	type CommandGroup,
	type CommandOption,
	selectableOptions,
} from "#/modules/command-center/model";

type CommandCenterDialogProps = {
	readonly query: string;
	readonly onClose: () => void;
	readonly onInterceptBack: () => boolean;
	readonly groups: readonly CommandGroup[];
	readonly onRetry: (retryKey: string) => void;
	readonly onQueryChange: (query: string) => void;
	readonly onSelect: (option: CommandOption) => void;
};

function OptionRow(props: {
	readonly id: string;
	readonly active: boolean;
	readonly option: CommandOption;
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
				"flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5",
				props.active ? "bg-nav-indicator" : "hover:bg-hover",
			)}
		>
			<AppIcon size={16} name={props.option.icon} className="shrink-0 text-text-muted" />
			<span className="min-w-0 flex-1 truncate text-body text-text">{props.option.label}</span>
			{props.option.description !== undefined && (
				<span className="shrink-0 truncate text-micro text-text-subtle">
					{props.option.description}
				</span>
			)}
		</li>
	);
}

export function CommandCenterDialog(props: CommandCenterDialogProps) {
	const baseId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [activeOptionId, setActiveOptionId] = useState<string | undefined>(undefined);
	const options = selectableOptions(props.groups);
	const active = options.find(({ id }) => id === activeOptionId) ?? options.at(0);
	const optionDomId = (id: string) => `${baseId}-${id}`;
	const trimmed = props.query.trim();
	const settled = props.groups.every(({ status }) => status !== "pending");
	const empty =
		trimmed !== "" &&
		settled &&
		options.length === 0 &&
		!props.groups.some(({ status }) => status === "failed");

	const move = (index: number) => {
		const next = options.at(index);
		if (next !== undefined) {
			setActiveOptionId(next.id);
		}
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const index = active === undefined ? -1 : options.indexOf(active);
		if (event.key === "ArrowDown") {
			event.preventDefault();
			move(index + 1 >= options.length ? 0 : index + 1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			move(index <= 0 ? options.length - 1 : index - 1);
		} else if (event.key === "Home") {
			event.preventDefault();
			move(0);
		} else if (event.key === "End") {
			event.preventDefault();
			move(options.length - 1);
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
			className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card"
		>
			<div className="flex items-center gap-2.5 border-b border-border px-4">
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
					aria-label="Search commands"
					placeholder="Search or jump to..."
					aria-controls={`${baseId}-listbox`}
					onChange={(event) => props.onQueryChange(event.currentTarget.value)}
					aria-activedescendant={active === undefined ? undefined : optionDomId(active.id)}
					className="h-12 min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-subtle pointer-fine:text-sm"
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				<ul
					role="listbox"
					aria-label="Results"
					id={`${baseId}-listbox`}
					className="flex flex-col gap-2"
				>
					{props.groups.map((group) => (
						<li key={group.key} role="presentation">
							<ul
								role="group"
								className="flex flex-col gap-0.5"
								aria-labelledby={`${baseId}-group-${group.key}`}
							>
								<li
									role="presentation"
									id={`${baseId}-group-${group.key}`}
									className="px-2.5 py-1 text-micro font-semibold tracking-wide text-text-subtle uppercase"
								>
									{group.heading}
								</li>
								{group.options.map((option) => (
									<OptionRow
										option={option}
										key={option.id}
										id={optionDomId(option.id)}
										active={option.id === active?.id}
										onSelect={() => props.onSelect(option)}
										onHover={() => setActiveOptionId(option.id)}
									/>
								))}
								{group.status === "pending" && (
									<li role="presentation" className="px-2.5 py-1.5 text-label text-text-subtle">
										Searching...
									</li>
								)}
								{group.status === "failed" && (
									<li role="presentation" className="flex items-center gap-2 px-2.5 py-1.5">
										<span className="min-w-0 flex-1 text-label text-text-muted">
											Could not search {group.heading}.
										</span>
										<button
											type="button"
											aria-label={`Retry ${group.heading}`}
											onClick={() => props.onRetry(group.retryKey ?? group.key)}
											className="rounded px-2 py-0.5 text-label font-medium text-text underline"
										>
											Retry
										</button>
									</li>
								)}
							</ul>
						</li>
					))}
				</ul>
				{empty && (
					<p role="status" className="px-2.5 py-6 text-center text-body text-text-muted">
						No matches for "{trimmed}"
					</p>
				)}
			</div>
		</Modal>
	);
}
