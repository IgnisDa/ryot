import { Field, Select, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { Ref } from "react";

import type { resolveDateTimeInput } from "./datetime-input";

export function DateTimeField(props: {
	readonly label: string;
	readonly value: string;
	readonly showError: boolean;
	readonly inputRef?: Ref<HTMLInputElement>;
	readonly onChange: (value: string) => void;
	readonly onOccurrenceChange: (value: string) => void;
	readonly resolution: ReturnType<typeof resolveDateTimeInput>;
}) {
	return (
		<div className="grid gap-2">
			<Field label={props.label} error={props.showError ? props.resolution.error : undefined}>
				{(control) => (
					<TextField
						{...control}
						value={props.value}
						ref={props.inputRef}
						type="datetime-local"
						onChange={(event) => props.onChange(event.target.value)}
					/>
				)}
			</Field>
			{props.resolution.choices.length > 1 ? (
				<Select
					placeholder="Choose an occurrence"
					choices={props.resolution.choices}
					label={`${props.label} occurrence`}
					value={props.resolution.occurrence}
					onChange={props.onOccurrenceChange}
					checkIcon={<AppIcon size={14} name="check" />}
					chevronIcon={<AppIcon size={14} name="chevron-down" />}
				/>
			) : null}
		</div>
	);
}
