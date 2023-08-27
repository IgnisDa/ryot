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
	Image,
	List,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
	CreatorDetailsDocument,
	ExerciseDetailsDocument,
	UserCreatorDetailsDocument,
	UserExerciseDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconDeviceTv,
	IconInfoCircle,
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
	const exerciseId = parseInt(router.query.id?.toString() || "0");

	const [activeTab, setActiveTab] = useLocalStorage({
		key: "savedActiveExerciseDetailsTab",
		getInitialValueInEffect: false,
		defaultValue: "overview",
	});

	const _userExerciseDetails = useQuery({
		queryKey: ["userExerciseDetails", exerciseId],
		queryFn: async () => {
			const { userExerciseDetails } = await gqlClient.request(
				UserExerciseDetailsDocument,
				{ exerciseId },
			);
			return userExerciseDetails;
		},
		staleTime: Infinity,
		enabled: !!exerciseId,
	});
	const exerciseDetails = useQuery({
		queryKey: ["creatorDetails", exerciseId],
		queryFn: async () => {
			const { exerciseDetails } = await gqlClient.request(
				ExerciseDetailsDocument,
				{ exerciseId },
			);
			return exerciseDetails;
		},
		staleTime: Infinity,
		enabled: !!exerciseId,
	});

	return exerciseDetails.data ? (
		<>
			<Head>
				<title>{exerciseDetails.data.name} | Ryot</title>
			</Head>
			<Container size="xs" px="lg">
				<Stack>
					<Title id="exercise-title">{exerciseDetails.data.name}</Title>
					<Tabs
						value={activeTab}
						onTabChange={(v) => {
							if (v) setActiveTab(v);
						}}
						variant="outline"
					>
						<Tabs.List mb={"xs"}>
							<Tabs.Tab value="overview" icon={<IconInfoCircle size="1rem" />}>
								Overview
							</Tabs.Tab>
							<Tabs.Tab value="history" icon={<IconUser size="1rem" />}>
								Actions
							</Tabs.Tab>
							<Tabs.Tab
								value="reviews"
								icon={<IconMessageCircle2 size="1rem" />}
							>
								Reviews
							</Tabs.Tab>
						</Tabs.List>

						<Tabs.Panel value="overview">
							<Stack>
								<Flex gap={6}>
									{exerciseDetails.data.attributes.images.map((i) => (
										<Image
											key={i}
											radius={"md"}
											src={i}
											imageProps={{ loading: "lazy" }}
										/>
									))}
								</Flex>
								<Text size="xl" fw="bold">
									Instructions
								</Text>
								<List type="ordered" spacing={"xs"}>
									{exerciseDetails.data.attributes.instructions.map((d) => (
										<List.Item key={d}>{d}</List.Item>
									))}
								</List>
							</Stack>
						</Tabs.Panel>
						{/*
						<Tabs.Panel value="actions">
							<MediaScrollArea>
								<SimpleGrid
									cols={1}
									spacing="lg"
									breakpoints={[{ minWidth: "md", cols: 2 }]}
								>
									<Link
										href={withQuery(APP_ROUTES.media.postReview, {
											creatorId: exerciseId,
										})}
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
							{userExerciseDetails.data.reviews.length > 0 ? (
								<MediaScrollArea>
									<Stack>
										{userExerciseDetails.data.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												creatorId={exerciseId}
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
				</Stack>
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
