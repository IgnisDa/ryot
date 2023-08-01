import type { NextPageWithLayout } from "../../_app";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Anchor,
	Avatar,
	Box,
	Container,
	Flex,
	ScrollArea,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { CreatorDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { IconDeviceTv, IconMessageCircle2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { withQuery } from "ufo";

const MediaScrollArea = ({
	children,
}: {
	children: JSX.Element;
}) => {
	return <ScrollArea.Autosize mah={300}>{children}</ScrollArea.Autosize>;
};

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const creatorId = parseInt(router.query.id?.toString() || "0");

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

	return creatorDetails.data ? (
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
					<Tabs defaultValue={"media"} variant="outline">
						<Tabs.List mb={"xs"}>
							<Tabs.Tab value="media" icon={<IconDeviceTv size="1rem" />}>
								Media
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
											<Title order={3} align="center">
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
																color="white"
																size="xs"
																align="center"
																lineClamp={1}
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
						<Tabs.Panel value="reviews">
							{/* TODO */}
							<Text>This is still WIP.</Text>
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
