import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
	PartialMetadataDisplay,
	ReviewItemDisplay,
} from "@/components/MediaComponents";
import MediaDetailsLayout from "@/components/MediaDetailsLayout";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Anchor,
	Avatar,
	Box,
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
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import {
	EntityLot,
	PersonDetailsDocument,
	UserPersonDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconDeviceTv,
	IconInfoCircle,
	IconMessageCircle2,
	IconPlayerPlay,
	IconUser,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const personId = parseInt(router.query.id?.toString() || "0");
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
	] = useDisclosure(false);

	const [activeTab, setActiveTab] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedActiveCreatorDetailsTab,
		getInitialValueInEffect: false,
		defaultValue: "media",
	});

	const userCreatorDetails = useQuery({
		queryKey: ["userCreatorDetails", personId],
		queryFn: async () => {
			const { userPersonDetails } = await gqlClient.request(
				UserPersonDetailsDocument,
				{ personId },
			);
			return userPersonDetails;
		},
		enabled: !!personId,
	});
	const creatorDetails = useQuery({
		queryKey: ["creatorDetails", personId],
		queryFn: async () => {
			const { personDetails } = await gqlClient.request(PersonDetailsDocument, {
				personId,
			});
			return personDetails;
		},
		staleTime: Infinity,
		enabled: !!personId,
	});

	return creatorDetails.data && userCreatorDetails.data ? (
		<>
			<Head>
				<title>{creatorDetails.data.details.name} | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					images={creatorDetails.data.details.displayImages}
					externalLink={{
						source: creatorDetails.data.details.source,
						href: creatorDetails.data.sourceUrl,
					}}
				>
					<Title id="creator-title">{creatorDetails.data.details.name}</Title>
					<Flex id="creator-details" wrap="wrap" gap={4}>
						<Text>
							{creatorDetails.data.contents.flatMap((c) => c.items).length}{" "}
							media items
						</Text>
						{creatorDetails.data.details.birthDate ? (
							<Text c="dimmed">
								• Birth: {creatorDetails.data.details.birthDate}
							</Text>
						) : undefined}
						{creatorDetails.data.details.deathDate ? (
							<Text c="dimmed">
								• Death: {creatorDetails.data.details.deathDate}
							</Text>
						) : undefined}
						{creatorDetails.data.details.place ? (
							<Text c="dimmed">• {creatorDetails.data.details.place}</Text>
						) : undefined}
						{creatorDetails.data.details.website ? (
							<>
								•
								<Anchor
									href={creatorDetails.data.details.website}
									target="_blank"
									rel="noopener noreferrer"
								>
									Website
								</Anchor>
							</>
						) : undefined}
						{creatorDetails.data.details.gender ? (
							<Text c="dimmed">• {creatorDetails.data.details.gender}</Text>
						) : undefined}
					</Flex>
					{userCreatorDetails.data &&
					userCreatorDetails.data.collections.length > 0 ? (
						<Group id="entity-collections">
							{userCreatorDetails.data.collections.map((col) => (
								<DisplayCollection
									col={col}
									entityId={personId.toString()}
									entityLot={EntityLot.Person}
									refetch={userCreatorDetails.refetch}
									key={col.id}
								/>
							))}
						</Group>
					) : undefined}
					<Tabs
						value={activeTab}
						onChange={(v) => {
							if (v) setActiveTab(v);
						}}
						variant="outline"
					>
						<Tabs.List mb="xs">
							<Tabs.Tab value="media" leftSection={<IconDeviceTv size={16} />}>
								Media
							</Tabs.Tab>
							{creatorDetails.data.details.description ? (
								<Tabs.Tab
									value="overview"
									leftSection={<IconInfoCircle size={16} />}
								>
									Overview
								</Tabs.Tab>
							) : undefined}
							{creatorDetails.data.workedOn.length > 0 ? (
								<Tabs.Tab
									value="workedOn"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Worked on
								</Tabs.Tab>
							) : undefined}
							{userCreatorDetails.data.reviews.length > 0 ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : undefined}
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="media">
							<MediaScrollArea>
								<Stack>
									{creatorDetails.data.contents.map((role) => (
										<Box key={role.name}>
											<Title order={3} mb="xs" ta="center">
												{role.name}
											</Title>
											<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
												{role.items.map((item) => (
													<Anchor
														key={item.metadataId}
														data-media-id={item.metadataId}
														component={Link}
														href={withQuery(
															APP_ROUTES.media.individualMediaItem.details,
															{ id: item.metadataId },
														)}
													>
														<Avatar
															imageProps={{ loading: "lazy" }}
															src={item.image}
															radius="sm"
															h={100}
															w={85}
															mx="auto"
															alt={`${item.title} picture`}
															styles={{ image: { objectPosition: "top" } }}
														/>
														<Text
															c="dimmed"
															size="xs"
															ta="center"
															lineClamp={1}
															mt={4}
														>
															{item.title}
														</Text>
													</Anchor>
												))}
											</SimpleGrid>
										</Box>
									))}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						{creatorDetails.data.details.description ? (
							<Tabs.Panel value="overview">
								<MediaScrollArea>
									<div
										// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
										dangerouslySetInnerHTML={{
											__html: creatorDetails.data.details.description,
										}}
									/>
								</MediaScrollArea>
							</Tabs.Panel>
						) : undefined}
						<Tabs.Panel value="workedOn">
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
									{creatorDetails.data.workedOn.map((media) => (
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
										component={Link}
										href={withQuery(APP_ROUTES.media.postReview, {
											personId,
										})}
									>
										Post a review
									</Button>
									<Button variant="outline" onClick={collectionModalOpen}>
										Add to collection
									</Button>
									<AddEntityToCollectionModal
										onClose={collectionModalClose}
										opened={collectionModalOpened}
										entityId={personId.toString()}
										refetchUserMedia={userCreatorDetails.refetch}
										entityLot={EntityLot.Person}
									/>
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="reviews">
							<MediaScrollArea>
								<Stack>
									{userCreatorDetails.data.reviews.map((r) => (
										<ReviewItemDisplay
											review={r}
											key={r.id}
											personId={personId}
											refetch={userCreatorDetails.refetch}
										/>
									))}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
