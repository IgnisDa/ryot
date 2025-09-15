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
} from "@mantine/core";
import { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import {
	IconDeviceTv,
	IconInfoCircle,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
	DisplayCollectionToEntity,
	EditButton,
	SkeletonLoader,
} from "~/components/common";
import { MediaDetailsLayout } from "~/components/common/layout";
import { ReviewItemDisplay } from "~/components/common/review";
import {
	MediaScrollArea,
	PartialMetadataDisplay,
} from "~/components/media/base-display";
import {
	MarkEntityAsPartialMenuItem,
	ToggleMediaMonitorMenuItem,
} from "~/components/media/menu-items";
import {
	useMetadataGroupDetails,
	useUserMetadataGroupDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { useAddEntityToCollections, useReviewEntity } from "~/lib/state/media";
import type { Route } from "./+types/_dashboard.media.groups.item.$id._index";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional().default("media"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { id: metadataGroupId } = parseParameters(
		params,
		z.object({ id: z.string() }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);

	return { query, metadataGroupId };
};

export const meta = () => {
	return [{ title: "Media Group Details | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();

	const [metadataGroupDetailsData, isMetadataGroupPartialStatusActive] =
		useMetadataGroupDetails(loaderData.metadataGroupId);
	const userMetadataGroupDetails = useUserMetadataGroupDetails(
		loaderData.metadataGroupId,
	);

	return (
		<Container>
			{metadataGroupDetailsData.data && userMetadataGroupDetails.data ? (
				<MediaDetailsLayout
					title={metadataGroupDetailsData.data.details.title}
					assets={metadataGroupDetailsData.data.details.assets}
					isPartialStatusActive={isMetadataGroupPartialStatusActive}
					externalLink={{
						lot: metadataGroupDetailsData.data.details.lot,
						source: metadataGroupDetailsData.data.details.source,
						href: metadataGroupDetailsData.data.details.sourceUrl,
					}}
				>
					<Flex id="group-details" wrap="wrap" gap={4}>
						<Text>
							{metadataGroupDetailsData.data.details.parts} media items
						</Text>
					</Flex>
					{userMetadataGroupDetails.data.collections.length > 0 ? (
						<Group>
							{userMetadataGroupDetails.data.collections.map((col) => (
								<DisplayCollectionToEntity
									col={col}
									key={col.id}
									entityLot={EntityLot.MetadataGroup}
									entityId={loaderData.metadataGroupId}
								/>
							))}
						</Group>
					) : null}
					<Tabs variant="outline" defaultValue={loaderData.query.defaultTab}>
						<Tabs.List mb="xs">
							<Tabs.Tab value="media" leftSection={<IconDeviceTv size={16} />}>
								Media
							</Tabs.Tab>
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
							{!userPreferences.general.disableReviews ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : null}
							<Tabs.Tab
								value="overview"
								leftSection={<IconInfoCircle size={16} />}
							>
								Overview
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="media">
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
									{metadataGroupDetailsData.data.contents.map((media) => (
										<PartialMetadataDisplay key={media} metadataId={media} />
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
											setEntityToReview({
												entityLot: EntityLot.MetadataGroup,
												entityId: loaderData.metadataGroupId,
												entityTitle:
													metadataGroupDetailsData.data.details.title,
											});
										}}
									>
										Post a review
									</Button>
									<Button
										variant="outline"
										onClick={() => {
											setAddEntityToCollectionsData({
												entityLot: EntityLot.MetadataGroup,
												entityId: loaderData.metadataGroupId,
											});
										}}
									>
										Add to collection
									</Button>
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">More actions</Button>
										</Menu.Target>
										<Menu.Dropdown>
											<ToggleMediaMonitorMenuItem
												inCollections={userMetadataGroupDetails.data.collections.map(
													(c) => c.details.collectionName,
												)}
												formValue={loaderData.metadataGroupId}
												entityLot={EntityLot.MetadataGroup}
											/>
											<MarkEntityAsPartialMenuItem
												entityLot={EntityLot.MetadataGroup}
												entityId={loaderData.metadataGroupId}
											/>
										</Menu.Dropdown>
									</Menu>
									{metadataGroupDetailsData.data && (
										<EditButton
											label="Edit group"
											editRouteType="groups"
											entityId={metadataGroupDetailsData.data.details.id}
											source={metadataGroupDetailsData.data.details.source}
											createdByUserId={
												metadataGroupDetailsData.data.details.createdByUserId
											}
										/>
									)}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						{!userPreferences.general.disableReviews ? (
							<Tabs.Panel value="reviews">
								<MediaScrollArea>
									{userMetadataGroupDetails.data.reviews.length > 0 ? (
										<Stack>
											{userMetadataGroupDetails.data.reviews.map((r) => (
												<ReviewItemDisplay
													review={r}
													key={r.id}
													entityLot={EntityLot.MetadataGroup}
													entityId={loaderData.metadataGroupId}
													title={metadataGroupDetailsData.data.details.title}
												/>
											))}
										</Stack>
									) : (
										<Text>No reviews</Text>
									)}
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
						<Tabs.Panel value="overview">
							{metadataGroupDetailsData.data.details.description ? (
								<div
									// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
									dangerouslySetInnerHTML={{
										__html: metadataGroupDetailsData.data.details.description,
									}}
								/>
							) : (
								<Text>No description</Text>
							)}
						</Tabs.Panel>
					</Tabs>
				</MediaDetailsLayout>
			) : (
				<SkeletonLoader />
			)}
		</Container>
	);
}
