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
			onChange={onChange}
			data={watchProviders}
			name="providerWatchedOn"
			label={`Where did you ${getVerb(Verb.Read, metadataLot)} it?`}
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
			className={OnboardingTourStepTargets.AddAudiobookToWatchedHistory}
			onClick={() => {
				onClick();
				advanceOnboardingTourStep();
			}}
		>
			Submit
		</Button>
	);
};
