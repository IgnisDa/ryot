import {
	Button,
	Container,
	Flex,
	Group,
	Menu,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	EntityLot,
	MetadataGroupDetailsDocument,
	UserMetadataGroupDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconDeviceTv,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { useState } from "react";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import {
	AddEntityToCollectionModal,
	HiddenLocationInput,
	MediaDetailsLayout,
} from "~/components/common";
import {
	CreateOwnershipModal,
	CreateReminderModal,
	DisplayCollection,
	DisplayMediaOwned,
	DisplayMediaReminder,
	MediaIsPartial,
	MediaScrollArea,
	PartialMetadataDisplay,
	type PostReview,
	PostReviewModal,
	ReviewItemDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import {
	getAuthorizationHeader,
	getCoreDetails,
	getUserCollectionsList,
	getUserDetails,
	getUserPreferences,
	gqlClient,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional().default("media"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const metadataGroupId = params.id ? Number(params.id) : null;
	invariant(metadataGroupId, "No ID provided");
	const [
		coreDetails,
		userPreferences,
		userDetails,
		{ metadataGroupDetails },
		{ userMetadataGroupDetails },
		collections,
	] = await Promise.all([
		getCoreDetails(request),
		getUserPreferences(request),
		getUserDetails(request),
		gqlClient.request(MetadataGroupDetailsDocument, { metadataGroupId }),
		gqlClient.request(
			UserMetadataGroupDetailsDocument,
			{ metadataGroupId },
			await getAuthorizationHeader(request),
		),
		getUserCollectionsList(request),
	]);
	return json({
		query,
		coreDetails: { itemDetailsHeight: coreDetails.itemDetailsHeight },
		userPreferences: { reviewScale: userPreferences.general.reviewScale },
		userDetails,
		collections,
		metadataGroupId,
		metadataGroupDetails,
		userMetadataGroupDetails,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).metadataGroupDetails.details.title
			} | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
	] = useDisclosure(false);
	const [
		mediaOwnershipModalOpened,
		{ open: mediaOwnershipModalOpen, close: mediaOwnershipModalClose },
	] = useDisclosure(false);
	const [postReviewModalData, setPostReviewModalData] = useState<
		PostReview | undefined
	>(undefined);
	const [
		createMediaReminderModalOpened,
		{
			open: createMediaReminderModalOpen,
			close: createMediaReminderModalClose,
		},
	] = useDisclosure(false);

	return (
		<>
			<CreateReminderModal
				onClose={createMediaReminderModalClose}
				opened={createMediaReminderModalOpened}
				defaultText={`Check out new releases in '${loaderData.metadataGroupDetails.details.title}'`}
				metadataGroupId={loaderData.metadataGroupId}
			/>
			<PostReviewModal
				onClose={() => setPostReviewModalData(undefined)}
				opened={postReviewModalData !== undefined}
				data={postReviewModalData}
				entityType="metadataGroup"
				objectId={loaderData.metadataGroupId}
				reviewScale={loaderData.userPreferences.reviewScale}
				title={loaderData.metadataGroupDetails.details.title}
			/>
			<CreateOwnershipModal
				onClose={mediaOwnershipModalClose}
				opened={mediaOwnershipModalOpened}
				metadataGroupId={loaderData.metadataGroupId}
			/>
			<Container>
				<MediaDetailsLayout
					images={loaderData.metadataGroupDetails.details.displayImages}
					externalLink={{
						source: loaderData.metadataGroupDetails.details.source,
						lot: loaderData.metadataGroupDetails.details.lot,
						href: loaderData.metadataGroupDetails.sourceUrl,
					}}
				>
					<Title id="group-title">
						{loaderData.metadataGroupDetails.details.title}
					</Title>
					<Flex id="group-details" wrap="wrap" gap={4}>
						<Text>
							{loaderData.metadataGroupDetails.details.parts} media items
						</Text>
					</Flex>
					<Group>
						{loaderData.userMetadataGroupDetails.collections.map((col) => (
							<DisplayCollection
								key={col.id}
								col={col}
								entityId={loaderData.metadataGroupId.toString()}
								entityLot={EntityLot.MediaGroup}
							/>
						))}
						{loaderData.userMetadataGroupDetails.ownership ? (
							<DisplayMediaOwned />
						) : null}
						{loaderData.metadataGroupDetails.details.isPartial ? (
							<MediaIsPartial mediaType="group" />
						) : null}
					</Group>
					{loaderData.userMetadataGroupDetails.reminder ? (
						<DisplayMediaReminder
							reminderData={loaderData.userMetadataGroupDetails.reminder}
						/>
					) : null}
					<Tabs variant="outline" defaultValue={loaderData.query.defaultTab}>
						<Tabs.List mb="xs">
							<Tabs.Tab value="media" leftSection={<IconDeviceTv size={16} />}>
								Media
							</Tabs.Tab>
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
							{loaderData.userMetadataGroupDetails.reviews.length > 0 ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : null}
						</Tabs.List>
						<Tabs.Panel value="media">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
									{loaderData.metadataGroupDetails.contents.map((media) => (
										<PartialMetadataDisplay
											key={media.identifier}
											media={media}
										/>
									))}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="actions">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
									<Button
										variant="outline"
										w="100%"
										onClick={() => {
											setPostReviewModalData({});
										}}
									>
										Post a review
									</Button>
									<Button variant="outline" onClick={collectionModalOpen}>
										Add to collection
									</Button>
									<AddEntityToCollectionModal
										onClose={collectionModalClose}
										opened={collectionModalOpened}
										entityId={loaderData.metadataGroupId.toString()}
										entityLot={EntityLot.MediaGroup}
										collections={loaderData.collections.map((c) => c.name)}
									/>
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">More actions</Button>
										</Menu.Target>
										<Menu.Dropdown>
											<ToggleMediaMonitorMenuItem
												inCollections={loaderData.userMetadataGroupDetails.collections.map(
													(c) => c.name,
												)}
												formValue={loaderData.metadataGroupId}
												entityLot={EntityLot.MediaGroup}
											/>
											{loaderData.userMetadataGroupDetails.ownership ? (
												<Form
													action="/actions?intent=toggleMediaOwnership"
													method="post"
													replace
												>
													<HiddenLocationInput />
													<Menu.Item
														type="submit"
														color="red"
														name="metadataGroupId"
														value={loaderData.metadataGroupId}
														onClick={(e) => {
															if (
																!confirm(
																	"Are you sure you want to remove ownership of this media?",
																)
															)
																e.preventDefault();
														}}
													>
														Remove ownership
													</Menu.Item>
												</Form>
											) : (
												<Menu.Item onClick={mediaOwnershipModalOpen}>
													Mark as owned
												</Menu.Item>
											)}
											{loaderData.userMetadataGroupDetails.reminder ? (
												<Form
													action="/actions?intent=deleteMediaReminder"
													method="post"
													replace
												>
													<input
														hidden
														name="metadataGroupId"
														value={loaderData.metadataGroupId}
														readOnly
													/>
													<HiddenLocationInput />
													<Menu.Item
														type="submit"
														color="red"
														onClick={(e) => {
															if (
																!confirm(
																	"Are you sure you want to delete this reminder?",
																)
															)
																e.preventDefault();
														}}
													>
														Remove reminder
													</Menu.Item>
												</Form>
											) : (
												<Menu.Item onClick={createMediaReminderModalOpen}>
													Create reminder
												</Menu.Item>
											)}
										</Menu.Dropdown>
									</Menu>
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="reviews">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<Stack>
									{loaderData.userMetadataGroupDetails.reviews.map((r) => (
										<ReviewItemDisplay
											review={r}
											key={r.id}
											metadataGroupId={loaderData.metadataGroupId}
											reviewScale={loaderData.userPreferences.reviewScale}
											user={loaderData.userDetails}
											title={loaderData.metadataGroupDetails.details.title}
											entityType="metadataGroup"
										/>
									))}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	);
}
