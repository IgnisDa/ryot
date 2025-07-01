import {
	ActionIcon,
	Affix,
	Alert,
	Anchor,
	Badge,
	Box,
	Button,
	Combobox,
	Divider,
	Flex,
	Group,
	Modal,
	Paper,
	Pill,
	PillsInput,
	Stack,
	Text,
	Tooltip,
	rem,
	useCombobox,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	type CollectionToEntityDetailsPartFragment,
	EntityLot,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import {
	IconArrowsShuffle,
	IconCancel,
	IconCheck,
	IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Form, Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import {
	PRO_REQUIRED_MESSAGE,
	dayjsLib,
	openConfirmationModal,
} from "~/lib/common";
import {
	useAddEntitiesToCollection,
	useConfirmSubmit,
	useCoreDetails,
	useGetRandomMantineColor,
	useRemoveEntitiesFromCollection,
} from "~/lib/hooks";
import {
	type BulkAddEntities,
	useBulkEditCollection,
} from "~/lib/state/collection";
import {
	ExerciseDisplayItem,
	WorkoutDisplayItem,
	WorkoutTemplateDisplayItem,
} from "../fitness";
import {
	MetadataDisplayItem,
	MetadataGroupDisplayItem,
	PersonDisplayItem,
} from "../media";

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
	const color = useGetRandomMantineColor(props.col.details.collection.name);
	const removeEntitiesFromCollection = useRemoveEntitiesFromCollection();
	const [opened, { open, close }] = useDisclosure(false);

	const handleRemove = () => {
		openConfirmationModal(
			"Are you sure you want to remove this media from this collection?",
			() => {
				removeEntitiesFromCollection.mutate(
					{
						collectionName: props.col.details.collection.name,
						creatorUserId: props.col.details.collection.userId,
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
			<Badge key={props.col.details.collection.id} color={color}>
				<Flex gap={2}>
					<Text
						truncate
						onClick={open}
						style={{ all: "unset", cursor: "pointer" }}
					>
						{props.col.details.collection.name}
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
							id: props.col.details.collection.id,
						})}
					>
						{props.col.details.collection.name}
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
					{props.col.details.information && (
						<>
							<Divider />
							<Text size="sm" fw={500}>
								Additional Information:
							</Text>
							<Stack gap="xs">
								{Object.entries(props.col.details.information).map(
									([key, value]) => (
										<Group key={key}>
											<Text size="sm" c="dimmed">
												{key}:
											</Text>
											<Text size="sm">{String(value)}</Text>
										</Group>
									),
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
	const addEntitiesToCollection = useAddEntitiesToCollection();
	const removeEntitiesFromCollection = useRemoveEntitiesFromCollection();

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

type MultiSelectCreatableProps = {
	label: string;
	data: string[];
	value: string[];
	required?: boolean;
	description?: string;
	setValue: (value: string[]) => void;
};

export const MultiSelectCreatable = (props: MultiSelectCreatableProps) => {
	const combobox = useCombobox({
		onDropdownClose: () => combobox.resetSelectedOption(),
		onDropdownOpen: () => combobox.updateSelectedOptionIndex("active"),
	});

	const [search, setSearch] = useState("");
	const [data, setData] = useState(props.data);

	const exactOptionMatch = data.some((item) => item === search);

	const handleValueSelect = (val: string) => {
		if (val === "$create") {
			setData((current) => [...current, search]);
			props.setValue([...props.value, search]);
		} else {
			props.setValue(
				props.value.includes(val)
					? props.value.filter((v) => v !== val)
					: [...props.value, val],
			);
		}
		setSearch("");
	};

	const handleValueRemove = (val: string) =>
		props.setValue(props.value.filter((v) => v !== val));

	const values = props.value.map((item) => (
		<Pill key={item} withRemoveButton onRemove={() => handleValueRemove(item)}>
			{item}
		</Pill>
	));

	const options = data
		.filter((item) => item.toLowerCase().includes(search.trim().toLowerCase()))
		.map((item) => (
			<Combobox.Option
				key={item}
				value={item}
				active={props.value.includes(item)}
			>
				<Group gap="sm">
					{props.value.includes(item) ? <IconCheck size={12} /> : null}
					<span>{item}</span>
				</Group>
			</Combobox.Option>
		));

	return (
		<Combobox
			store={combobox}
			withinPortal={false}
			onOptionSubmit={handleValueSelect}
		>
			<Combobox.DropdownTarget>
				<PillsInput
					label={props.label}
					required={props.required}
					description={props.description}
					onClick={() => combobox.openDropdown()}
				>
					<Pill.Group>
						{values}
						<Combobox.EventsTarget>
							<PillsInput.Field
								value={search}
								placeholder="Search values"
								onFocus={() => combobox.openDropdown()}
								onBlur={() => combobox.closeDropdown()}
								onChange={(event) => {
									combobox.updateSelectedOptionIndex();
									setSearch(event.currentTarget.value);
								}}
								onKeyDown={(event) => {
									if (event.key === "Backspace" && search.length === 0) {
										event.preventDefault();
										handleValueRemove(props.value[props.value.length - 1]);
									}
								}}
							/>
						</Combobox.EventsTarget>
					</Pill.Group>
				</PillsInput>
			</Combobox.DropdownTarget>

			<Combobox.Dropdown>
				<Combobox.Options>
					{options}
					{!exactOptionMatch && search.trim().length > 0 && (
						<Combobox.Option value="$create">+ Create {search}</Combobox.Option>
					)}
					{exactOptionMatch &&
						search.trim().length > 0 &&
						options.length === 0 && (
							<Combobox.Empty>Nothing found</Combobox.Empty>
						)}
				</Combobox.Options>
			</Combobox.Dropdown>
		</Combobox>
	);
};

export * from "./entity-display";
export * from "./filters";
export * from "./layout";
export * from "./review";
export * from "./summary";
