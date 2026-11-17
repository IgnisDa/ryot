import type { PublicationMode } from "@ryot-app/contract/modules/publications/schemas";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Select } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

export function PublicationModeField(props: {
	readonly value: PublicationMode;
	readonly onChange: (mode: PublicationMode) => void;
}) {
	const t = useT();
	return (
		<div className="grid gap-2">
			<Select
				value={props.value}
				checkIcon={<AppIcon size={16} name="check" />}
				chevronIcon={<AppIcon size={16} name="chevron-down" />}
				label={t(kernelMessage("client.publications.mode.label"))}
				onChange={(value) => props.onChange(value === "snapshot" ? "snapshot" : "live")}
				choices={[
					{ value: "live", label: t(kernelMessage("client.publications.mode.live")) },
					{ value: "snapshot", label: t(kernelMessage("client.publications.mode.snapshot")) },
				]}
			/>
			<p className="text-sm text-text-muted">
				{t(
					props.value === "live"
						? kernelMessage("client.publications.mode.live-detail")
						: kernelMessage("client.publications.mode.snapshot-detail"),
				)}
			</p>
		</div>
	);
}
