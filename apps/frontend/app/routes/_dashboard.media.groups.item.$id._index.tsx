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
import { unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
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
import { z } from "zod";
import { zx } from "zodix";
import {
	DisplayCollection,
	MediaDetailsLayout,
	ReviewItemDisplay,
} from "~/components/common";
import {
	MediaScrollArea,
	PartialMetadataDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import { useUserPreferences } from "~/lib/hooks";
import { useAddEntityToCollection, useReviewEntity } from "~/lib/state/media";
import { serverGqlService } from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional().default("media"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { id: metadataGroupId } = zx.parseParams(params, { id: z.string() });
	const query = zx.parseQuery(request, searchParamsSchema);
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
	return {
		query,
		metadataGroupId,
		metadataGroupDetails,
		userMetadataGroupDetails,
	};
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.metadataGroupDetails.details.title} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();

	return (
		<Container>
			<MediaDetailsLayout
				images={loaderData.metadataGroupDetails.details.displayImages}
				entityDetails={{
					id: loaderData.metadataGroupId,
					lot: EntityLot.MetadataGroup,
					isPartial: loaderData.metadataGroupDetails.details.isPartial,
				}}
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
										setAddEntityToCollectionData({
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
				</Tabs>
			</MediaDetailsLayout>
		</Container>
	);
}
