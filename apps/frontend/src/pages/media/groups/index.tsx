import { MediaScrollArea } from "@/lib/components/MediaComponents";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLotGradient } from "@/lib/utilities";
import {
	Anchor,
	Avatar,
	Badge,
	Container,
	Flex,
	SimpleGrid,
	Text,
	Title,
} from "@mantine/core";
import { MetadataGroupDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const metadataGroupId = parseInt(router.query.id?.toString() || "0");

	const groupDetails = useQuery({
		queryKey: ["groupDetails", metadataGroupId],
		queryFn: async () => {
			const { metadataGroupDetails } = await gqlClient.request(
				MetadataGroupDetailsDocument,
				{ metadataGroupId },
			);
			return metadataGroupDetails;
		},
		staleTime: Infinity,
		enabled: !!metadataGroupId,
	});

	return groupDetails.data ? (
		<>
			<Head>
				<title>{groupDetails.data.details.title} | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					posterImages={groupDetails.data.details.displayImages}
					backdropImages={[]}
					badge={
						<Badge
							variant="gradient"
							gradient={getLotGradient(groupDetails.data.details.lot)}
							size="lg"
						>
							<Text size={10}>{changeCase(groupDetails.data.details.lot)}</Text>
						</Badge>
					}
				>
					<Title id="group-title">{groupDetails.data.details.title}</Title>
					<Flex id="group-details" wrap={"wrap"} gap={4}>
						<Text>{groupDetails.data.details.parts} media items</Text>
					</Flex>
					<MediaScrollArea>
						<SimpleGrid
							cols={3}
							breakpoints={[
								{ minWidth: "md", cols: 4 },
								{ minWidth: "lg", cols: 5 },
							]}
						>
							{groupDetails.data.contents.map((media) => (
								<Link
									key={media.item.identifier}
									passHref
									legacyBehavior
									href={withQuery(
										APP_ROUTES.media.individualMediaItem.details,
										{ id: media.item.identifier },
									)}
								>
									<Anchor data-media-id={media.item.identifier}>
										<Avatar
											imageProps={{ loading: "lazy" }}
											src={media.item.image}
											h={100}
											w={85}
											mx="auto"
											alt={`${media.item.title} picture`}
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
											{media.item.title}
										</Text>
									</Anchor>
								</Link>
							))}
						</SimpleGrid>
					</MediaScrollArea>
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
