import { Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import type { VideoGameSpecifics } from "@ryot/generated/graphql/backend/graphql";
import { dayjsLib } from "~/lib/shared/date-utils";

export function VideoGameSpecificsDisplay(props: {
	specifics?: VideoGameSpecifics | null;
}) {
	const platformReleases = props.specifics?.platformReleases;
	const timeToBeat = props.specifics?.timeToBeat;

	const hasTimeToBeatData =
		timeToBeat &&
		(timeToBeat.hastily || timeToBeat.normally || timeToBeat.completely);
	const hasPlatformReleases = platformReleases && platformReleases.length > 0;

	if (!hasPlatformReleases && !hasTimeToBeatData) return null;

	return (
		<Stack gap="md">
			{hasTimeToBeatData ? (
				<Stack gap="sm">
					<Title order={4} ta="center">
						Time to beat
					</Title>
					<SimpleGrid cols={3}>
						{[
							{ value: timeToBeat.hastily, label: "Hastily" },
							{ value: timeToBeat.normally, label: "Normally" },
							{ value: timeToBeat.completely, label: "Completely" },
						].map(({ value, label }) =>
							value ? (
								<Paper key={label} p="xs" withBorder radius="md" ta="center">
									<Text fw="bold" size="lg">
										{dayjsLib.duration(value, "seconds").format("H[H] m[M]")}
									</Text>
									<Text c="dimmed" size="xs">
										{label}
									</Text>
								</Paper>
							) : null,
						)}
					</SimpleGrid>
				</Stack>
			) : null}
			{hasPlatformReleases ? (
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
