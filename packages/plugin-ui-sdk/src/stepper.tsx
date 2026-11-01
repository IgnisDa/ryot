import clsx from "clsx";
import { type KeyboardEvent, type ReactNode, useState } from "react";

import { IconButton } from "./button";

const wholeNumber = /^\d+$/;
const minutesAndSeconds = /^(\d+):([0-5]\d)$/;

export const clockFormat = {
	format: (seconds: number) =>
		`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
	parse: (text: string) => {
		const clock = minutesAndSeconds.exec(text);
		if (clock !== null) {
			return Number(clock[1]) * 60 + Number(clock[2]);
		}
		return wholeNumber.test(text) ? Number(text) : undefined;
	},
};

const plainFormat = {
	format: (value: number) => String(value),
	parse: (text: string) => (wholeNumber.test(text) ? Number(text) : undefined),
};

type StepperProps = {
	readonly step: number;
	readonly label: string;
	readonly id?: string | undefined;
	readonly min?: number | undefined;
	readonly incrementIcon: ReactNode;
	readonly decrementIcon: ReactNode;
	readonly value: number | undefined;
	readonly invalid?: boolean | undefined;
	readonly className?: string | undefined;
	readonly disabled?: boolean | undefined;
	readonly format?: (value: number) => string;
	readonly "aria-describedby"?: string | undefined;
	readonly parse?: (text: string) => number | undefined;
	readonly onChange: (value: number | undefined) => void;
};

export function Stepper({
	id,
	step,
	label,
	value,
	invalid,
	min = 0,
	disabled,
	onChange,
	className,
	incrementIcon,
	decrementIcon,
	parse = plainFormat.parse,
	format = plainFormat.format,
	"aria-describedby": describedBy,
}: StepperProps) {
	const [draft, setDraft] = useState<null | string>(null);
	const shift = (delta: number) => {
		setDraft(null);
		onChange(Math.max(min, (value ?? min) + delta));
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const delta = { ArrowUp: step, PageUp: step * 4, ArrowDown: -step, PageDown: -step * 4 }[
			event.key
		];
		if (delta !== undefined) {
			event.preventDefault();
			shift(delta);
		}
	};
	return (
		<div
			className={clsx("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5", className)}
		>
			<IconButton
				tone="filled"
				disabled={disabled}
				label={`Decrease ${label}`}
				onClick={() => shift(-step)}
			>
				{decrementIcon}
			</IconButton>
			<input
				id={id}
				aria-label={label}
				disabled={disabled}
				inputMode="numeric"
				onKeyDown={onKeyDown}
				aria-invalid={invalid}
				onBlur={() => setDraft(null)}
				aria-describedby={describedBy}
				value={draft ?? (value === undefined ? "" : format(value))}
				onChange={(event) => {
					const text = event.target.value.trim();
					setDraft(event.target.value);
					if (text === "") {
						onChange(undefined);
						return;
					}
					const parsed = parse(text);
					if (parsed !== undefined) {
						onChange(Math.max(min, parsed));
					}
				}}
				className={clsx(
					"h-9 w-full min-w-0 rounded-md border bg-surface px-3 text-center text-base font-semibold text-text tabular-nums transition-[border-color,box-shadow] duration-100 hover:border-text-subtle focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/25 focus-visible:outline-none disabled:bg-surface-2 disabled:text-text-subtle motion-reduce:transition-none pointer-coarse:h-11 pointer-fine:text-sm",
					invalid === true ? "border-danger" : "border-border-strong",
				)}
			/>
			<IconButton
				tone="filled"
				disabled={disabled}
				label={`Increase ${label}`}
				onClick={() => shift(step)}
			>
				{incrementIcon}
			</IconButton>
		</div>
	);
}
