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
import { useLoaderData } from "@remix-run/react";
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
	MediaDetailsLayout,
} from "~/components/common";
import {
	DisplayCollection,
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
		userPreferences,
		userDetails,
		{ metadataGroupDetails },
		{ userMetadataGroupDetails },
		collections,
	] = await Promise.all([
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
		userPreferences: {
			reviewScale: userPreferences.general.reviewScale,
			disableReviews: userPreferences.general.disableReviews,
		},
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
	const [postReviewModalData, setPostReviewModalData] = useState<
		PostReview | undefined
	>(undefined);

	return (
		<>
			<PostReviewModal
				onClose={() => setPostReviewModalData(undefined)}
				opened={postReviewModalData !== undefined}
				data={postReviewModalData}
				entityType="metadataGroup"
				objectId={loaderData.metadataGroupId}
				reviewScale={loaderData.userPreferences.reviewScale}
				title={loaderData.metadataGroupDetails.details.title}
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
					{loaderData.userMetadataGroupDetails.collections.length > 0 ? (
						<Group>
							{loaderData.userMetadataGroupDetails.collections.map((col) => (
								<DisplayCollection
									key={col.id}
									col={col}
									userId={col.userId}
									entityId={loaderData.metadataGroupId.toString()}
									entityLot={EntityLot.MediaGroup}
								/>
							))}
						</Group>
					) : null}
					{loaderData.metadataGroupDetails.details.isPartial ? (
						<MediaIsPartial mediaType="group" />
					) : null}
					<Tabs variant="outline" defaultValue={loaderData.query.defaultTab}>
						<Tabs.List mb="xs">
							<Tabs.Tab value="media" leftSection={<IconDeviceTv size={16} />}>
								Media
							</Tabs.Tab>
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
							{!loaderData.userPreferences.disableReviews ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : null}
						</Tabs.List>
						<Tabs.Panel value="media">
							<MediaScrollArea>
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
							<MediaScrollArea>
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
										userId={loaderData.userDetails.id}
										onClose={collectionModalClose}
										opened={collectionModalOpened}
										entityId={loaderData.metadataGroupId.toString()}
										entityLot={EntityLot.MediaGroup}
										collections={loaderData.collections}
									/>
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">More actions</Button>
										</Menu.Target>
										<Menu.Dropdown>
											<ToggleMediaMonitorMenuItem
												userId={loaderData.userDetails.id}
												inCollections={loaderData.userMetadataGroupDetails.collections.map(
													(c) => c.name,
												)}
												formValue={loaderData.metadataGroupId}
												entityLot={EntityLot.MediaGroup}
											/>
										</Menu.Dropdown>
									</Menu>
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						{!loaderData.userPreferences.disableReviews ? (
							<Tabs.Panel value="reviews">
								<MediaScrollArea>
									{loaderData.userMetadataGroupDetails.reviews.length > 0 ? (
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
									) : (
										<Text>No reviews</Text>
									)}
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	);
}
