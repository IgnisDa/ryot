import type { NextPageWithLayout } from "../../_app";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { APP_ROUTES } from "@/lib/constants";
import { useUser } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Verb, getStringAsciiValue, getVerb } from "@/lib/utilities";
import {
	Accordion,
	ActionIcon,
	Alert,
	Anchor,
	Avatar,
	Badge,
	Box,
	Button,
	Collapse,
	Container,
	Flex,
	Group,
	Indicator,
	type MantineGradient,
	Modal,
	NumberInput,
	ScrollArea,
	Select,
	SimpleGrid,
	Slider,
	Stack,
	Tabs,
	Text,
	Title,
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	AddMediaToCollectionDocument,
	type AddMediaToCollectionMutationVariables,
	CollectionsDocument,
	DeleteSeenItemDocument,
	type DeleteSeenItemMutationVariables,
	DeployUpdateMetadataJobDocument,
	type DeployUpdateMetadataJobMutationVariables,
	MediaDetailsDocument,
	MergeMetadataDocument,
	type MergeMetadataMutationVariables,
	MetadataLot,
	MetadataSource,
	ProgressUpdateDocument,
	type ProgressUpdateMutationVariables,
	RemoveMediaFromCollectionDocument,
	type RemoveMediaFromCollectionMutationVariables,
	type ReviewItem,
	SeenState,
	ToggleMediaMonitorDocument,
	type ToggleMediaMonitorMutationVariables,
	UserMediaDetailsDocument,
	CreatorDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/utilities";
import {
	IconAlertCircle,
	IconBook,
	IconBrandPagekit,
	IconClock,
	IconDeviceTv,
	IconEdit,
	IconInfoCircle,
	IconMessageCircle2,
	IconPercentage,
	IconPlayerPlay,
	IconRotateClockwise,
	IconStarFilled,
	IconUser,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import { DateTime } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import { match } from "ts-pattern";
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
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

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
							{/* 
							<Tabs.Tab
								value="reviews"
								icon={<IconMessageCircle2 size="1rem" />}
							>
								Reviews
							</Tabs.Tab>
						*/}
						</Tabs.List>
						<Tabs.Panel value="media">
							<MediaScrollArea>
								<>Hello</>
							</MediaScrollArea>
						</Tabs.Panel>
						{/*
					<Tabs.Panel value="reviews">
							{userMediaDetails.data.reviews.length > 0 ? (
								<MediaScrollArea>
									<Stack>
										{userMediaDetails.data.reviews.map((r) => (
											<ReviewItem
												review={r}
												key={r.id}
												metadataId={creatorId}
											/>
										))}
									</Stack>
								</MediaScrollArea>
							) : (
								<Text fs="italic">No reviews posted</Text>
							)}
						</Tabs.Panel>
						*/}
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
