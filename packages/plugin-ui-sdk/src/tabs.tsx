import clsx from "clsx";
import { type KeyboardEvent, type ReactNode, useRef } from "react";

export type TabOption<T extends string> = {
	readonly value: T;
	readonly label: string;
	readonly trailing?: ReactNode;
};

export const tabId = (panelId: string, value: string) => `${panelId}-tab-${value}`;

export function Tabs<T extends string>(props: {
	readonly value: T;
	readonly label: string;
	readonly panelId: string;
	readonly className?: string;
	readonly onChange: (value: T) => void;
	readonly options: readonly TabOption<T>[];
}) {
	const tabs = useRef<Array<HTMLButtonElement | null>>([]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const current = props.options.findIndex((option) => option.value === props.value);
		const count = props.options.length;
		const targets: Partial<Record<string, number>> = {
			Home: 0,
			End: count - 1,
			ArrowRight: (current + 1) % count,
			ArrowLeft: (current - 1 + count) % count,
		};
		const next = targets[event.key];
		const option = next === undefined ? undefined : props.options[next];
		if (next === undefined || option === undefined) {
			return;
		}
		event.preventDefault();
		props.onChange(option.value);
		tabs.current[next]?.focus();
	};

	return (
		<div
			role="tablist"
			onKeyDown={onKeyDown}
			aria-label={props.label}
			className={clsx("flex gap-5 overflow-x-auto border-b border-border", props.className)}
		>
			{props.options.map((option, index) => {
				const selected = option.value === props.value;
				return (
					<button
						role="tab"
						type="button"
						key={option.value}
						aria-selected={selected}
						tabIndex={selected ? 0 : -1}
						id={tabId(props.panelId, option.value)}
						onClick={() => props.onChange(option.value)}
						aria-controls={selected ? props.panelId : undefined}
						ref={(element) => {
							tabs.current[index] = element;
						}}
						className={clsx(
							"-mb-px flex shrink-0 items-center gap-1.5 border-b-2 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-100 motion-reduce:transition-none",
							selected
								? "border-text text-text"
								: "border-transparent text-text-muted hover:text-text",
						)}
					>
						{option.label}
						{option.trailing}
					</button>
				);
			})}
		</div>
	);
}
