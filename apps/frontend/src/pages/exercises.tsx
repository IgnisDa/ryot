import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import { ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Alert,
	Button,
	Container,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	CollectionsDocument,
	DeleteCollectionDocument,
	type DeleteCollectionMutationVariables,
	RemoveMediaFromCollectionDocument,
	type RemoveMediaFromCollectionMutationVariables,
	ExercisesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconAlertCircle, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import type { ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const exercises = useQuery(["collections"], async () => {
		const { exercises } = await gqlClient.request(ExercisesDocument);
		return exercises;
	});

	return (
		<>
			<Head>
				<title>Exercises | Ryot</title>
			</Head>
			<Container>
				<Stack>
					{exercises.data && exercises.data.length > 0 ? (
						exercises.data.map((exercise) => (
							<Stack key={exercise.id}>
								<Text>{exercise.name}</Text>
								{exercise.attributes.images.length > 0 ? (
									<Grid listType="poster">
										{exercise.attributes.images.map((image) => (
											<img src={`data:image/jpeg;base64,${image}`} />
										))}
									</Grid>
								) : (
									<Text>No items in this collection</Text>
								)}
							</Stack>
						))
					) : (
						<Alert color="yellow" icon={<IconAlertCircle size="1rem" />}>
							You do not have any collections. You can create and add media to
							collections from a media's details page.
						</Alert>
					)}
				</Stack>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
