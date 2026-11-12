import type { PublicationMode } from "@ryot-app/contract/modules/publications/schemas";
import { Select } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

export function PublicationModeField(props: {
	readonly value: PublicationMode;
	readonly onChange: (mode: PublicationMode) => void;
}) {
	return (
		<div className="grid gap-2">
			<Select
				label="Mode"
				value={props.value}
				checkIcon={<AppIcon size={16} name="check" />}
				chevronIcon={<AppIcon size={16} name="chevron-down" />}
				onChange={(value) => props.onChange(value === "snapshot" ? "snapshot" : "live")}
				choices={[
					{ value: "live", label: "Live" },
					{ value: "snapshot", label: "Snapshot" },
				]}
			/>
			<p className="text-sm text-text-muted">
				{props.value === "live"
					? "Uses the latest published page and current data on each visit. Visitors cannot change your data."
					: "Captures the first page of every query and freezes the page code until you refresh it. Search, filters, sorting, loading more and other interactions that need new server results are unavailable. Visitors cannot change your data."}
			</p>
		</div>
	);
}
