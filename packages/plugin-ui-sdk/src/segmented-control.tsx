import clsx from "clsx";
import type { ReactNode } from "react";

import { RadioGroup } from "./radio-group";

type SegmentedControlOption<T extends string> = {
	readonly value: T;
	readonly label: string;
	readonly content: ReactNode;
};

type SegmentedControlProps<T extends string> = {
	readonly value: T;
	readonly label: string;
	readonly className?: string;
	readonly optionClassName?: string;
	readonly onChange: (value: T) => void;
	readonly options: readonly SegmentedControlOption<T>[];
};

export function SegmentedControl<T extends string>({
	value,
	label,
	options,
	onChange,
	className,
	optionClassName,
}: SegmentedControlProps<T>) {
	return (
		<RadioGroup
			value={value}
			label={label}
			options={options}
			onChange={onChange}
			className={clsx(
				"flex h-9 items-center rounded-full bg-surface-2 p-0.75 md:h-8.5 md:items-stretch md:rounded-md md:border md:border-border-strong",
				className,
			)}
			renderOption={(option, selected) => ({
				content: option.content,
				className: clsx(
					"flex h-7 items-center justify-center rounded-full border border-transparent md:rounded-sm",
					optionClassName ?? "w-9.5 md:w-7.5",
					selected ? "bg-raised text-accent-text shadow-sm" : "text-text-muted",
				),
			})}
		/>
	);
}
