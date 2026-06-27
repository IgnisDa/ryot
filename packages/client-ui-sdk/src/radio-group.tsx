import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type RadioGroupOption = {
	readonly value: string;
	readonly label: string;
};

export type RadioGroupOptionView = {
	readonly content: ReactNode;
	readonly className?: string;
};

type RadioGroupProps<O extends RadioGroupOption> = {
	readonly label: string;
	readonly className?: string;
	readonly options: readonly O[];
	readonly value: O["value"] | undefined;
	readonly onChange: (value: O["value"]) => void;
	readonly renderOption: (option: O, selected: boolean) => RadioGroupOptionView;
};

export function RadioGroup<O extends RadioGroupOption>({
	label,
	value,
	options,
	onChange,
	className,
	renderOption,
}: RadioGroupProps<O>) {
	const radios = useRef<Array<HTMLButtonElement | null>>([]);
	const selectedIndex = options.findIndex((option) => option.value === value);
	const tabStop = selectedIndex === -1 ? 0 : selectedIndex;

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const count = options.length;
		let target: number | undefined;
		if (event.key === "Home") {
			target = 0;
		} else if (event.key === "End") {
			target = count - 1;
		} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
			target = (index - 1 + count) % count;
		} else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
			target = (index + 1) % count;
		}
		const option = target === undefined ? undefined : options[target];
		if (target === undefined || option === undefined) {
			return;
		}
		event.preventDefault();
		radios.current[target]?.focus();
		onChange(option.value);
	};

	return (
		<div role="radiogroup" aria-label={label} className={className}>
			{options.map((option, index) => {
				const selected = index === selectedIndex;
				const view = renderOption(option, selected);
				return (
					<button
						role="radio"
						type="button"
						key={option.value}
						aria-checked={selected}
						aria-label={option.label}
						className={view.className}
						tabIndex={index === tabStop ? 0 : -1}
						onClick={() => onChange(option.value)}
						onKeyDown={(event) => onKeyDown(event, index)}
						ref={(element) => {
							radios.current[index] = element;
						}}
					>
						{view.content}
					</button>
				);
			})}
		</div>
	);
}
