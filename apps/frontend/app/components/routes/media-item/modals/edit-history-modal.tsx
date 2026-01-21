import {
	Button,
	FocusTrap,
	Group,
	Input,
	Modal,
	MultiSelect,
	NumberInput,
	Select,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { SeenState } from "@ryot/generated/graphql/backend/graphql";
import { useState } from "react";
import { Form } from "react-router";
import { withQuery } from "ufo";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
	useGetWatchProviders,
	useMetadataDetails,
	useUserDetails,
	useUserMetadataDetails,
} from "~/lib/shared/hooks";
import { getVerb } from "~/lib/shared/media-utils";
import { refreshEntityDetails } from "~/lib/shared/react-query";
import { Verb } from "~/lib/types";
import {
	type DurationInput,
	type History,
	POSSIBLE_DURATION_UNITS,
} from "../types";
import { convertDurationToSeconds, convertSecondsToDuration } from "../utils";

export const EditHistoryItemModal = (props: {
	seen: History;
	opened: boolean;
	onClose: () => void;
	metadataId: string;
}) => {
	const userDetails = useUserDetails();
	const coreDetails = useCoreDetails();
	const [{ data: metadataDetails }] = useMetadataDetails(props.metadataId);
	const watchProviders = useGetWatchProviders(metadataDetails?.lot);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);
	const [manualTimeSpentValue, setManualTimeSpentValue] =
		useState<DurationInput>(
			convertSecondsToDuration(props.seen.manualTimeSpent),
		);

	const manualTimeSpentInSeconds =
		convertDurationToSeconds(manualTimeSpentValue);
	const reviewsByThisCurrentUser = (userMetadataDetails?.reviews ?? []).filter(
		(r) => r.postedBy.id === userDetails.id,
	);
	const areStartAndEndInputsDisabled = ![
		SeenState.Completed,
		SeenState.Dropped,
	].includes(props.seen.state);

	if (!metadataDetails) return null;

	return (
		<Modal
			centered
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
		>
			<FocusTrap.InitialFocus />
			<Form
				replace
				method="POST"
				action={withQuery(".", { intent: "editSeenItem" })}
				onSubmit={() => {
					props.onClose();
					refreshEntityDetails(props.metadataId);
				}}
			>
				<input hidden name="seenId" defaultValue={props.seen.id} />
				<Stack>
					<Title order={3}>Edit history record</Title>
					<DateTimePicker
						name="startedOn"
						label="Start Date & Time"
						disabled={areStartAndEndInputsDisabled}
						defaultValue={
							props.seen.startedOn ? new Date(props.seen.startedOn) : undefined
						}
					/>
					<DateTimePicker
						name="finishedOn"
						label="End Date & Time"
						disabled={areStartAndEndInputsDisabled}
						defaultValue={
							props.seen.finishedOn
								? new Date(props.seen.finishedOn)
								: undefined
						}
					/>
					<MultiSelect
						data={watchProviders}
						name="providersConsumedOn"
						defaultValue={props.seen.providersConsumedOn || []}
						nothingFoundMessage="No watch providers configured. Please add them in your general preferences."
						label={`Where did you ${getVerb(
							Verb.Read,
							metadataDetails.lot,
						)} it?`}
					/>
					<Tooltip
						label={PRO_REQUIRED_MESSAGE}
						disabled={coreDetails.isServerKeyValidated}
					>
						<Select
							clearable
							limit={5}
							searchable
							name="reviewId"
							label="Associate with a review"
							defaultValue={props.seen.reviewId}
							disabled={!coreDetails.isServerKeyValidated}
							data={reviewsByThisCurrentUser.map((r) => ({
								value: r.id,
								label: [
									r.textOriginal
										? `${r.textOriginal.slice(0, 20)}...`
										: undefined,
									r.rating,
									`(${r.id})`,
								]
									.filter(Boolean)
									.join(" • "),
							}))}
						/>
					</Tooltip>
					<Input.Wrapper
						label="Time spent"
						description="How much time did you actually spend on this media?"
					>
						<Tooltip
							label={PRO_REQUIRED_MESSAGE}
							disabled={coreDetails.isServerKeyValidated}
						>
							<Group wrap="nowrap" mt="xs">
								{POSSIBLE_DURATION_UNITS.map((input) => (
									<NumberInput
										key={input}
										rightSectionWidth={36}
										defaultValue={manualTimeSpentValue[input]}
										disabled={!coreDetails.isServerKeyValidated}
										rightSection={<Text size="xs">{input}</Text>}
										onChange={(v) => {
											setManualTimeSpentValue((prev) => ({
												...prev,
												[input]: v,
											}));
										}}
									/>
								))}
								{manualTimeSpentInSeconds > 0 ? (
									<input
										hidden
										readOnly
										name="manualTimeSpent"
										value={manualTimeSpentInSeconds}
									/>
								) : null}
							</Group>
						</Tooltip>
					</Input.Wrapper>
					<Button variant="outline" type="submit">
						Submit
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};
