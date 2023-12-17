import { $path } from "@ignisda/remix-routes";
import {
	Button,
	Container,
	Flex,
	Group,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	EntityLot,
	MetadataGroupDetailsDocument,
	UserCollectionsListDocument,
	UserMetadataGroupDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconDeviceTv,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import invariant from "tiny-invariant";
import { MediaDetailsLayout } from "~/components/common";
import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
	PartialMetadataDisplay,
	ReviewItemDisplay,
} from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import {
	getCoreDetails,
	getUserDetails,
	getUserPreferences,
} from "~/lib/graphql.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const metadataGroupId = params.id ? Number(params.id) : null;
	invariant(metadataGroupId, "No ID provided");
	const [
		coreDetails,
		userPreferences,
		userDetails,
		{ metadataGroupDetails },
		{ userMetadataGroupDetails },
		{ userCollectionsList: collections },
	] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
		getUserDetails(request),
		gqlClient.request(MetadataGroupDetailsDocument, { metadataGroupId }),
		gqlClient.request(
			UserMetadataGroupDetailsDocument,
			{ metadataGroupId },
			await getAuthorizationHeader(request),
		),
		gqlClient.request(
			UserCollectionsListDocument,
			{},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
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

	return (
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
					<Group id="entity-collections">
						{loaderData.userMetadataGroupDetails.collections.map((col) => (
							<DisplayCollection
								key={col.id}
								col={col}
								entityId={loaderData.metadataGroupId.toString()}
								entityLot={EntityLot.MediaGroup}
							/>
						))}
					</Group>
				) : null}
				<Tabs variant="outline" defaultValue="media">
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
									component={Link}
									to={$path(
										"/media/:id/post-review",
										{ id: loaderData.metadataGroupId.toString() },
										{
											entityType: "metadataGroup",
											title: loaderData.metadataGroupDetails.details.title,
										},
									)}
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
									/>
								))}
							</Stack>
						</MediaScrollArea>
					</Tabs.Panel>
				</Tabs>
			</MediaDetailsLayout>
		</Container>
	);
}
