import { MultiSelect, Select } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import type { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { METADATA_LOTS_WITH_GRANULAR_UPDATES } from "~/components/routes/media-item/constants";
import { useGetWatchProviders } from "~/lib/shared/hooks";
import { getVerb } from "~/lib/shared/media-utils";
import { Verb } from "~/lib/types";
import { WatchTimes } from "../../../types";

interface WatchTimeSelectProps {
	value: WatchTimes;
	metadataLot: MediaLot;
	onChange: (value: WatchTimes) => void;
}

export const WatchTimeSelect = (props: WatchTimeSelectProps) => {
	return (
		<Select
			size="xs"
			value={props.value}
			onChange={(v) => props.onChange(v as WatchTimes)}
			label={`When did you ${getVerb(Verb.Read, props.metadataLot)} it?`}
			data={Object.values(WatchTimes).filter((v) =>
				METADATA_LOTS_WITH_GRANULAR_UPDATES.includes(props.metadataLot)
					? v !== WatchTimes.JustStartedIt
					: true,
			)}
		/>
	);
};

interface CustomDatePickerProps {
	startDate: Date | null;
	finishDate: Date | null;
	onStartDateChange: (date: Date | null) => void;
	onFinishDateChange: (date: Date | null) => void;
}

export const CustomDatePicker = (props: CustomDatePickerProps) => {
	return (
		<>
			<DateTimePicker
				clearable
				size="xs"
				value={props.startDate}
				label="Started on"
				dropdownType="modal"
				maxDate={props.finishDate || new Date()}
				onChange={(e) => props.onStartDateChange(e ? new Date(e) : null)}
			/>
			<DateTimePicker
				clearable
				size="xs"
				value={props.finishDate}
				label="Finished on"
				dropdownType="modal"
				maxDate={new Date()}
				minDate={props.startDate || undefined}
				onChange={(e) => props.onFinishDateChange(e ? new Date(e) : null)}
			/>
		</>
	);
};

interface ProviderSelectProps {
	value?: string[];
	metadataLot: MediaLot;
	onChange: (providers: string[]) => void;
}

export const ProviderSelect = (props: ProviderSelectProps) => {
	const watchProviders = useGetWatchProviders(props.metadataLot);

	return (
		<MultiSelect
			size="xs"
			value={props.value || []}
			onChange={props.onChange}
			data={watchProviders}
			name="providersConsumedOn"
			label={`Where did you ${getVerb(Verb.Read, props.metadataLot)} it?`}
			nothingFoundMessage="Please add your provider from the general preference settings"
		/>
	);
};
