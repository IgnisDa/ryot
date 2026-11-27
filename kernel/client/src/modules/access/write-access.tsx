import type { WriteAccess } from "@ryot-app/contract/oauth";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Select } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

export const writeAccessOptions = [
	{
		value: "none",
		label: kernelMessage("client.access.write-access.none.label"),
		detail: kernelMessage("client.access.write-access.none.detail"),
	},
	{
		value: "confirm",
		label: kernelMessage("client.access.write-access.confirm.label"),
		detail: kernelMessage("client.access.write-access.confirm.detail"),
	},
	{
		value: "unattended",
		label: kernelMessage("client.access.write-access.unattended.label"),
		detail: kernelMessage("client.access.write-access.unattended.detail"),
	},
] as const satisfies readonly {
	readonly label: Message;
	readonly detail: Message;
	readonly value: WriteAccess;
}[];

export const writeAccessLabel = (t: (message: Message) => Text, access: WriteAccess) => {
	const option = writeAccessOptions.find((candidate) => candidate.value === access);
	return option === undefined ? access : t(option.label);
};

export function WriteAccessField(props: {
	readonly value: WriteAccess;
	readonly disabled?: boolean;
	readonly maximum?: WriteAccess;
	readonly onChange: (access: WriteAccess) => void;
}) {
	const t = useT();
	const limit = writeAccessOptions.findIndex((option) => option.value === props.maximum);
	const options = limit === -1 ? writeAccessOptions : writeAccessOptions.slice(0, limit + 1);
	const selected = options.find((option) => option.value === props.value);
	return (
		<div className="grid gap-2">
			<Select
				value={props.value}
				disabled={props.disabled}
				checkIcon={<AppIcon size={16} name="check" />}
				chevronIcon={<AppIcon size={16} name="chevron-down" />}
				label={t(kernelMessage("client.access.write-access.label"))}
				choices={options.map(({ value, label }) => ({ value, label: t(label) }))}
				onChange={(value) => {
					const option = options.find((candidate) => candidate.value === value);
					if (option) {
						props.onChange(option.value);
					}
				}}
			/>
			<p className="text-sm text-text-muted">
				{selected === undefined ? null : t(selected.detail)}
			</p>
		</div>
	);
}
