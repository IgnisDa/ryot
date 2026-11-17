import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { DateTime } from "effect";
import { type ReactNode, type Ref, useState } from "react";

import { resolveDateTimeInput, toDateTimeInput } from "./datetime";
import { Select } from "./select";
import { Field, TextField } from "./text-field";

export const useDateTimeInput = (
	original: null | string | undefined,
	timeZone?: string | DateTime.TimeZone,
) => {
	const [value, setValue] = useState(() => (original ? toDateTimeInput(original, timeZone) : ""));
	const [occurrence, setOccurrence] = useState<string>();
	return {
		value,
		onOccurrenceChange: setOccurrence,
		resolution: resolveDateTimeInput(value, original, occurrence, timeZone),
		onChange: (next: string) => {
			setValue(next);
			setOccurrence(undefined);
		},
	};
};

export function DateTimeField(props: {
	readonly label: Text;
	readonly value: string;
	readonly showError: boolean;
	readonly checkIcon: ReactNode;
	readonly chevronIcon: ReactNode;
	readonly optional?: boolean | undefined;
	readonly inputRef?: Ref<HTMLInputElement>;
	readonly onChange: (value: string) => void;
	readonly onOccurrenceChange: (value: string) => void;
	readonly resolution: ReturnType<typeof resolveDateTimeInput>;
}) {
	const t = useT();
	const { error } = props.resolution;
	return (
		<div className="grid gap-2">
			<Field
				label={props.label}
				optional={props.optional === true}
				error={props.showError && error !== undefined ? t(error) : undefined}
			>
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
					checkIcon={props.checkIcon}
					chevronIcon={props.chevronIcon}
					value={props.resolution.occurrence}
					onChange={props.onOccurrenceChange}
					placeholder={t(kernelMessage("ui.datetime.choose-occurrence"))}
					label={t(kernelMessage("ui.datetime.occurrence-field", { label: props.label }))}
					choices={props.resolution.choices.map((choice) => ({
						...choice,
						label: t(choice.label),
					}))}
				/>
			) : null}
		</div>
	);
}
