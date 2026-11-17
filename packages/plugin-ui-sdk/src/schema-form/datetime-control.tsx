import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

import { resolveDateTimeInput } from "../datetime";
import { Select } from "../select";
import { FieldMessage, TextField } from "../text-field";
import type { SchemaFormIcons } from "./form";
import type { SchemaFormValue } from "./state";

export function DateTimeControl(props: {
	readonly label: Text;
	readonly value: string;
	readonly timeZone: string;
	readonly icons: SchemaFormIcons;
	readonly original: string | undefined;
	readonly onChange: (value: SchemaFormValue) => void;
}) {
	const t = useT();
	const resolution = resolveDateTimeInput(props.value, props.original, undefined, props.timeZone);
	return (
		<div className="grid gap-2">
			<TextField
				step="any"
				density="compact"
				value={props.value}
				type="datetime-local"
				aria-label={props.label}
				onChange={(event) => {
					const text = event.currentTarget.value;
					props.onChange(
						text === ""
							? null
							: (resolveDateTimeInput(text, props.original, undefined, props.timeZone).iso ?? {
									wallTime: text,
								}),
					);
				}}
			/>
			{resolution.choices.length > 1 ? (
				<Select
					value={resolution.occurrence}
					checkIcon={props.icons.check}
					chevronIcon={props.icons.chevron}
					placeholder={t(kernelMessage("ui.datetime.choose-occurrence"))}
					label={t(kernelMessage("ui.datetime.occurrence-field", { label: props.label }))}
					choices={resolution.choices.map((choice) => ({ ...choice, label: t(choice.label) }))}
					onChange={(occurrence) => {
						const selected = resolveDateTimeInput(
							props.value,
							props.original,
							occurrence,
							props.timeZone,
						);
						if (selected.iso !== null) {
							props.onChange(selected.iso);
						}
					}}
				/>
			) : null}
			{props.value !== "" && resolution.error ? (
				<FieldMessage>{t(resolution.error)}</FieldMessage>
			) : null}
		</div>
	);
}
