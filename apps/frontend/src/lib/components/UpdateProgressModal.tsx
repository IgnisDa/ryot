import { gqlClient } from "@/lib/services/api";
import { Verb, getVerb } from "@/lib/utilities";
import { Button, Group, Modal, Select, Stack, Title } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useMutation } from "@tanstack/react-query";
import {
	MetadataLot,
	ProgressUpdateAction,
	type MediaDetailsQuery,
	type ProgressUpdateMutationVariables,
} from "@trackona/generated/graphql/backend/graphql";
import { PROGRESS_UPDATE } from "@trackona/graphql/backend/mutations";
import { DateTime } from "luxon";
import { useState, type Dispatch, type SetStateAction } from "react";

type ShowSpecifics = MediaDetailsQuery["mediaDetails"]["showSpecifics"];

export enum UpdateStep {
	ChooseEpisode,
	SetProgress,
}

export function ChooseEpisode(props: {
	opened: boolean;
	onClose: () => void;
	lot: MetadataLot;
	showSpecifics: ShowSpecifics;
	selectedSeason: string | null;
	setSelectedEpisode: Dispatch<SetStateAction<string | null>>;
	setSelectedSeason: Dispatch<SetStateAction<string | null>>;
}) {
	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Stack>
				{props.showSpecifics ? (
					<>
						<Title order={3}>Select episode</Title>
						<Select
							label="Season"
							data={props.showSpecifics.seasons.map((s) => ({
								label: s.name.toString(),
								value: s.seasonNumber.toString(),
							}))}
							onChange={props.setSelectedSeason}
							withinPortal
						/>
						{props.selectedSeason ? (
							<Select
								label="Episode"
								data={props.showSpecifics.seasons
									.find((s) => s.seasonNumber === Number(props.selectedSeason))!
									.episodes.map((e) => ({
										label: e.name.toString(),
										value: e.episodeNumber.toString(),
									}))}
								onChange={props.setSelectedEpisode}
								withinPortal
							/>
						) : null}
						<Button
							variant="outline"
							onClick={() => {
								props.onClose();
							}}
						>
							Select
						</Button>
						<Button variant="outline" color="red" onClick={props.onClose}>
							Cancel
						</Button>
					</>
				) : null}
			</Stack>
		</Modal>
	);
}

export default function UpdateProgressModal(props: {
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	refetch: () => void;
	title: string;
	lot: MetadataLot;
	showSpecifics?: ShowSpecifics;
}) {
	const [step, setSelectedStep] = useState(
		props.lot === MetadataLot.Show
			? UpdateStep.ChooseEpisode
			: UpdateStep.SetProgress,
	);
	const [selectedEpisode, setSelectedEpisode] = useState<string | null>(null);
	const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const progressUpdate = useMutation({
		mutationFn: async (variables: ProgressUpdateMutationVariables) => {
			const { progressUpdate } = await gqlClient.request(
				PROGRESS_UPDATE,
				variables,
			);
			return progressUpdate;
		},
		onSuccess: () => {
			if (props.lot === MetadataLot.Show)
				setSelectedStep(UpdateStep.ChooseEpisode);
			props.refetch();
			props.onClose();
		},
	});
	const mutationInput = {
		metadataId: props.metadataId,
		episodeNumber: Number(selectedEpisode),
		seasonNumber: Number(selectedSeason),
	};

	return step === UpdateStep.ChooseEpisode ? (
		<ChooseEpisode
			opened={props.opened}
			setSelectedEpisode={setSelectedEpisode}
			selectedSeason={selectedSeason}
			setSelectedSeason={setSelectedSeason}
			showSpecifics={props.showSpecifics}
			lot={props.lot}
			onClose={() => {
				setSelectedStep(UpdateStep.SetProgress);
			}}
		/>
	) : (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Stack>
				<Title order={3}>
					When did you {getVerb(Verb.Read, props.lot)} "{props.title}"?
				</Title>
				<Button
					variant="outline"
					onClick={async () => {
						await progressUpdate.mutateAsync({
							input: { action: ProgressUpdateAction.Now, ...mutationInput },
						});
					}}
				>
					Now
				</Button>
				<Button
					variant="outline"
					onClick={async () => {
						await progressUpdate.mutateAsync({
							input: {
								action: ProgressUpdateAction.InThePast,
								...mutationInput,
							},
						});
					}}
				>
					I do not remember
				</Button>
				<Group grow>
					<DatePickerInput
						dropdownType="modal"
						maxDate={new Date()}
						onChange={setSelectedDate}
						clearable
					/>
					<Button
						variant="outline"
						disabled={selectedDate === null}
						onClick={async () => {
							if (selectedDate)
								await progressUpdate.mutateAsync({
									input: {
										action: ProgressUpdateAction.InThePast,
										date: DateTime.fromJSDate(selectedDate).toISODate(),
										...mutationInput,
									},
								});
						}}
					>
						Custom date
					</Button>
				</Group>
				<Button variant="outline" color="red" onClick={props.onClose}>
					Cancel
				</Button>
			</Stack>
		</Modal>
	);
}
