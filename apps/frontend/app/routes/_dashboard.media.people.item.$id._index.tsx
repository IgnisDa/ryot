import { $path } from "@ignisda/remix-routes";
import {
	Anchor,
	Avatar,
	Box,
	Button,
	Container,
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
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import {
	DeployUpdatePersonJobDocument,
	EntityLot,
	PersonDetailsDocument,
	UserPersonDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconDeviceTv,
	IconInfoCircle,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { useState } from "react";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import {
	AddEntityToCollectionModal,
	HiddenLocationInput,
	MediaDetailsLayout,
} from "~/components/common";
import {
	CreateReminderModal,
	DisplayCollection,
	DisplayMediaReminder,
	MediaIsPartial,
	MediaScrollArea,
	type PostReview,
	PostReviewModal,
	ReviewItemDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getCoreDetails,
	getUserCollectionsList,
	getUserDetails,
	getUserPreferences,
	gqlClient,
	processSubmission,
} from "~/lib/utilities.server";

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
		collections,
	] = await Promise.all([
		getCoreDetails(request),
		getUserPreferences(request),
		getUserDetails(request),
		gqlClient.request(PersonDetailsDocument, { personId }),
		gqlClient.request(
			UserPersonDetailsDocument,
			{ personId },
			await getAuthorizationHeader(request),
		),
		getUserCollectionsList(request),
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

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		deployUpdatePersonJob: async () => {
			const submission = processSubmission(formData, personIdSchema);
			await gqlClient.request(
				DeployUpdatePersonJobDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Metadata person job deployed successfully",
				}),
			});
		},
	});
};

const personIdSchema = z.object({ personId: zx.IntAsString });

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
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
				defaultText={`Check out new releases by '${loaderData.personDetails.details.name}'`}
				personId={loaderData.personId}
			/>
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
					<Group>
						{loaderData.userPersonDetails.collections.map((col) => (
							<DisplayCollection
								col={col}
								entityId={loaderData.personId.toString()}
								entityLot={EntityLot.Person}
								key={col.id}
							/>
						))}
						{loaderData.personDetails.details.isPartial ? (
							<MediaIsPartial mediaType="person" />
						) : null}
					</Group>
					{loaderData.userPersonDetails.reminder ? (
						<DisplayMediaReminder
							reminderData={loaderData.userPersonDetails.reminder}
						/>
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
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">More actions</Button>
										</Menu.Target>
										<Menu.Dropdown>
											<ToggleMediaMonitorMenuItem
												inCollections={loaderData.userPersonDetails.collections.map(
													(c) => c.name,
												)}
												formValue={loaderData.personId}
												entityLot={EntityLot.Person}
											/>
											{loaderData.userPersonDetails.reminder ? (
												<Form
													action="/actions?intent=deleteMediaReminder"
													method="post"
													replace
												>
													<input
														hidden
														name="personId"
														value={loaderData.personId}
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
											<Form
												action="?intent=deployUpdatePersonJob"
												method="post"
												replace
											>
												<Menu.Item
													type="submit"
													name="personId"
													value={loaderData.personId}
												>
													Update person
												</Menu.Item>
											</Form>
										</Menu.Dropdown>
									</Menu>
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
