import {
	ActionIcon,
	Affix,
	Alert,
	Anchor,
	Badge,
	Box,
	Button,
	Center,
	CopyButton,
	Divider,
	Flex,
	Group,
	Modal,
	NumberInput,
	Pagination,
	Paper,
	Select,
	Skeleton,
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
	MediaSource,
	type Scalars,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import {
	IconArrowsShuffle,
	IconCancel,
	IconCheck,
	IconChevronLeft,
	IconChevronRight,
	IconCopy,
	IconPencil,
	IconPhotoPlus,
	IconX,
} from "@tabler/icons-react";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useAddEntitiesToCollectionMutation,
	useCoreDetails,
	useExpireCacheKeyMutation,
	useGetRandomMantineColor,
	useRemoveEntitiesFromCollectionMutation,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { refreshEntityDetails } from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	type BulkEditEntitiesToCollection,
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

export const SkeletonLoader = () => <Skeleton height={100} />;

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
	const hasExtraInformationFields =
		!!thisCollection?.informationTemplate?.length;
	const userAddedInfoCount = Object.keys(
		props.col.details.information || {},
	).length;
	const hasUserAddedAdditionalInformation = userAddedInfoCount > 0;

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
							refreshEntityDetails(props.entityId);
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
					{hasExtraInformationFields ? (
						<>
							<Divider />
							<Group justify="space-between">
								<Text td="underline">
									{hasUserAddedAdditionalInformation
										? "Additional Information"
										: "No Additional Information"}
								</Text>
								<ActionIcon size="sm" variant="default" onClick={handleEdit}>
									<IconPencil size={16} />
								</ActionIcon>
							</Group>
							{hasUserAddedAdditionalInformation ? (
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
															.with(
																CollectionExtraInformationLot.DateTime,
																() => dayjsLib(stringValue).format("LLL"),
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
							) : null}
						</>
					) : null}
				</Stack>
			</Modal>
		</>
	);
};

export const DisplayListDetailsAndRefresh = (props: {
	total: number;
	cacheId?: string;
	rightSection?: ReactNode;
	onRefreshButtonClicked?: () => void;
	isRandomSortOrderSelected?: boolean;
}) => {
	const expireCacheKey = useExpireCacheKeyMutation();

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
				<Button
					size="xs"
					variant="subtle"
					leftSection={<IconArrowsShuffle size={20} />}
					onClick={async () => {
						await expireCacheKey.mutateAsync(props.cacheId ?? "");
						props.onRefreshButtonClicked?.();
					}}
				>
					Refresh
				</Button>
			) : null}
		</Group>
	);
};

export const BulkCollectionEditingAffix = (props: {
	bulkAddEntities: BulkEditEntitiesToCollection;
}) => {
	const bulkEditingCollection = useBulkEditCollection();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();
	const removeEntitiesFromCollection =
		useRemoveEntitiesFromCollectionMutation();

	const bulkEditingCollectionState = bulkEditingCollection.state;

	if (!bulkEditingCollectionState) return null;

	const handleBulkAction = async () => {
		const { action, collection, targetEntities } =
			bulkEditingCollectionState.data;

		const isRemoving = action === "remove";
		const mutation = isRemoving
			? removeEntitiesFromCollection
			: addEntitiesToCollection;
		const actionText = isRemoving ? "Removing" : "Adding";

		await mutation.mutateAsync({
			entities: targetEntities,
			collectionName: collection.name,
			creatorUserId: collection.creatorUserId,
		});

		notifications.show({
			color: "green",
			title: "Success",
			message: `${actionText} ${targetEntities.length} item${targetEntities.length === 1 ? "" : "s"} ${isRemoving ? "from" : "to"} collection`,
		});

		bulkEditingCollectionState.stop();
	};

	const handleConfirmBulkAction = () => {
		const { action, collection, targetEntities } =
			bulkEditingCollectionState.data;
		const itemCount = targetEntities.length;
		const message = `Are you sure you want to ${action} ${itemCount} item${itemCount === 1 ? "" : "s"} ${action === "remove" ? "from" : "to"} "${collection.name}"?`;

		openConfirmationModal(message, handleBulkAction);
	};

	const isLoading =
		addEntitiesToCollection.isPending || removeEntitiesFromCollection.isPending;

	return (
		<Affix position={{ bottom: rem(30) }} w="100%" px="sm">
			<Paper withBorder shadow="xl" p="md" w={{ md: "40%" }} mx="auto">
				<Group wrap="nowrap" justify="space-between">
					<Text fz={{ base: "xs", md: "md" }}>
						{bulkEditingCollectionState.data.targetEntities.length} items
						selected
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
							disabled={
								bulkEditingCollectionState.data.targetEntities.length === 0
							}
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

export const CollectionTemplateRenderer = (props: {
	value: Scalars["JSON"]["input"];
	template: CollectionExtraInformation;
	onChange: (value: Scalars["JSON"]["input"]) => void;
}) => (
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

export const ApplicationPagination = (props: {
	value: number;
	totalItems: number;
	onChange: (value: number) => void;
}) => {
	const userPreferences = useUserPreferences();
	const pageSize = userPreferences.general.listPageSize;
	const totalPages = Math.ceil(props.totalItems / pageSize);

	if (!props.totalItems || totalPages <= 1) return null;

	if (totalPages <= 7) {
		return (
			<Center>
				<Pagination
					size="sm"
					total={totalPages}
					value={props.value}
					onChange={props.onChange}
				/>
			</Center>
		);
	}

	const pageOptions = Array.from({ length: totalPages }, (_, i) => ({
		value: String(i + 1),
		label: `Page ${i + 1}`,
	}));

	return (
		<Center>
			<Group gap="xs">
				{props.value > 1 && (
					<ActionIcon
						size="sm"
						variant="default"
						onClick={() => props.onChange(props.value - 1)}
					>
						<IconChevronLeft size={16} />
					</ActionIcon>
				)}

				<Button size="compact-xs" onClick={() => props.onChange(1)}>
					1
				</Button>

				<Select
					size="xs"
					searchable
					w={rem(100)}
					data={pageOptions}
					value={String(props.value)}
					onChange={(value) => value && props.onChange(Number(value))}
				/>

				{props.value < totalPages && (
					<>
						<Button
							size="compact-xs"
							onClick={() => props.onChange(totalPages)}
						>
							{totalPages}
						</Button>
						<ActionIcon
							size="sm"
							variant="default"
							onClick={() => props.onChange(props.value + 1)}
						>
							<IconChevronRight size={16} />
						</ActionIcon>
					</>
				)}
			</Group>
		</Center>
	);
};

export const CopyableTextInput = (props: {
	value?: string;
	description?: string;
	containerStyle?: CSSProperties;
}) => {
	return (
		<TextInput
			readOnly
			value={props.value}
			style={props.containerStyle}
			description={props.description}
			onClick={(e) => e.currentTarget.select()}
			rightSection={
				<CopyButton value={props.value || ""}>
					{({ copied, copy }) => (
						<Tooltip
							withArrow
							position="left"
							label={copied ? "Copied" : "Copy"}
						>
							<ActionIcon onClick={copy} color={copied ? "teal" : "gray"}>
								{copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
							</ActionIcon>
						</Tooltip>
					)}
				</CopyButton>
			}
		/>
	);
};

export const CreateButton = (props: { to: string }) => (
	<Box ml="auto" visibleFrom="md">
		<Button
			component={Link}
			variant="transparent"
			leftSection={<IconPhotoPlus />}
			to={props.to}
		>
			Create
		</Button>
	</Box>
);

interface EditButtonProps {
	label: string;
	entityId: string;
	source: MediaSource;
	createdByUserId?: string | null;
	editRouteType: "media" | "groups" | "people";
}

export const EditButton = (props: EditButtonProps) => {
	const userDetails = useUserDetails();
	const canCurrentUserUpdate =
		props.source === MediaSource.Custom &&
		userDetails.id === props.createdByUserId;

	if (!canCurrentUserUpdate) return null;

	const editPath = useMemo(() => {
		switch (props.editRouteType) {
			case "media":
				return $path(
					"/media/item/update/:action",
					{ action: "edit" },
					{ id: props.entityId },
				);
			case "groups":
				return $path(
					"/media/groups/update/:action",
					{ action: "edit" },
					{ id: props.entityId },
				);
			case "people":
				return $path(
					"/media/people/update/:action",
					{ action: "edit" },
					{ id: props.entityId },
				);
			default:
				throw new Error(`Unknown edit route type: ${props.editRouteType}`);
		}
	}, [props.editRouteType, props.entityId]);

	return (
		<Button component={Link} variant="outline" to={editPath}>
			{props.label}
		</Button>
	);
};
