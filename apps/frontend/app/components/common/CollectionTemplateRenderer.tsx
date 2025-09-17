import { NumberInput, Switch, TextInput } from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import {
	type CollectionExtraInformation,
	CollectionExtraInformationLot,
	type Scalars,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";
import { dayjsLib } from "~/lib/shared/date-utils";
import { MultiSelectCreatable } from "./multi-select-creatable";

export interface CollectionTemplateRendererProps {
	value: Scalars["JSON"]["input"];
	template: CollectionExtraInformation;
	onChange: (value: Scalars["JSON"]["input"]) => void;
}

export const CollectionTemplateRenderer = (
	props: CollectionTemplateRendererProps,
) => (
	<>
		{match(props.template.lot)
			.with(CollectionExtraInformationLot.String, () => (
				<TextInput
					value={props.value || ""}
					label={props.template.name}
					required={!!props.template.required}
					description={props.template.description}
					onChange={(e) => props.onChange(e.currentTarget.value)}
				/>
			))
			.with(CollectionExtraInformationLot.Boolean, () => (
				<Switch
					label={props.template.name}
					checked={props.value === "true"}
					required={!!props.template.required}
					description={props.template.description}
					onChange={(e) =>
						props.onChange(e.currentTarget.checked ? "true" : "false")
					}
				/>
			))
			.with(CollectionExtraInformationLot.Number, () => (
				<NumberInput
					value={props.value}
					label={props.template.name}
					required={!!props.template.required}
					description={props.template.description}
					onChange={(v) => props.onChange(v)}
				/>
			))
			.with(CollectionExtraInformationLot.Date, () => (
				<DateInput
					clearable
					value={props.value}
					label={props.template.name}
					required={!!props.template.required}
					description={props.template.description}
					onChange={(v) => props.onChange(v)}
				/>
			))
			.with(CollectionExtraInformationLot.DateTime, () => (
				<DateTimePicker
					clearable
					value={props.value}
					label={props.template.name}
					required={!!props.template.required}
					description={props.template.description}
					onChange={(v) =>
						props.onChange(v ? dayjsLib(v).toISOString() : undefined)
					}
				/>
			))
			.with(CollectionExtraInformationLot.StringArray, () => (
				<MultiSelectCreatable
					values={props.value}
					label={props.template.name}
					required={!!props.template.required}
					description={props.template.description}
					data={props.template.possibleValues || []}
					setValue={(newValue: string[]) => props.onChange(newValue)}
				/>
			))
			.exhaustive()}
	</>
);
