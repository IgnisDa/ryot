import clsx from "clsx";
import { useRef, useState, type ReactNode } from "react";

import { Modal } from "./modal";
import { RadioGroup } from "./radio-group";

export type SelectChoice = {
	readonly value: string;
	readonly label: string;
	readonly hint?: string;
};

type SelectProps = {
	readonly label: string;
	readonly value: string;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly checkIcon: ReactNode;
	readonly placeholder?: string;
	readonly chevronIcon: ReactNode;
	readonly onInterceptBack?: () => boolean;
	readonly onChange: (value: string) => void;
	readonly choices: ReadonlyArray<SelectChoice>;
};

const NAVIGATION_KEYS = new Set(["End", "Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function Select({
	label,
	value,
	choices,
	disabled,
	onChange,
	checkIcon,
	className,
	chevronIcon,
	placeholder,
	onInterceptBack,
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const navigating = useRef(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const selected = choices.find((choice) => choice.value === value);
	const triggerText = selected?.label ?? placeholder ?? "Select an option";

	const select = (next: string) => {
		onChange(next);
		if (!navigating.current) {
			setOpen(false);
		}
	};

	return (
		<>
			<button
				type="button"
				ref={triggerRef}
				disabled={disabled}
				aria-expanded={open}
				onClick={() => setOpen(true)}
				aria-label={`${label}: ${triggerText}`}
				className={clsx(
					"flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-raised px-3",
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
					triggerRef={triggerRef}
					closeLabel="Close options"
					onClose={() => setOpen(false)}
					onInterceptBack={onInterceptBack ?? (() => false)}
					containerClassName="items-center justify-center p-4"
					className="flex max-h-[80%] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-raised shadow-card"
				>
					<div className="border-b border-border px-4 py-3">
						<span className="text-base font-semibold text-text">{label}</span>
					</div>
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
							options={choices}
							onChange={select}
							renderOption={(choice, isSelected) => ({
								className: clsx(
									"flex min-h-11 w-full items-center gap-3 px-4",
									isSelected && "bg-accent-soft",
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
					</div>
				</Modal>
			)}
		</>
	);
}
