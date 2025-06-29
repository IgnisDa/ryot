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
import {
	DeployUpdateMediaEntityJobDocument,
	EntityLot,
	MetadataGroupDetailsDocument,
	UserMetadataGroupDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
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
	DisplayCollection,
	MediaDetailsLayout,
	ReviewItemDisplay,
} from "~/components/common";
import {
	MarkEntityAsPartialMenuItem,
	MediaScrollArea,
	PartialMetadataDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import { clientGqlService } from "~/lib/common";
import { useUserPreferences } from "~/lib/hooks";
import { useAddEntityToCollections, useReviewEntity } from "~/lib/state/media";
import { serverGqlService } from "~/lib/utilities.server";
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
	const [{ metadataGroupDetails }, { userMetadataGroupDetails }] =
		await Promise.all([
			serverGqlService.request(MetadataGroupDetailsDocument, {
				metadataGroupId,
			}),
			serverGqlService.authenticatedRequest(
				request,
				UserMetadataGroupDetailsDocument,
				{ metadataGroupId },
			),
		]);
	if (metadataGroupDetails.details.isPartial)
		await serverGqlService.request(DeployUpdateMediaEntityJobDocument, {
			entityId: metadataGroupId,
			entityLot: EntityLot.MetadataGroup,
		});
	return {
		query,
		metadataGroupId,
		metadataGroupDetails,
		userMetadataGroupDetails,
	};
};

export const meta = ({ data }: Route.MetaArgs) => {
	return [{ title: `${data?.metadataGroupDetails.details.title} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();

	return (
		<Container>
			<MediaDetailsLayout
				title={loaderData.metadataGroupDetails.details.title}
				assets={loaderData.metadataGroupDetails.details.assets}
				externalLink={{
					lot: loaderData.metadataGroupDetails.details.lot,
					source: loaderData.metadataGroupDetails.details.source,
					href: loaderData.metadataGroupDetails.details.sourceUrl,
				}}
				partialDetailsFetcher={{
					entityId: loaderData.metadataGroupDetails.details.id,
					isAlreadyPartial: loaderData.metadataGroupDetails.details.isPartial,
					fn: () =>
						clientGqlService
							.request(MetadataGroupDetailsDocument, {
								metadataGroupId: loaderData.metadataGroupDetails.details.id,
							})
							.then((data) => data.metadataGroupDetails.details.isPartial),
				}}
			>
				<Flex id="group-details" wrap="wrap" gap={4}>
					<Text>
						{loaderData.metadataGroupDetails.details.parts} media items
					</Text>
				</Flex>
				{loaderData.userMetadataGroupDetails.collections.length > 0 ? (
					<Group>
						{loaderData.userMetadataGroupDetails.collections.map((col) => (
							<DisplayCollection
								col={col}
								key={col.id}
								creatorUserId={col.userId}
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
								{loaderData.metadataGroupDetails.contents.map((media) => (
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
											entityId: loaderData.metadataGroupId,
											entityLot: EntityLot.MetadataGroup,
											entityTitle:
												loaderData.metadataGroupDetails.details.title,
										});
									}}
								>
									Post a review
								</Button>
								<Button
									variant="outline"
									onClick={() => {
										setAddEntityToCollectionsData({
											entityId: loaderData.metadataGroupId,
											entityLot: EntityLot.MetadataGroup,
											alreadyInCollections:
												loaderData.userMetadataGroupDetails.collections.map(
													(c) => c.id,
												),
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
											inCollections={loaderData.userMetadataGroupDetails.collections.map(
												(c) => c.name,
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
							</SimpleGrid>
						</MediaScrollArea>
					</Tabs.Panel>
					{!userPreferences.general.disableReviews ? (
						<Tabs.Panel value="reviews">
							<MediaScrollArea>
								{loaderData.userMetadataGroupDetails.reviews.length > 0 ? (
									<Stack>
										{loaderData.userMetadataGroupDetails.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												entityId={loaderData.metadataGroupId}
												title={loaderData.metadataGroupDetails.details.title}
												entityLot={EntityLot.MetadataGroup}
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
						{loaderData.metadataGroupDetails.details.description ? (
							<div
								// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
								dangerouslySetInnerHTML={{
									__html: loaderData.metadataGroupDetails.details.description,
								}}
							/>
						) : (
							<Text>No description</Text>
						)}
					</Tabs.Panel>
				</Tabs>
			</MediaDetailsLayout>
		</Container>
	);
}
