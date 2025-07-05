import { Select } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { useGetWatchProviders } from "~/lib/hooks";
import { getVerb } from "~/lib/media-utils";
import { Verb } from "~/lib/types";
import { WatchTimes } from "../../../types";

interface WatchTimeSelectProps {
	value: WatchTimes;
	metadataLot: MediaLot;
	onChange: (value: WatchTimes) => void;
}

export const WatchTimeSelect = ({
	value,
	onChange,
	metadataLot,
}: WatchTimeSelectProps) => {
	return (
		<Select
			size="xs"
			value={value}
			onChange={(v) => onChange(v as WatchTimes)}
			label={`When did you ${getVerb(Verb.Read, metadataLot)} it?`}
			data={Object.values(WatchTimes).filter((v) =>
				[
					MediaLot.Show,
					MediaLot.Podcast,
					MediaLot.Anime,
					MediaLot.Manga,
				].includes(metadataLot)
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

export const CustomDatePicker = ({
	startDate,
	finishDate,
	onStartDateChange,
	onFinishDateChange,
}: CustomDatePickerProps) => {
	return (
		<>
			<DateTimePicker
				clearable
				size="xs"
				value={startDate}
				label="Started on"
				dropdownType="modal"
				maxDate={finishDate || new Date()}
				onChange={(e) => onStartDateChange(e ? new Date(e) : null)}
			/>
			<DateTimePicker
				clearable
				size="xs"
				value={finishDate}
				label="Finished on"
				dropdownType="modal"
				maxDate={new Date()}
				minDate={startDate || undefined}
				onChange={(e) => onFinishDateChange(e ? new Date(e) : null)}
			/>
		</>
	);
};

interface ProviderSelectProps {
	metadataLot: MediaLot;
	onChange: (provider: string | null) => void;
}

export const ProviderSelect = ({
	metadataLot,
	onChange,
}: ProviderSelectProps) => {
	const watchProviders = useGetWatchProviders(metadataLot);

	return (
		<Select
			size="xs"
			onChange={onChange}
			data={watchProviders}
			name="providerWatchedOn"
			label={`Where did you ${getVerb(Verb.Read, metadataLot)} it?`}
		/>
	);
};
