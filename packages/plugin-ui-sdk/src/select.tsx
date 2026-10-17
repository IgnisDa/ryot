import clsx from "clsx";
import { useDeferredValue, useRef, useState, type ReactNode } from "react";

import { useFieldEscape } from "./field-escape";
import { Modal } from "./modal";
import { RadioGroup } from "./radio-group";

export type SelectChoice = {
	readonly value: string;
	readonly label: string;
	readonly hint?: string;
};

type SelectProps = {
	readonly id?: string;
	readonly label: string;
	readonly value: string;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly checkIcon: ReactNode;
	readonly placeholder?: string;
	readonly searchIcon?: ReactNode;
	readonly chevronIcon: ReactNode;
	readonly onInterceptBack?: () => boolean;
	readonly onChange: (value: string) => void;
	readonly choices: ReadonlyArray<SelectChoice>;
};

const NAVIGATION_KEYS = new Set(["End", "Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function Select({
	id,
	label,
	value,
	choices,
	disabled,
	onChange,
	checkIcon,
	className,
	searchIcon,
	chevronIcon,
	placeholder,
	onInterceptBack,
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const navigating = useRef(false);
	const searchRef = useRef<HTMLInputElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	useFieldEscape(searchRef, { hasValue: query !== "", onClear: () => setQuery("") });
	const deferredQuery = useDeferredValue(query);
	const selected = choices.find((choice) => choice.value === value);
	const triggerText = selected?.label ?? placeholder ?? "Select an option";
	const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
	const visibleChoices =
		searchIcon === undefined
			? choices
			: choices.filter(
					(choice) =>
						choice.value === value || choice.label.toLocaleLowerCase().includes(normalizedQuery),
				);

	const close = () => {
		setOpen(false);
		setQuery("");
	};

	const select = (next: string) => {
		onChange(next);
		if (!navigating.current) {
			close();
		}
	};

	return (
		<>
			<button
				id={id}
				type="button"
				ref={triggerRef}
				disabled={disabled}
				aria-expanded={open}
				onClick={() => setOpen(true)}
				aria-label={`${label}: ${triggerText}`}
				className={clsx(
					"flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 transition-colors duration-100 hover:border-text-subtle motion-reduce:transition-none pointer-coarse:h-11",
					disabled === true && "opacity-50",
					className,
				)}
			>
				<span
					className={clsx(
						"min-w-0 flex-1 truncate text-left text-sm",
						selected === undefined ? "text-text-subtle" : "text-text",
					)}
				>
					{triggerText}
				</span>
				<span aria-hidden="true" className="text-text-muted">
					{chevronIcon}
				</span>
			</button>

			{open && (
				<Modal
					label={label}
					onClose={close}
					triggerRef={triggerRef}
					closeLabel="Close options"
					onInterceptBack={onInterceptBack ?? (() => false)}
					containerClassName="items-center justify-center p-4"
					className="flex max-h-[80%] w-full max-w-sm animate-dialog-in flex-col overflow-hidden rounded-xl bg-raised shadow-modal motion-reduce:animate-none"
				>
					<div className="border-b border-border px-4 py-3">
						<span className="text-[15px] font-semibold text-text">{label}</span>
					</div>
					{searchIcon !== undefined && (
						<div className="mx-3 my-3 flex h-9 items-center gap-2 rounded-md bg-surface-2 px-3 focus-within:ring-2 focus-within:ring-focus">
							<span aria-hidden="true" className="text-text-subtle">
								{searchIcon}
							</span>
							<input
								value={query}
								ref={searchRef}
								autoComplete="off"
								placeholder="Search options"
								aria-label={`Search ${label}`}
								onChange={(event) => setQuery(event.currentTarget.value)}
								className="min-w-0 flex-1 bg-transparent text-base text-text outline-none md:text-sm"
							/>
						</div>
					)}
					<div
						className="min-h-0 flex-1 overflow-y-auto py-1"
						onPointerDownCapture={() => {
							navigating.current = false;
						}}
						onKeyDownCapture={(event) => {
							navigating.current = NAVIGATION_KEYS.has(event.key);
						}}
					>
						<RadioGroup
							label={label}
							value={value}
							onChange={select}
							options={visibleChoices}
							renderOption={(choice, isSelected) => ({
								className: clsx(
									"flex min-h-9 w-full items-center gap-3 px-4 hover:bg-hover pointer-coarse:min-h-11",
									isSelected && "bg-accent-soft hover:bg-accent-soft",
								),
								content: (
									<>
										<span className="min-w-0 flex-1 truncate text-left text-sm text-text">
											{choice.label}
										</span>
										{choice.hint !== undefined && (
											<span aria-hidden="true" className="text-xs text-text-subtle">
												{choice.hint}
											</span>
										)}
										<span aria-hidden="true" className="text-accent-text">
											{isSelected ? checkIcon : null}
										</span>
									</>
								),
							})}
						/>
						{visibleChoices.length === 0 && (
							<p className="py-4 text-center text-sm text-text-muted">No matching options.</p>
						)}
					</div>
				</Modal>
			)}
		</>
	);
}
