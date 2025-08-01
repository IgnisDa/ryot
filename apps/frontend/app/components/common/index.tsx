import {
	ActionIcon,
	Affix,
	Alert,
	Anchor,
	Badge,
	Box,
	Button,
	Center,
	Divider,
	Flex,
	Group,
	type MantineSize,
	Modal,
	NumberInput,
	Pagination,
	Paper,
	Stack,
	Switch,
	Text,
	TextInput,
	Tooltip,
	rem,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	type CollectionExtraInformation,
	CollectionExtraInformationLot,
	type CollectionToEntityDetailsPartFragment,
	EntityLot,
	type Scalars,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import {
	IconArrowsShuffle,
	IconCancel,
	IconPencil,
	IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import { Fragment } from "react/jsx-runtime";
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
	useUserCollections,
} from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	type BulkAddEntities,
	useBulkEditCollection,
	useEditEntityCollectionInformation,
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
import { MultiSelectCreatable } from "./multi-select-creatable";

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
	topLeft?: ReactNode;
	topRight?: ReactNode;
}) =>
	match(props.entityLot)
		.with(EntityLot.Metadata, () => (
			<MetadataDisplayItem
				rightLabelLot
				topLeft={props.topLeft}
				topRight={props.topRight}
				metadataId={props.entityId}
			/>
		))
		.with(EntityLot.MetadataGroup, () => (
			<MetadataGroupDisplayItem
				noLeftLabel
				topLeft={props.topLeft}
				topRight={props.topRight}
				metadataGroupId={props.entityId}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.Person, () => (
			<PersonDisplayItem
				topLeft={props.topLeft}
				personId={props.entityId}
				topRight={props.topRight}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.Exercise, () => (
			<ExerciseDisplayItem
				topLeft={props.topLeft}
				topRight={props.topRight}
				exerciseId={props.entityId}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.Workout, () => (
			<WorkoutDisplayItem
				topLeft={props.topLeft}
				topRight={props.topRight}
				workoutId={props.entityId}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.WorkoutTemplate, () => (
			<WorkoutTemplateDisplayItem
				topLeft={props.topLeft}
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
	const userCollections = useUserCollections();
	const color = useGetRandomMantineColor(props.col.details.collectionName);
	const removeEntitiesFromCollection =
		useRemoveEntitiesFromCollectionMutation();
	const [opened, { open, close }] = useDisclosure(false);
	const [, setEditEntityCollectionInformationData] =
		useEditEntityCollectionInformation();

	const thisCollection = userCollections.find(
		(c) => c.id === props.col.details.collectionId,
	);

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

	const handleEdit = () => {
		close();
		setEditEntityCollectionInformationData({
			entityId: props.entityId,
			entityLot: props.entityLot,
			collectionId: props.col.details.collectionId,
			creatorUserId: props.col.details.creatorUserId,
			collectionName: props.col.details.collectionName,
			existingInformation: props.col.details.information || {},
		});
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
					{Object.keys(props.col.details.information || {}).length > 0 && (
						<>
							<Divider />
							<Group justify="space-between">
								<Text size="sm" fw={500}>
									Additional Information:
								</Text>
								<ActionIcon size="sm" variant="subtle" onClick={handleEdit}>
									<IconPencil size={16} />
								</ActionIcon>
							</Group>
							<Stack gap="xs">
								{Object.entries(props.col.details.information).map(
									([key, value]) => {
										const stringValue = String(value);
										const lot = thisCollection?.informationTemplate?.find(
											(v) => v.name === key,
										)?.lot;
										return (
											<Group key={key}>
												<Text size="sm" c="dimmed">
													{key}:
												</Text>
												<Text size="sm">
													{match(lot)
														.with(CollectionExtraInformationLot.DateTime, () =>
															dayjsLib(stringValue).format("LLL"),
														)
														.with(CollectionExtraInformationLot.Date, () =>
															dayjsLib(stringValue).format("LL"),
														)
														.with(
															CollectionExtraInformationLot.StringArray,
															() => (value as string[]).join(", "),
														)
														.otherwise(() => stringValue)}
												</Text>
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

export const CollectionTemplateRenderer = ({
	value,
	template,
	onChange,
}: {
	value: Scalars["JSON"]["input"];
	template: CollectionExtraInformation;
	onChange: (value: Scalars["JSON"]["input"]) => void;
}) => {
	return (
		<Fragment>
			{match(template.lot)
				.with(CollectionExtraInformationLot.String, () => (
					<TextInput
						value={value || ""}
						label={template.name}
						required={!!template.required}
						description={template.description}
						onChange={(e) => onChange(e.currentTarget.value)}
					/>
				))
				.with(CollectionExtraInformationLot.Boolean, () => (
					<Switch
						label={template.name}
						checked={value === "true"}
						required={!!template.required}
						description={template.description}
						onChange={(e) =>
							onChange(e.currentTarget.checked ? "true" : "false")
						}
					/>
				))
				.with(CollectionExtraInformationLot.Number, () => (
					<NumberInput
						value={value}
						label={template.name}
						required={!!template.required}
						description={template.description}
						onChange={(v) => onChange(v)}
					/>
				))
				.with(CollectionExtraInformationLot.Date, () => (
					<DateInput
						value={value}
						label={template.name}
						required={!!template.required}
						description={template.description}
						onChange={(v) => onChange(v)}
					/>
				))
				.with(CollectionExtraInformationLot.DateTime, () => (
					<DateTimePicker
						value={value}
						label={template.name}
						required={!!template.required}
						description={template.description}
						onChange={(v) => onChange(dayjsLib(v).toISOString())}
					/>
				))
				.with(CollectionExtraInformationLot.StringArray, () => (
					<MultiSelectCreatable
						values={value}
						label={template.name}
						required={!!template.required}
						description={template.description}
						data={template.possibleValues || []}
						setValue={(newValue: string[]) => onChange(newValue)}
					/>
				))
				.exhaustive()}
		</Fragment>
	);
};

export const ApplicationPagination = (props: {
	value?: number;
	total?: number;
	size?: MantineSize;
	onChange: (value: number) => void;
}) => {
	if (!props.total || props.total <= 0) return null;

	return (
		<Center>
			<Pagination
				total={props.total}
				value={props.value || 1}
				onChange={props.onChange}
				size={props.size || "sm"}
			/>
		</Center>
	);
};
