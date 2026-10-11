import { Select, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ComponentProps } from "react";

export function EditorSelect(
	props: Omit<ComponentProps<typeof Select>, "checkIcon" | "chevronIcon">,
) {
	return (
		<Select
			{...props}
			checkIcon={<AppIcon size={16} name="check" />}
			chevronIcon={<AppIcon size={16} name="chevron-down" />}
		/>
	);
}

export function EditorField(props: {
	readonly label: string;
	readonly value: string | undefined;
	readonly onChange: (value: string) => void;
	readonly numeric?: boolean;
	readonly disabled?: boolean;
}) {
	return (
		<label className="flex min-w-0 flex-col gap-1 text-sm text-text-subtle">
			{props.label}
			<TextField
				aria-label={props.label}
				disabled={props.disabled}
				value={props.value ?? ""}
				inputMode={props.numeric ? "decimal" : "text"}
				onChange={(event) => props.onChange(event.target.value)}
			/>
		</label>
	);
}

export const editorModalClass =
	"m-auto flex max-h-[90%] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-5 text-text shadow-card";
