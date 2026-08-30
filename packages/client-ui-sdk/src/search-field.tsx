import type { Hotkey } from "@tanstack/react-hotkeys";
import clsx from "clsx";
import { useRef, type ReactNode, type RefObject } from "react";

import { Badge } from "./badge";
import { useFieldEscape } from "./field-escape";
import { useShortcut } from "./shortcut";

type SearchFieldProps = {
	readonly label: string;
	readonly value: string;
	readonly icon: ReactNode;
	readonly shortcut?: Hotkey;
	readonly className?: string;
	readonly autoFocus?: boolean;
	readonly clearIcon: ReactNode;
	readonly placeholder?: string;
	readonly onSubmit?: () => void;
	readonly onChange: (value: string) => void;
	readonly inputRef?: RefObject<HTMLInputElement | null>;
};

export function SearchField({
	icon,
	label,
	value,
	inputRef,
	shortcut,
	onChange,
	onSubmit,
	clearIcon,
	autoFocus,
	className,
	placeholder,
}: SearchFieldProps) {
	const fallbackRef = useRef<HTMLInputElement>(null);
	const input = inputRef ?? fallbackRef;
	useShortcut(shortcut ?? "/", () => input.current?.focus(), {
		enabled: shortcut !== undefined,
	});
	useFieldEscape(input, { hasValue: value !== "", onClear: () => onChange("") });

	return (
		<form
			role="search"
			className={clsx("relative min-w-0", className)}
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit?.();
			}}
		>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
			>
				{icon}
			</span>
			<input
				ref={input}
				type="search"
				value={value}
				aria-label={label}
				autoFocus={autoFocus}
				aria-keyshortcuts={shortcut}
				placeholder={placeholder ?? label}
				onChange={(event) => onChange(event.currentTarget.value)}
				className="h-full w-full rounded-full border border-border-strong bg-surface-2 pr-9 pl-9 text-base text-text outline-none placeholder:text-text-subtle focus-visible:ring-2 focus-visible:ring-focus md:rounded-md md:bg-bg md:text-[13px]"
			/>
			{value === "" && shortcut !== undefined && (
				<Badge
					variant="key"
					aria-hidden="true"
					className="absolute top-1/2 right-2.5 -translate-y-1/2"
				>
					{shortcut}
				</Badge>
			)}
			{value !== "" && (
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => onChange("")}
					className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-text-muted"
				>
					{clearIcon}
				</button>
			)}
		</form>
	);
}
