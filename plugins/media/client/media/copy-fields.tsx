import { Field, Select } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ComponentProps } from "react";

import type { MediaCopy, MediaText } from "../messages";

export const mediaCopyOption = (
	{ value, label }: { value: string; label?: undefined | Parameters<MediaCopy["local"]>[0] },
	{ local, display }: MediaCopy,
) => ({ value, label: label === undefined ? display(value) : local(label) });

export const mediaCopyBooleanOptions = (text: MediaText) => [
	{ value: "true", label: text("ownership.yes") },
	{ value: "false", label: text("ownership.no") },
];

export function MediaCopySelectField(
	props: Pick<ComponentProps<typeof Select>, "label" | "value" | "choices" | "onChange">,
) {
	return (
		<Field label={props.label}>
			{({ id }) => (
				<Select
					{...props}
					id={id}
					checkIcon={<AppIcon size={16} name="check" />}
					chevronIcon={<AppIcon size={16} name="chevron-down" />}
				/>
			)}
		</Field>
	);
}
