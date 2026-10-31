import { type KeyboardEvent, type ReactNode, useRef } from "react";

export type RadioGroupOptionView = { readonly content: ReactNode; readonly className?: string };

export type RadioGroupOption = {
	readonly value: string;
	readonly label: string;
	readonly disabled?: boolean;
};

type RadioGroupProps<O extends RadioGroupOption> = {
	readonly label: string;
	readonly className?: string;
	readonly options: readonly O[];
	readonly value: undefined | O["value"];
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
	const radios = useRef<Array<null | HTMLButtonElement>>([]);
	const enabled = options.flatMap((option, index) => (option.disabled === true ? [] : [index]));
	const selectedIndex = options.findIndex((option) => option.value === value);
	const tabStop = enabled.includes(selectedIndex) ? selectedIndex : enabled[0];

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const count = enabled.length;
		const current = enabled.indexOf(index);
		let target: number | undefined;
		if (event.key === "Home") {
			target = enabled[0];
		} else if (event.key === "End") {
			target = enabled[count - 1];
		} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
			target = enabled[(current - 1 + count) % count];
		} else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
			target = enabled[(current + 1) % count];
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
				const disabled = option.disabled === true;
				const view = renderOption(option, selected);
				return (
					<button
						role="radio"
						type="button"
						key={option.value}
						aria-checked={selected}
						aria-label={option.label}
						className={view.className}
						aria-disabled={disabled || undefined}
						tabIndex={index === tabStop ? 0 : -1}
						onKeyDown={(event) => onKeyDown(event, index)}
						ref={(element) => {
							radios.current[index] = element;
						}}
						onClick={() => {
							if (!disabled) {
								onChange(option.value);
							}
						}}
					>
						{view.content}
					</button>
				);
			})}
		</div>
	);
}
