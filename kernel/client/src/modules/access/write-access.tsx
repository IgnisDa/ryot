import type { WriteAccess } from "@ryot-app/contract/oauth";
import { Select } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

export const writeAccessOptions = [
	{ value: "none", label: "Read only", detail: "Can read your data but never change it." },
	{
		value: "confirm",
		label: "Ask before each change",
		detail:
			"Each change waits for your approval in the app. Apps that cannot ask, and direct API requests, cannot change anything.",
	},
	{
		value: "unattended",
		label: "Allow changes without asking",
		detail: "Can change and delete your data, including through your plugins, without asking.",
	},
] as const satisfies readonly {
	readonly label: string;
	readonly detail: string;
	readonly value: WriteAccess;
}[];

export const writeAccessLabel = (access: WriteAccess) =>
	writeAccessOptions.find((option) => option.value === access)?.label ?? access;

export function WriteAccessField(props: {
	readonly value: WriteAccess;
	readonly disabled?: boolean;
	readonly maximum?: WriteAccess;
	readonly onChange: (access: WriteAccess) => void;
}) {
	const limit = writeAccessOptions.findIndex((option) => option.value === props.maximum);
	const options = limit === -1 ? writeAccessOptions : writeAccessOptions.slice(0, limit + 1);
	const selected = options.find((option) => option.value === props.value);
	return (
		<div className="grid gap-2">
			<Select
				label="Access"
				value={props.value}
				disabled={props.disabled}
				checkIcon={<AppIcon size={16} name="check" />}
				chevronIcon={<AppIcon size={16} name="chevron-down" />}
				choices={options.map(({ value, label }) => ({ value, label }))}
				onChange={(value) => {
					const option = options.find((candidate) => candidate.value === value);
					if (option) {
						props.onChange(option.value);
					}
				}}
			/>
			<p className="text-sm text-text-muted">{selected?.detail}</p>
		</div>
	);
}
