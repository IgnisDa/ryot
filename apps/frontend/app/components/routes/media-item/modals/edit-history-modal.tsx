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
	useUserDetails,
} from "~/lib/shared/hooks";
import { getVerb } from "~/lib/shared/media-utils";
import { refreshEntityDetails } from "~/lib/shared/react-query";
import { Verb } from "~/lib/types";
import {
	type DurationInput,
	type History,
	type MetadataDetails,
	POSSIBLE_DURATION_UNITS,
	type UserMetadataDetails,
} from "../types";
import { convertDurationToSeconds, convertSecondsToDuration } from "../utils";

export const EditHistoryItemModal = (props: {
	seen: History;
	opened: boolean;
	onClose: () => void;
	metadataDetails: MetadataDetails;
	userMetadataDetails: UserMetadataDetails;
}) => {
	const userDetails = useUserDetails();
	const reviewsByThisCurrentUser = props.userMetadataDetails.reviews.filter(
		(r) => r.postedBy.id === userDetails.id,
	);
	const { startedOn, finishedOn, id, manualTimeSpent, providersConsumedOn } =
		props.seen;
	const coreDetails = useCoreDetails();
	const isNotCompleted = props.seen.state !== SeenState.Completed;
	const watchProviders = useGetWatchProviders(props.metadataDetails.lot);
	const [manualTimeSpentValue, setManualTimeSpentValue] =
		useState<DurationInput>(convertSecondsToDuration(manualTimeSpent));
	const manualTimeSpentInSeconds =
		convertDurationToSeconds(manualTimeSpentValue);

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
					refreshEntityDetails(props.metadataDetails.id);
				}}
			>
				<input hidden name="seenId" defaultValue={id} />
				<Stack>
					<Title order={3}>Edit history record</Title>
					<DateTimePicker
						name="startedOn"
						label="Start Date & Time"
						disabled={isNotCompleted}
						defaultValue={startedOn ? new Date(startedOn) : undefined}
					/>
					<DateTimePicker
						name="finishedOn"
						label="End Date & Time"
						disabled={isNotCompleted}
						defaultValue={finishedOn ? new Date(finishedOn) : undefined}
					/>
					<MultiSelect
						data={watchProviders}
						name="providersConsumedOn"
						defaultValue={providersConsumedOn || []}
						nothingFoundMessage="No watch providers configured. Please add them in your general preferences."
						label={`Where did you ${getVerb(
							Verb.Read,
							props.metadataDetails.lot,
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
								label: [
									r.textOriginal
										? `${r.textOriginal.slice(0, 20)}...`
										: undefined,
									r.rating,
									`(${r.id})`,
								]
									.filter(Boolean)
									.join(" • "),
								value: r.id,
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
