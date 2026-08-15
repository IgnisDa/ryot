import clsx from "clsx";
import { useDeferredValue, useRef, useState, type ReactNode } from "react";

import { useFieldEscape } from "./field-escape";
import { Modal } from "./modal";

export type MultiSelectChoice = {
	readonly value: string;
	readonly label?: string | undefined;
};

type MultiSelectProps = {
	readonly label: string;
	readonly checkIcon: ReactNode;
	readonly closeIcon: ReactNode;
	readonly searchIcon: ReactNode;
	readonly chevronIcon: ReactNode;
	readonly placeholder?: string;
	readonly selected: ReadonlyArray<string>;
	readonly onInterceptBack?: () => boolean;
	readonly choices: ReadonlyArray<MultiSelectChoice>;
	readonly onChange: (value: ReadonlyArray<string>) => void;
};

const choiceLabel = (choice: MultiSelectChoice) => choice.label ?? choice.value;

export function MultiSelect({
	label,
	choices,
	onChange,
	checkIcon,
	closeIcon,
	searchIcon,
	chevronIcon,
	placeholder,
	onInterceptBack,
	selected: selectedValues,
}: MultiSelectProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const search = useRef<HTMLInputElement>(null);
	useFieldEscape(search, { hasValue: query !== "", onClear: () => setQuery("") });
	const deferredQuery = useDeferredValue(query);
	const selected = new Set(selectedValues);
	const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
	const visibleChoices = choices.filter(
		(choice) =>
			selected.has(choice.value) ||
			choiceLabel(choice).toLocaleLowerCase().includes(normalizedQuery),
	);
	const selectedLabels = selectedValues.map((value) =>
		choiceLabel(choices.find((choice) => choice.value === value) ?? { value }),
	);
	const close = () => {
		setOpen(false);
		setQuery("");
	};
	const toggle = (value: string) =>
		onChange(
			selected.has(value)
				? selectedValues.filter((current) => current !== value)
				: [...selectedValues, value],
		);
	const triggerText = (() => {
		if (selectedLabels.length === 0) {
			return placeholder === undefined || placeholder === "" ? "Select options" : placeholder;
		}
		if (selectedLabels.length < 3) {
			return selectedLabels.join(", ");
		}
		return `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2} selected`;
	})();

	return (
		<>
			<div className="flex items-center gap-2">
				<button
					type="button"
					aria-label={label}
					aria-expanded={open}
					onClick={() => setOpen(true)}
					className="flex min-h-10 min-w-0 flex-1 items-center justify-between rounded-lg border border-border bg-raised px-3"
				>
					<span
						className={clsx(
							"min-w-0 flex-1 truncate text-left text-sm",
							selectedLabels.length === 0 ? "text-text-subtle" : "text-text",
						)}
					>
						{triggerText}
					</span>
					<span aria-hidden="true" className="text-text-muted">
						{chevronIcon}
					</span>
				</button>
				{selectedLabels.length > 0 && (
					<button
						type="button"
						onClick={() => onChange([])}
						aria-label={`Clear ${label}`}
						className="min-h-6 rounded-md px-1.5 py-1 text-xs font-medium text-text-muted"
					>
						Clear
					</button>
				)}
			</div>

			{open && (
				<Modal
					label={label}
					onClose={close}
					closeLabel="Close options"
					onInterceptBack={onInterceptBack ?? (() => false)}
					containerClassName="items-center justify-center p-4"
					className="flex h-[80%] max-h-[80%] w-full max-w-xl flex-col rounded-xl border border-border bg-surface p-4 shadow-card md:h-auto"
				>
					<div className="mb-3 flex items-center justify-between">
						<span className="text-base font-semibold text-text">{label}</span>
						<button
							type="button"
							onClick={close}
							aria-label="Close options"
							className="flex min-h-6 min-w-6 items-center justify-center rounded-md p-1 text-text-muted"
						>
							{closeIcon}
						</button>
					</div>
					<div className="mb-3 flex h-10 items-center gap-2 rounded-lg border border-border bg-raised px-3 focus-within:ring-2 focus-within:ring-focus">
						<span aria-hidden="true" className="text-text-subtle">
							{searchIcon}
						</span>
						<input
							ref={search}
							value={query}
							autoComplete="off"
							placeholder="Search options"
							aria-label={`Search ${label}`}
							onChange={(event) => setQuery(event.currentTarget.value)}
							className="min-w-0 flex-1 bg-transparent text-base text-text outline-none md:text-sm"
						/>
					</div>
					{selectedLabels.length > 0 && (
						<button
							type="button"
							onClick={() => onChange([])}
							aria-label={`Clear selections in ${label}`}
							className="mb-2 min-h-6 self-start rounded-md px-1.5 py-1 text-xs font-medium text-text-muted"
						>
							Clear selections
						</button>
					)}
					<div className="min-h-0 flex-1 overflow-y-auto">
						{visibleChoices.map((choice) => {
							const checked = selected.has(choice.value);
							return (
								<button
									type="button"
									role="checkbox"
									key={choice.value}
									aria-checked={checked}
									aria-label={choiceLabel(choice)}
									onClick={() => toggle(choice.value)}
									className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 py-2"
								>
									<span
										className={clsx(
											"flex h-5 w-5 items-center justify-center rounded border text-accent-ink",
											checked ? "border-accent-deep bg-accent" : "border-border-strong bg-raised",
										)}
									>
										{checked ? checkIcon : null}
									</span>
									<span className="min-w-0 flex-1 text-left text-sm text-text">
										{choiceLabel(choice)}
									</span>
								</button>
							);
						})}
					</div>
					{visibleChoices.length === 0 && (
						<p className="py-4 text-center text-sm text-text-muted">No matching options.</p>
					)}
				</Modal>
			)}
		</>
	);
}
