import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import {
	ActionIcon,
	Anchor,
	Badge,
	Box,
	Button,
	Flex,
	Image,
	Modal,
	NumberInput,
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
	useComputedColorScheme,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import { Form } from "@remix-run/react";
import {
	CollectionExtraInformationLot,
	type EntityLot,
	type MediaLot,
	type MediaSource,
	type UserCollectionsListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { formatDateToNaiveDate, groupBy, snakeCase } from "@ryot/ts-utils";
import { IconExternalLink, IconSearch, IconX } from "@tabler/icons-react";
import { Fragment, type ReactNode, useRef } from "react";
import { useState } from "react";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import events from "~/lib/events";
import { getFallbackImageUrl, redirectToQueryParam } from "~/lib/generals";
import { useSearchParam } from "~/lib/hooks";
import classes from "~/styles/common.module.css";

export const ApplicationGrid = (props: {
	children: ReactNode | Array<ReactNode>;
}) => {
	return (
		<SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="lg">
			{props.children}
		</SimpleGrid>
	);
};

function getSurroundingElements<T>(
	array: Array<T>,
	element: number,
): Array<number> {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (element === 0) return [lastIndex, element, element + 1];
	if (element === lastIndex) return [element - 1, element, 0];
	return [element - 1, element, element + 1];
}

export const MediaDetailsLayout = (props: {
	children: Array<ReactNode | (ReactNode | undefined)>;
	images: Array<string | null | undefined>;
	externalLink?: {
		source: MediaSource;
		lot?: MediaLot;
		href?: string | null;
	};
}) => {
	const [activeImageId, setActiveImageId] = useState(0);
	const colorScheme = useComputedColorScheme("dark");

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				id="images-container"
				pos="relative"
				className={classes.imagesContainer}
			>
				{props.images.length > 1 ? (
					<Carousel
						withIndicators={props.images.length > 1}
						w={300}
						onSlideChange={setActiveImageId}
					>
						{props.images.map((url, idx) => (
							<Carousel.Slide key={url} data-image-idx={idx}>
								{getSurroundingElements(props.images, activeImageId).includes(
									idx,
								) ? (
									<Image src={url} radius="lg" />
								) : null}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w={300}>
						<Image
							src={props.images[0]}
							height={400}
							radius="lg"
							fallbackSrc={getFallbackImageUrl(colorScheme)}
						/>
					</Box>
				)}
				{props.externalLink ? (
					<Badge
						id="data-source"
						pos="absolute"
						size="lg"
						top={10}
						left={10}
						color="dark"
						variant="filled"
					>
						<Flex gap={4} align="center">
							<Text size="10">
								{snakeCase(props.externalLink.source)}
								{props.externalLink.lot
									? `:${snakeCase(props.externalLink.lot)}`
									: null}
							</Text>
							{props.externalLink.href ? (
								<Anchor href={props.externalLink.href} target="_blank" mt={2}>
									<IconExternalLink size={12.8} />
								</Anchor>
							) : null}
						</Flex>
					</Badge>
				) : null}
			</Box>
			<Stack id="details-container" style={{ flexGrow: 1 }}>
				{props.children}
			</Stack>
		</Flex>
	);
};

type Collection = UserCollectionsListQuery["userCollectionsList"][number];

export const AddEntityToCollectionModal = (props: {
	userId: number;
	opened: boolean;
	onClose: () => void;
	entityId: string;
	entityLot: EntityLot;
	collections: Array<Collection>;
}) => {
	const selectData = Object.entries(
		groupBy(props.collections, (c) =>
			c.creatorUserId === props.userId ? "You" : c.creatorUsername,
		),
	).map(([g, items]) => ({
		group: g,
		items: items.map((c) => ({
			label: c.name,
			value: c.id.toString(),
		})),
	}));
	const [selectedCollection, setSelectedCollection] =
		useState<Collection | null>(null);
	const [ownedOn, setOwnedOn] = useState<Date | null>();

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form
				action="/actions?intent=addEntityToCollection"
				method="post"
				onSubmit={() => props.onClose()}
			>
				<input readOnly hidden name="entityId" value={props.entityId} />
				<input readOnly hidden name="entityLot" value={props.entityLot} />
				<HiddenLocationInput />
				<Stack>
					<Title order={3}>Select collection</Title>
					<Select
						searchable
						data={selectData}
						nothingFoundMessage="Nothing found..."
						value={selectedCollection?.id.toString()}
						onChange={(v) => {
							if (v) {
								const collection = props.collections.find(
									(c) => c.id === Number(v),
								);
								if (collection) setSelectedCollection(collection);
							}
						}}
					/>
					{selectedCollection ? (
						<>
							<input
								readOnly
								hidden
								name="collectionName"
								value={selectedCollection.name}
							/>
							<input
								readOnly
								hidden
								name="creatorUserId"
								value={selectedCollection.creatorUserId}
							/>
							{selectedCollection.informationTemplate?.map((template) => (
								<Fragment key={template.name}>
									{match(template.lot)
										.with(CollectionExtraInformationLot.String, () => (
											<TextInput
												name={`information.${template.name}`}
												label={template.name}
												description={template.description}
												required={!!template.required}
											/>
										))
										.with(CollectionExtraInformationLot.Number, () => (
											<NumberInput
												name={`information.${template.name}`}
												label={template.name}
												description={template.description}
												required={!!template.required}
											/>
										))
										.with(CollectionExtraInformationLot.Date, () => (
											<>
												<DateInput
													label={template.name}
													description={template.description}
													required={!!template.required}
													onChange={setOwnedOn}
													value={ownedOn}
												/>
												<input
													readOnly
													hidden
													name={`information.${template.name}`}
													value={
														ownedOn ? formatDateToNaiveDate(ownedOn) : undefined
													}
												/>
											</>
										))
										.with(CollectionExtraInformationLot.DateTime, () => (
											<DateTimePicker
												name={`information.${template.name}`}
												label={template.name}
												description={template.description}
												required={!!template.required}
											/>
										))
										.exhaustive()}
								</Fragment>
							))}
						</>
					) : null}
					<Button
						disabled={!selectedCollection}
						variant="outline"
						type="submit"
						onClick={() => events.addToCollection(props.entityLot)}
					>
						Set
					</Button>
					<Button variant="outline" color="red" onClick={props.onClose}>
						Cancel
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

export const HiddenLocationInput = () => {
	const value = withoutHost(
		typeof window !== "undefined" ? window.location.href : "",
	);

	return (
		<input type="hidden" name={redirectToQueryParam} value={value} readOnly />
	);
};

export const DebouncedSearchInput = (props: {
	initialValue?: string;
	queryParam?: string;
	placeholder?: string;
}) => {
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(
		props.initialValue || "",
		1000,
	);
	const [_, { setP }] = useSearchParam();

	useDidUpdate(
		() => setP(props.queryParam || "query", debouncedQuery),
		[debouncedQuery],
	);

	const ref = useRef<HTMLInputElement>(null);

	return (
		<TextInput
			ref={ref}
			name="query"
			placeholder={props.placeholder || "Search..."}
			leftSection={<IconSearch />}
			onChange={(e) => setDebouncedQuery(e.currentTarget.value)}
			defaultValue={debouncedQuery}
			style={{ flexGrow: 1 }}
			autoCapitalize="none"
			autoComplete="off"
			rightSection={
				debouncedQuery ? (
					<ActionIcon
						onClick={() => {
							if (ref.current) {
								ref.current.value = "";
								setDebouncedQuery("");
							}
						}}
					>
						<IconX size={16} />
					</ActionIcon>
				) : null
			}
		/>
	);
};
