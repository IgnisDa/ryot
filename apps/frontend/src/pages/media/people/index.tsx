import type { NextPageWithLayout } from "../../_app";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { MediaScrollArea, ReviewItemDisplay } from "@/lib/components/MediaItem";
import { APP_ROUTES } from "@/lib/constants";
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
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
	CreatorDetailsDocument,
	UserCreatorDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconDeviceTv,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { withQuery } from "ufo";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const creatorId = parseInt(router.query.id?.toString() || "0");

	const [activeTab, setActiveTab] = useLocalStorage({
		key: "savedActiveCreatorDetailsTab",
		getInitialValueInEffect: false,
		defaultValue: "media",
	});

	const userCreatorDetails = useQuery({
		queryKey: ["userCreatorDetails", creatorId],
		queryFn: async () => {
			const { userCreatorDetails } = await gqlClient.request(
				UserCreatorDetailsDocument,
				{ creatorId },
			);
			return userCreatorDetails;
		},
		staleTime: Infinity,
		enabled: !!creatorId,
	});
	const creatorDetails = useQuery({
		queryKey: ["creatorDetails", creatorId],
		queryFn: async () => {
			const { creatorDetails } = await gqlClient.request(
				CreatorDetailsDocument,
				{
					creatorId,
				},
			);
			return creatorDetails;
		},
		staleTime: Infinity,
		enabled: !!creatorId,
	});

	return creatorDetails.data && userCreatorDetails.data ? (
		<>
			<Head>
				<title>{creatorDetails.data.details.name} | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					posterImages={[creatorDetails.data.details.image]}
					backdropImages={[]}
				>
					<Title id="creator-title">{creatorDetails.data.details.name}</Title>
					<Flex id="creator-details" wrap={"wrap"} gap={4}>
						<Text>
							{creatorDetails.data.contents.flatMap((c) => c.items).length}{" "}
							media items
						</Text>
					</Flex>
					<Tabs
						value={activeTab}
						onTabChange={(v) => {
							if (v) setActiveTab(v);
						}}
						variant="outline"
					>
						<Tabs.List mb={"xs"}>
							<Tabs.Tab value="media" icon={<IconDeviceTv size="1rem" />}>
								Media
							</Tabs.Tab>
							<Tabs.Tab value="actions" icon={<IconUser size="1rem" />}>
								Actions
							</Tabs.Tab>
							<Tabs.Tab
								value="reviews"
								icon={<IconMessageCircle2 size="1rem" />}
							>
								Reviews
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="media">
							<MediaScrollArea>
								<Stack>
									{creatorDetails.data.contents.map((role) => (
										<Box key={role.name}>
											<Title order={3} mb="xs" align="center">
												{role.name}
											</Title>
											<SimpleGrid
												cols={3}
												breakpoints={[
													{ minWidth: "md", cols: 4 },
													{ minWidth: "lg", cols: 5 },
												]}
											>
												{role.items.map((item) => (
													<Link
														key={item.identifier}
														passHref
														legacyBehavior
														href={withQuery(
															APP_ROUTES.media.individualMediaItem.details,
															{ id: item.identifier },
														)}
													>
														<Anchor data-media-id={item.identifier}>
															<Avatar
																imageProps={{ loading: "lazy" }}
																src={item.image}
																h={100}
																w={85}
																mx="auto"
																alt={`${item.title} picture`}
																styles={{
																	image: { objectPosition: "top" },
																}}
															/>
															<Text
																color="dimmed"
																size="xs"
																align="center"
																lineClamp={1}
																mt={4}
															>
																{item.title}
															</Text>
														</Anchor>
													</Link>
												))}
											</SimpleGrid>
										</Box>
									))}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="actions">
							<MediaScrollArea>
								<SimpleGrid
									cols={1}
									spacing="lg"
									breakpoints={[{ minWidth: "md", cols: 2 }]}
								>
									<Link
										href={withQuery(APP_ROUTES.media.postReview, { creatorId })}
										passHref
										legacyBehavior
									>
										<Anchor>
											<Button variant="outline" w="100%">
												Post a review
											</Button>
										</Anchor>
									</Link>
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="reviews">
							{userCreatorDetails.data.reviews.length > 0 ? (
								<MediaScrollArea>
									<Stack>
										{userCreatorDetails.data.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												creatorId={creatorId}
											/>
										))}
									</Stack>
								</MediaScrollArea>
							) : (
								<Text fs="italic">No reviews posted</Text>
							)}
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
