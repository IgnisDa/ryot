import clsx from "clsx";
import type { ReactNode } from "react";

type SegmentedControlOption<T extends string> = {
	readonly value: T;
	readonly label: string;
	readonly content: ReactNode;
};

type SegmentedControlProps<T extends string> = {
	readonly value: T;
	readonly label: string;
	readonly className?: string;
	readonly onChange: (value: T) => void;
	readonly options: readonly SegmentedControlOption<T>[];
};

export function SegmentedControl<T extends string>({
	value,
	label,
	options,
	onChange,
	className,
}: SegmentedControlProps<T>) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			className={clsx(
				"flex h-9 items-center rounded-full bg-surface-2 p-0.75 md:h-8.5 md:items-stretch md:rounded-md md:border md:border-border-strong",
				className,
			)}
		>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<button
						role="radio"
						type="button"
						key={option.value}
						aria-checked={selected}
						aria-label={option.label}
						onClick={() => onChange(option.value)}
						className={clsx(
							"flex h-7 w-9.5 items-center justify-center rounded-full border border-transparent focus-visible:border-accent focus-visible:outline-none md:w-7.5 md:rounded-sm",
							selected ? "bg-raised text-accent-text shadow-sm" : "text-text-muted",
						)}
					>
						{option.content}
					</button>
				);
			})}
		</div>
	);
}
