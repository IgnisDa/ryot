import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	Anchor,
	Avatar,
	Box,
	Flex,
	Group,
	Indicator,
	Stack,
	Text,
} from "@mantine/core";
import { humanizeDuration } from "@ryot/ts-utils";
import type { ReactNode } from "react";
import { dayjsLib } from "~/lib/common";

export const DisplaySeasonOrEpisodeDetails = (props: {
	name: string;
	children: ReactNode;
	runtime?: number | null;
	endDate?: string | null;
	overview?: string | null;
	displayIndicator: number;
	onNameClick?: () => void;
	startDate?: string | null;
	id?: number | string | null;
	numEpisodes?: number | null;
	posterImages: Array<string>;
	publishDate?: string | null;
}) => {
	const [parent] = useAutoAnimate();
	const filteredElements = [
		props.runtime
			? humanizeDuration(
					dayjsLib.duration(props.runtime, "minutes").asMilliseconds(),
					{ units: ["h", "m"] },
				)
			: null,
		props.publishDate ? dayjsLib(props.publishDate).format("ll") : null,
		props.numEpisodes ? `${props.numEpisodes} episodes` : null,
		props.startDate && props.endDate
			? `${dayjsLib(props.startDate).format("MM/YYYY")} to ${dayjsLib(
					props.endDate,
				).format("MM/YYYY")}`
			: null,
	].filter((s) => s !== null);
	const display =
		filteredElements.length > 0
			? filteredElements
					.map<ReactNode>((s, i) => (
						<Text size="xs" key={i.toString()} c="dimmed">
							{s}
						</Text>
					))
					.reduce((prev, curr) => [prev, " • ", curr])
			: null;

	const isSeen = props.displayIndicator >= 1;

	const DisplayDetails = () => (
		<>
			{props.onNameClick ? (
				<Anchor onClick={props.onNameClick} lineClamp={2} display="inline">
					{props.name}
				</Anchor>
			) : (
				<Text lineClamp={2}>{props.name}</Text>
			)}
			{display ? (
				<Flex align="center" gap={4}>
					{display}
				</Flex>
			) : null}
		</>
	);

	return (
		<Stack data-episode-id={props.id} ref={parent}>
			<Flex align="center" gap="sm" justify={{ md: "space-between" }}>
				<Group wrap="nowrap">
					<Indicator
						size={16}
						offset={7}
						color="cyan"
						disabled={!isSeen}
						position="bottom-end"
						style={{ zIndex: 0 }}
						label={
							props.displayIndicator === 1
								? "Seen"
								: `Seen × ${props.displayIndicator}`
						}
					>
						<Avatar
							size="lg"
							radius="xl"
							name={props.name}
							src={props.posterImages[0]}
							imageProps={{ loading: "lazy" }}
						/>
					</Indicator>
					<Box visibleFrom="md" ml="sm">
						<DisplayDetails />
					</Box>
				</Group>
				<Box flex={0} ml={{ base: "md", md: 0 }}>
					{props.children}
				</Box>
			</Flex>
			<Box hiddenFrom="md">
				<DisplayDetails />
			</Box>
			{props.overview ? (
				<Text
					size="sm"
					c="dimmed"
					lineClamp={5}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
					dangerouslySetInnerHTML={{ __html: props.overview }}
				/>
			) : null}
		</Stack>
	);
};
