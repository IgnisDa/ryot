import {
	ActionIcon,
	Affix,
	Alert,
	Anchor,
	Badge,
	Box,
	Button,
	Center,
	Combobox,
	Divider,
	Flex,
	Group,
	Image,
	type MantineStyleProp,
	Modal,
	Paper,
	Pill,
	PillsInput,
	Skeleton,
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
	GridPacking,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, snakeCase } from "@ryot/ts-utils";
import {
	IconArrowsShuffle,
	IconCancel,
	IconCheck,
	IconX,
} from "@tabler/icons-react";
import clsx from "clsx";
import type { ReactNode, Ref } from "react";
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
	useFallbackImageUrl,
	useGetRandomMantineColor,
	useRemoveEntitiesFromCollection,
	useUserPreferences,
} from "~/lib/hooks";
import {
	type BulkAddEntities,
	useBulkEditCollection,
} from "~/lib/state/collection";
import classes from "~/styles/common.module.css";
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

const blackBgStyles = {
	backgroundColor: "rgba(0, 0, 0, 0.75)",
	borderRadius: 3,
	padding: 2,
} satisfies MantineStyleProp;

export const BaseEntityDisplayItem = (props: {
	name?: string;
	altName?: string;
	progress?: string;
	isLoading: boolean;
	imageClassName?: string;
	highlightName?: boolean;
	highlightImage?: boolean;
	imageUrl?: string | null;
	innerRef?: Ref<HTMLDivElement>;
	labels?: { right?: ReactNode; left?: ReactNode };
	onImageClickBehavior: [string, (() => Promise<void>)?];
	imageOverlay?: {
		topRight?: ReactNode;
		topLeft?: ReactNode;
		bottomRight?: ReactNode;
		bottomLeft?: ReactNode;
	};
}) => {
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const gridPacking = userPreferences.general.gridPacking;
	const defaultOverlayProps = {
		pos: "absolute",
		style: { zIndex: 10, ...blackBgStyles },
	} as const;

	return (
		<Flex direction="column" ref={props.innerRef} justify="space-between">
			<Box pos="relative" w="100%">
				<Anchor
					component={Link}
					to={props.onImageClickBehavior[0]}
					onClick={props.onImageClickBehavior[1]}
				>
					<Tooltip
						position="top"
						label={props.name}
						disabled={(props.name?.length || 0) === 0}
					>
						<Paper
							radius="md"
							pos="relative"
							style={{ overflow: "hidden" }}
							className={clsx(props.imageClassName, {
								[classes.highlightImage]:
									coreDetails.isServerKeyValidated && props.highlightImage,
							})}
						>
							<Image
								src={props.imageUrl}
								alt={`Image for ${props.name}`}
								style={{
									cursor: "pointer",
									...match(gridPacking)
										.with(GridPacking.Normal, () => ({ height: 260 }))
										.with(GridPacking.Dense, () => ({ height: 180 }))
										.exhaustive(),
								}}
								styles={{
									root: {
										transitionProperty: "transform",
										transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
										transitionDuration: "150ms",
									},
								}}
								fallbackSrc={useFallbackImageUrl(
									props.isLoading
										? "Loading..."
										: props.name
											? getInitials(props.name)
											: undefined,
								)}
							/>
							{props.progress ? (
								<Paper
									h={5}
									bg="red"
									left={0}
									bottom={0}
									pos="absolute"
									w={`${props.progress}%`}
								/>
							) : null}
						</Paper>
					</Tooltip>
				</Anchor>
				{props.imageOverlay?.topLeft ? (
					<Center top={5} left={5} {...defaultOverlayProps}>
						{props.imageOverlay.topLeft}
					</Center>
				) : null}
				{props.imageOverlay?.topRight ? (
					<Center top={5} right={5} {...defaultOverlayProps}>
						{props.imageOverlay.topRight}
					</Center>
				) : null}
				{props.imageOverlay?.bottomLeft ? (
					<Center
						left={5}
						bottom={props.progress ? 8 : 5}
						{...defaultOverlayProps}
					>
						{props.imageOverlay.bottomLeft}
					</Center>
				) : null}
				{props.imageOverlay?.bottomRight ? (
					<Center
						right={5}
						bottom={props.progress ? 8 : 5}
						{...defaultOverlayProps}
					>
						{props.imageOverlay.bottomRight}
					</Center>
				) : null}
			</Box>
			{props.isLoading ? (
				<>
					<Skeleton height={22} mt={10} />
					<Skeleton height={22} mt={8} />
				</>
			) : (
				<Flex
					mt={2}
					w="100%"
					direction="column"
					px={match(gridPacking)
						.with(GridPacking.Normal, () => ({ base: 6, md: 3 }))
						.with(GridPacking.Dense, () => ({ md: 2 }))
						.exhaustive()}
				>
					<Flex w="100%" direction="row" justify="space-between">
						<Text
							size="sm"
							c="dimmed"
							visibleFrom={gridPacking === GridPacking.Dense ? "md" : undefined}
						>
							{props.labels?.left}
						</Text>
						<Text c="dimmed" size="sm">
							{props.labels?.right}
						</Text>
					</Flex>
					<Flex mb="xs" align="center" justify="space-between">
						<Text
							w="100%"
							truncate
							fw="bold"
							c={props.highlightName ? "yellow" : undefined}
						>
							{props.altName ?? props.name}
						</Text>
					</Flex>
				</Flex>
			)}
		</Flex>
	);
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

export * from "./filters";
export * from "./layout";
export * from "./review";
export * from "./summary";
