import { $path } from "@ignisda/remix-routes";
import {
	Anchor,
	Avatar,
	Box,
	Button,
	Container,
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
	PersonDetailsDocument,
	UserCollectionsListDocument,
	UserPersonDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconDeviceTv,
	IconInfoCircle,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { useState } from "react";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { MediaDetailsLayout } from "~/components/common";
import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
	PostReview,
	PostReviewModal,
	ReviewItemDisplay,
} from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import {
	getCoreDetails,
	getUserDetails,
	getUserPreferences,
} from "~/lib/graphql.server";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional().default("media"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const personId = params.id ? Number(params.id) : null;
	invariant(personId, "No ID provided");
	const [
		coreDetails,
		userPreferences,
		userDetails,
		{ personDetails },
		{ userPersonDetails },
		{ userCollectionsList: collections },
	] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
		getUserDetails(request),
		gqlClient.request(PersonDetailsDocument, { personId }),
		gqlClient.request(
			UserPersonDetailsDocument,
			{ personId },
			await getAuthorizationHeader(request),
		),
		gqlClient.request(
			UserCollectionsListDocument,
			{},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		query,
		personId,
		userPreferences: { reviewScale: userPreferences.general.reviewScale },
		coreDetails: { itemDetailsHeight: coreDetails.itemDetailsHeight },
		userDetails,
		collections,
		userPersonDetails,
		personDetails,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).personDetails.details.name
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
				entityType="person"
				objectId={loaderData.personId}
				reviewScale={loaderData.userPreferences.reviewScale}
				title={loaderData.personDetails.details.name}
			/>
			<Container>
				<MediaDetailsLayout
					images={loaderData.personDetails.details.displayImages}
					externalLink={{
						source: loaderData.personDetails.details.source,
						href: loaderData.personDetails.sourceUrl,
					}}
				>
					<Title id="creator-title">
						{loaderData.personDetails.details.name}
					</Title>
					<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
						{[
							`${
								loaderData.personDetails.contents.flatMap((c) => c.items).length
							} media items`,
							loaderData.personDetails.details.birthDate &&
								`Birth: ${loaderData.personDetails.details.birthDate}`,
							loaderData.personDetails.details.deathDate &&
								`Death: ${loaderData.personDetails.details.deathDate}`,
							loaderData.personDetails.details.place &&
								loaderData.personDetails.details.place,
							loaderData.personDetails.details.gender,
						]
							.filter(Boolean)
							.join(" • ")}
						{loaderData.personDetails.details.website ? (
							<>
								{" "}
								•{" "}
								<Anchor
									href={loaderData.personDetails.details.website}
									target="_blank"
								>
									Website
								</Anchor>
							</>
						) : null}
					</Text>
					{loaderData.userPersonDetails.collections.length > 0 ? (
						<Group id="entity-collections">
							{loaderData.userPersonDetails.collections.map((col) => (
								<DisplayCollection
									col={col}
									entityId={loaderData.personId.toString()}
									entityLot={EntityLot.Person}
									key={col.id}
								/>
							))}
						</Group>
					) : null}
					<Tabs variant="outline" defaultValue={loaderData.query.defaultTab}>
						<Tabs.List mb="xs">
							<Tabs.Tab value="media" leftSection={<IconDeviceTv size={16} />}>
								Media
							</Tabs.Tab>
							{loaderData.personDetails.details.description ? (
								<Tabs.Tab
									value="overview"
									leftSection={<IconInfoCircle size={16} />}
								>
									Overview
								</Tabs.Tab>
							) : null}
							{loaderData.userPersonDetails.reviews.length > 0 ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : null}
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="media">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<Stack>
									{loaderData.personDetails.contents.map((role) => (
										<Box key={role.name}>
											<Title order={3} mb="xs" ta="center">
												{role.name}
											</Title>
											<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
												{role.items.map((item) => (
													<Anchor
														key={item.media.id}
														data-media-id={item.media.id}
														component={Link}
														to={$path("/media/item/:id", {
															id: item.media.id || "",
														})}
													>
														<Avatar
															imageProps={{ loading: "lazy" }}
															src={item.media.image}
															radius="sm"
															h={100}
															w={85}
															mx="auto"
															alt={item.media.title}
															styles={{ image: { objectPosition: "top" } }}
														/>
														<Text
															c="dimmed"
															size="xs"
															ta="center"
															lineClamp={2}
															mt={4}
														>
															{item.media.title}{" "}
															{item.character ? `as ${item.character}` : ""}
														</Text>
													</Anchor>
												))}
											</SimpleGrid>
										</Box>
									))}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						{loaderData.personDetails.details.description ? (
							<Tabs.Panel value="overview">
								<MediaScrollArea
									itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
								>
									<div
										// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
										dangerouslySetInnerHTML={{
											__html: loaderData.personDetails.details.description,
										}}
									/>
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
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
										entityId={loaderData.personId.toString()}
										entityLot={EntityLot.Person}
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
									{loaderData.userPersonDetails.reviews.map((r) => (
										<ReviewItemDisplay
											review={r}
											key={r.id}
											personId={loaderData.personId}
											title={loaderData.personDetails.details.name}
											user={loaderData.userDetails}
											reviewScale={loaderData.userPreferences.reviewScale}
											entityType="person"
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
