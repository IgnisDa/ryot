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
	type MantineSize,
	Modal,
	NumberInput,
	Pagination,
	Paper,
	Select,
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
	ExpireCacheKeyDocument,
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
	IconX,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useAddEntitiesToCollectionMutation,
	useCoreDetails,
	useGetRandomMantineColor,
	useRemoveEntitiesFromCollectionMutation,
	useUserCollections,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/react-query";
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
	onRefreshButtonClicked?: () => void;
	isRandomSortOrderSelected?: boolean;
}) => {
	const expireCacheKey = useMutation({
		mutationFn: (cacheId: string) =>
			clientGqlService.request(ExpireCacheKeyDocument, { cacheId }),
	});

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
					onClick={async () => {
						await expireCacheKey.mutateAsync(props.cacheId ?? "");
						props.onRefreshButtonClicked?.();
					}}
					leftSection={<IconArrowsShuffle size={20} />}
				>
					Refresh
				</Button>
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
		const {
			action,
			collection,
			targetEntities: entities,
		} = bulkEditingCollectionState.data;
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
}) => {
	return (
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
						value={props.value}
						label={props.template.name}
						required={!!props.template.required}
						description={props.template.description}
						onChange={(v) => props.onChange(v)}
					/>
				))
				.with(CollectionExtraInformationLot.DateTime, () => (
					<DateTimePicker
						value={props.value}
						label={props.template.name}
						required={!!props.template.required}
						description={props.template.description}
						onChange={(v) => props.onChange(dayjsLib(v).toISOString())}
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
};

export const ApplicationPagination = (props: {
	value?: number;
	total?: number;
	size?: MantineSize;
	onChange: (value: number) => void;
}) => {
	if (!props.total || props.total <= 0) return null;

	const currentPage = props.value || 1;
	const totalPages = props.total;

	if (totalPages <= 7) {
		return (
			<Center>
				<Pagination
					total={totalPages}
					value={currentPage}
					onChange={props.onChange}
					size={props.size || "sm"}
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
				{currentPage > 1 && (
					<ActionIcon
						size="sm"
						variant="default"
						onClick={() => props.onChange(currentPage - 1)}
					>
						<IconChevronLeft size={16} />
					</ActionIcon>
				)}

				<Button size="compact-xs" onClick={() => props.onChange(1)}>
					1
				</Button>

				<Select
					size="xs"
					limit={10}
					searchable
					w={rem(100)}
					data={pageOptions}
					value={String(currentPage)}
					onChange={(value) => value && props.onChange(Number(value))}
				/>

				{currentPage < totalPages && (
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
							onClick={() => props.onChange(currentPage + 1)}
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
