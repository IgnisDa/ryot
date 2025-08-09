import { Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import type { VideoGameSpecifics } from "@ryot/generated/graphql/backend/graphql";
import { dayjsLib } from "~/lib/shared/date-utils";

export function VideoGameSpecificsDisplay(props: {
	specifics?: VideoGameSpecifics | null;
}) {
	const platformReleases = props.specifics?.platformReleases;
	const timeToBeat = props.specifics?.timeToBeat;

	if (!platformReleases?.length && !timeToBeat) {
		return null;
	}

	return (
		<Stack gap="md">
			{timeToBeat &&
			(timeToBeat.hastily || timeToBeat.normally || timeToBeat.completely) ? (
				<Stack gap="sm">
					<Title order={4} ta="center">
						Time to beat
					</Title>
					<SimpleGrid cols={3}>
						{timeToBeat.hastily ? (
							<Paper p="xs" withBorder radius="md" ta="center">
								<Text fw={700} size="lg">
									{Math.round(timeToBeat.hastily / 3600)} H
								</Text>
								<Text c="dimmed" size="xs">
									Hastily
								</Text>
							</Paper>
						) : null}
						{timeToBeat.normally ? (
							<Paper p="xs" radius="md" withBorder ta="center">
								<Text fw={700} size="lg">
									{Math.round(timeToBeat.normally / 3600)} H
								</Text>
								<Text c="dimmed" size="xs">
									Normally
								</Text>
							</Paper>
						) : null}
						{timeToBeat.completely ? (
							<Paper p="xs" radius="md" withBorder ta="center">
								<Text fw={700} size="lg">
									{Math.round(timeToBeat.completely / 3600)} H
								</Text>
								<Text c="dimmed" size="xs">
									Completely
								</Text>
							</Paper>
						) : null}
					</SimpleGrid>
				</Stack>
			) : null}
			{platformReleases && platformReleases.length > 0 ? (
				<Table
					data={{
						head: ["Platform", "Release Date"],
						body: platformReleases.map((p) => [
							p.name,
							p.releaseDate ? dayjsLib(p.releaseDate).format("LL") : "Unknown",
						]),
					}}
				/>
			) : null}
		</Stack>
	);
}
