import {
	ActionIcon,
	Affix,
	Alert,
	Anchor,
	Badge,
	Box,
	Button,
	Divider,
	Flex,
	Group,
	Modal,
	Paper,
	Stack,
	Text,
	Tooltip,
	rem,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	type CollectionToEntityDetailsPartFragment,
	EntityLot,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import { IconArrowsShuffle, IconCancel, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useAddEntitiesToCollectionMutation,
	useConfirmSubmit,
	useCoreDetails,
	useGetRandomMantineColor,
	useRemoveEntitiesFromCollectionMutation,
} from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	type BulkAddEntities,
	useBulkEditCollection,
} from "~/lib/state/collection";
import {
	ExerciseDisplayItem,
	WorkoutDisplayItem,
	WorkoutTemplateDisplayItem,
} from "../fitness/display-items";
import {
	MetadataDisplayItem,
	MetadataGroupDisplayItem,
	PersonDisplayItem,
} from "../media/display-items";

export const ProRequiredAlert = (props: {
	alertText?: string;
	tooltipLabel?: string;
}) => {
	const coreDetails = useCoreDetails();

	return !coreDetails.isServerKeyValidated ? (
		<Alert>
			<Tooltip label={props.tooltipLabel} disabled={!props.tooltipLabel}>
				<Text size="xs">{props.alertText || PRO_REQUIRED_MESSAGE}</Text>
			</Tooltip>
		</Alert>
	) : null;
};

export const DisplayCollectionEntity = (props: {
	entityId: string;
	entityLot: EntityLot;
	topRight?: ReactNode;
}) =>
	match(props.entityLot)
		.with(EntityLot.Metadata, () => (
			<MetadataDisplayItem
				rightLabelLot
				topRight={props.topRight}
				metadataId={props.entityId}
			/>
		))
		.with(EntityLot.MetadataGroup, () => (
			<MetadataGroupDisplayItem
				noLeftLabel
				topRight={props.topRight}
				metadataGroupId={props.entityId}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.Person, () => (
			<PersonDisplayItem
				personId={props.entityId}
				topRight={props.topRight}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.Exercise, () => (
			<ExerciseDisplayItem
				topRight={props.topRight}
				exerciseId={props.entityId}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.Workout, () => (
			<WorkoutDisplayItem
				topRight={props.topRight}
				workoutId={props.entityId}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.WorkoutTemplate, () => (
			<WorkoutTemplateDisplayItem
				topRight={props.topRight}
				workoutTemplateId={props.entityId}
			/>
		))
		.run();

export const DisplayCollectionToEntity = (props: {
	entityId: string;
	entityLot: EntityLot;
	col: CollectionToEntityDetailsPartFragment;
}) => {
	const color = useGetRandomMantineColor(props.col.details.collectionName);
	const removeEntitiesFromCollection =
		useRemoveEntitiesFromCollectionMutation();
	const [opened, { open, close }] = useDisclosure(false);

	const handleRemove = () => {
		openConfirmationModal(
			"Are you sure you want to remove this media from this collection?",
			() => {
				removeEntitiesFromCollection.mutate(
					{
						creatorUserId: props.col.details.creatorUserId,
						collectionName: props.col.details.collectionName,
						entities: [
							{ entityId: props.entityId, entityLot: props.entityLot },
						],
					},
					{
						onSuccess: () => {
							notifications.show({
								color: "green",
								title: "Success",
								message: "Removed from collection",
							});
						},
					},
				);
			},
		);
	};

	return (
		<>
			<Badge key={props.col.details.collectionId} color={color}>
				<Flex gap={2}>
					<Text
						truncate
						onClick={open}
						style={{ all: "unset", cursor: "pointer" }}
					>
						{props.col.details.collectionName}
					</Text>
					<ActionIcon
						size={16}
						onClick={handleRemove}
						loading={removeEntitiesFromCollection.isPending}
					>
						<IconX />
					</ActionIcon>
				</Flex>
			</Badge>
			<Modal
				opened={opened}
				onClose={close}
				title={
					<Anchor
						component={Link}
						to={$path("/collections/:id", {
							id: props.col.details.collectionId,
						})}
					>
						{props.col.details.collectionName}
					</Anchor>
				}
			>
				<Stack>
					<Group>
						<Text size="sm" c="dimmed">
							First Added On:
						</Text>
						<Text size="sm">
							{dayjsLib(props.col.details.createdOn).format("LLL")}
						</Text>
					</Group>
					<Group>
						<Text size="sm" c="dimmed">
							Updated On:
						</Text>
						<Text size="sm">
							{dayjsLib(props.col.details.lastUpdatedOn).format("LLL")}
						</Text>
					</Group>
					{(props.col.details.information || 0).length > 0 && (
						<>
							<Divider />
							<Text size="sm" fw={500}>
								Additional Information:
							</Text>
							<Stack gap="xs">
								{Object.entries(props.col.details.information).map(
									([key, value]) => {
										return (
											<Group key={key}>
												<Text size="sm" c="dimmed">
													{key}:
												</Text>
												<Text size="sm">{String(value)}</Text>
											</Group>
										);
									},
								)}
							</Stack>
						</>
					)}
				</Stack>
			</Modal>
		</>
	);
};

export const DisplayListDetailsAndRefresh = (props: {
	total: number;
	cacheId?: string;
	rightSection?: ReactNode;
	isRandomSortOrderSelected?: boolean;
}) => {
	const submit = useConfirmSubmit();

	return (
		<Group justify="space-between" wrap="nowrap">
			<Box>
				<Text display="inline" fw="bold">
					{props.total}
				</Text>{" "}
				item{props.total === 1 ? "" : "s"} found
				{props.rightSection}
			</Box>
			{props.cacheId && props.isRandomSortOrderSelected ? (
				<Form
					replace
					method="POST"
					onSubmit={submit}
					action={withQuery($path("/actions"), { intent: "expireCacheKey" })}
				>
					<input type="hidden" name="cacheId" value={props.cacheId} />
					<Button
						size="xs"
						type="submit"
						variant="subtle"
						leftSection={<IconArrowsShuffle size={20} />}
					>
						Refresh
					</Button>
				</Form>
			) : null}
		</Group>
	);
};

export const BulkCollectionEditingAffix = (props: {
	bulkAddEntities: BulkAddEntities;
}) => {
	const bulkEditingCollection = useBulkEditCollection();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();
	const removeEntitiesFromCollection =
		useRemoveEntitiesFromCollectionMutation();

	const bulkEditingCollectionState = bulkEditingCollection.state;

	if (!bulkEditingCollectionState) return null;

	const handleBulkAction = async () => {
		const { action, collection, entities } = bulkEditingCollectionState.data;

		if (action === "remove") {
			await removeEntitiesFromCollection.mutateAsync({
				entities,
				collectionName: collection.name,
				creatorUserId: collection.creatorUserId,
			});
			notifications.show({
				color: "green",
				title: "Success",
				message: `Removing ${entities.length} item${entities.length === 1 ? "" : "s"} from collection`,
			});
		} else {
			await addEntitiesToCollection.mutateAsync({
				entities,
				collectionName: collection.name,
				creatorUserId: collection.creatorUserId,
			});
			notifications.show({
				color: "green",
				title: "Success",
				message: `Adding ${entities.length} item${entities.length === 1 ? "" : "s"} to collection`,
			});
		}

		bulkEditingCollectionState.stop();
	};

	const handleConfirmBulkAction = () => {
		const { action, collection, entities } = bulkEditingCollectionState.data;
		const actionText = action === "remove" ? "remove" : "add";
		const itemCount = entities.length;
		const message = `Are you sure you want to ${actionText} ${itemCount} item${itemCount === 1 ? "" : "s"} ${action === "remove" ? "from" : "to"} "${collection.name}"?`;

		openConfirmationModal(message, handleBulkAction);
	};

	const isLoading =
		addEntitiesToCollection.isPending || removeEntitiesFromCollection.isPending;

	return (
		<Affix position={{ bottom: rem(30) }} w="100%" px="sm">
			<Paper withBorder shadow="xl" p="md" w={{ md: "40%" }} mx="auto">
				<Group wrap="nowrap" justify="space-between">
					<Text fz={{ base: "xs", md: "md" }}>
						{bulkEditingCollectionState.data.entities.length} items selected
					</Text>
					<Group wrap="nowrap">
						<ActionIcon
							size="md"
							onClick={() => bulkEditingCollectionState.stop()}
						>
							<IconCancel />
						</ActionIcon>
						<Button
							size="xs"
							color="blue"
							loading={bulkEditingCollectionState.data.isLoading}
							onClick={() =>
								bulkEditingCollectionState.bulkAdd(props.bulkAddEntities)
							}
						>
							Select all items
						</Button>
						<Button
							size="xs"
							loading={isLoading}
							onClick={handleConfirmBulkAction}
							disabled={bulkEditingCollectionState.data.entities.length === 0}
							color={
								bulkEditingCollectionState.data.action === "remove"
									? "red"
									: "green"
							}
						>
							{changeCase(bulkEditingCollectionState.data.action)}
						</Button>
					</Group>
				</Group>
			</Paper>
		</Affix>
	);
};

export * from "./entity-display";
export * from "./filters";
export * from "./layout";
export * from "./multi-select-creatable";
export * from "./review";
export * from "./summary";
