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
				"inline-flex h-9 items-stretch gap-0.5 rounded-md bg-surface-2 p-0.5 pointer-coarse:h-11",
				className,
			)}
			renderOption={(option, selected) => ({
				content: option.content,
				className: clsx(
					"flex items-center justify-center gap-1.5 rounded-sm text-[13px] font-medium transition-colors duration-100 motion-reduce:transition-none",
					optionClassName ?? "w-8 pointer-coarse:w-10",
					selected
						? "bg-raised text-text shadow-sm ring-1 ring-border"
						: "text-text-muted hover:text-text",
				),
			})}
		/>
	);
}
