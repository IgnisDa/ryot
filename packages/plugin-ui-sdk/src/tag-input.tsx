import { type KeyboardEvent, type ReactNode, useState } from "react";

import { Chip } from "./chips";
import { TextField } from "./text-field";

export function TagInput(props: {
	readonly removeIcon: ReactNode;
	readonly id?: string | undefined;
	readonly values: readonly string[];
	readonly invalid?: boolean | undefined;
	readonly maxItems?: number | undefined;
	readonly maxLength?: number | undefined;
	readonly placeholder?: string | undefined;
	readonly "aria-describedby"?: string | undefined;
	readonly removeLabel?: (value: string) => string;
	readonly onChange: (values: readonly string[]) => void;
}) {
	const [text, setText] = useState("");
	const full = props.maxItems !== undefined && props.values.length >= props.maxItems;
	const commit = () => {
		const value = text.trim();
		setText("");
		if (value === "" || full) {
			return;
		}
		const key = value.toLowerCase();
		if (!props.values.some((existing) => existing.toLowerCase() === key)) {
			props.onChange([...props.values, value]);
		}
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			commit();
		} else if (event.key === "Backspace" && text === "") {
			props.onChange(props.values.slice(0, -1));
		}
	};
	return (
		<div className="flex flex-col gap-2">
			{props.values.length === 0 ? null : (
				<ul className="flex flex-wrap gap-1.5">
					{props.values.map((value) => (
						<li key={value} className="flex items-center gap-1">
							<Chip checked label={value} />
							<button
								type="button"
								aria-label={props.removeLabel?.(value) ?? `Remove ${value}`}
								onClick={() => props.onChange(props.values.filter((item) => item !== value))}
								className="flex text-text-muted hover:text-text pointer-coarse:size-9 pointer-coarse:items-center pointer-coarse:justify-center"
							>
								{props.removeIcon}
							</button>
						</li>
					))}
				</ul>
			)}
			<TextField
				type="text"
				value={text}
				id={props.id}
				disabled={full}
				onBlur={commit}
				onKeyDown={onKeyDown}
				invalid={props.invalid}
				maxLength={props.maxLength}
				placeholder={props.placeholder}
				aria-describedby={props["aria-describedby"]}
				onChange={(event) => setText(event.currentTarget.value)}
			/>
		</div>
	);
}
