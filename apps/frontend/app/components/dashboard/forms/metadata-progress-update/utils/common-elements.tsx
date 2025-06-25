import { Button, Select } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { Verb, getVerb } from "~/lib/common";
import { useGetWatchProviders } from "~/lib/hooks";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import { WatchTimes } from "../../../types";

interface WatchTimeSelectProps {
	value: WatchTimes;
	onChange: (value: WatchTimes) => void;
	metadataLot: MediaLot;
}

export const WatchTimeSelect = ({
	value,
	onChange,
	metadataLot,
}: WatchTimeSelectProps) => {
	return (
		<Select
			value={value}
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
			onChange={(v) => onChange(v as WatchTimes)}
		/>
	);
};

interface CustomDatePickerProps {
	selectedDate: Date | null;
	onDateChange: (date: Date | null) => void;
}

export const CustomDatePicker = ({ onDateChange }: CustomDatePickerProps) => {
	return (
		<DateTimePicker
			required
			clearable
			dropdownType="modal"
			maxDate={new Date()}
			label="Enter exact date"
			onChange={(e) => onDateChange(e ? new Date(e) : null)}
		/>
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
			data={watchProviders}
			name="providerWatchedOn"
			label={`Where did you ${getVerb(Verb.Read, metadataLot)} it?`}
			onChange={onChange}
		/>
	);
};

interface SubmitButtonProps {
	disabled: boolean;
	onClick: () => void;
}

export const SubmitButton = ({ disabled, onClick }: SubmitButtonProps) => {
	const { advanceOnboardingTourStep } = useOnboardingTour();

	return (
		<Button
			variant="outline"
			disabled={disabled}
			className={OnboardingTourStepTargets.AddMovieToWatchedHistory}
			onClick={() => {
				onClick();
				advanceOnboardingTourStep();
			}}
		>
			Submit
		</Button>
	);
};
