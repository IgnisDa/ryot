import {
	Anchor,
	Box,
	Center,
	Flex,
	Image,
	type MantineStyleProp,
	Paper,
	Skeleton,
	Text,
	Tooltip,
} from "@mantine/core";
import { GridPacking } from "@ryot/generated/graphql/backend/graphql";
import { getInitials } from "@ryot/ts-utils";
import clsx from "clsx";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import { match } from "ts-pattern";
import {
	useCoreDetails,
	useFallbackImageUrl,
	useUserPreferences,
} from "~/lib/hooks";
import classes from "~/styles/common.module.css";

const blackBgStyles = {
	backgroundColor: "rgba(0, 0, 0, 0.75)",
	borderRadius: 3,
	padding: 2,
} satisfies MantineStyleProp;

export const BaseEntityDisplayItem = (props: {
	name?: string;
	altName?: string;
	progress?: string;
	isLoading: boolean;
	imageClassName?: string;
	highlightName?: boolean;
	highlightImage?: boolean;
	imageUrl?: string | null;
	innerRef?: Ref<HTMLDivElement>;
	labels?: { right?: ReactNode; left?: ReactNode };
	onImageClickBehavior: [string, (() => Promise<void>)?];
	imageOverlay?: {
		topRight?: ReactNode;
		topLeft?: ReactNode;
		bottomRight?: ReactNode;
		bottomLeft?: ReactNode;
	};
}) => {
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const gridPacking = userPreferences.general.gridPacking;
	const defaultOverlayProps = {
		pos: "absolute",
		style: { zIndex: 10, ...blackBgStyles },
	} as const;

	return (
		<Flex direction="column" ref={props.innerRef} justify="space-between">
			<Box pos="relative" w="100%">
				<Anchor
					component={Link}
					to={props.onImageClickBehavior[0]}
					onClick={props.onImageClickBehavior[1]}
				>
					<Tooltip
						position="top"
						label={props.name}
						disabled={(props.name?.length || 0) === 0}
					>
						<Paper
							radius="md"
							pos="relative"
							style={{ overflow: "hidden" }}
							className={clsx(props.imageClassName, {
								[classes.highlightImage]:
									coreDetails.isServerKeyValidated && props.highlightImage,
							})}
						>
							<Image
								src={props.imageUrl}
								alt={`Image for ${props.name}`}
								style={{
									cursor: "pointer",
									...match(gridPacking)
										.with(GridPacking.Normal, () => ({ height: 260 }))
										.with(GridPacking.Dense, () => ({ height: 180 }))
										.exhaustive(),
								}}
								styles={{
									root: {
										transitionProperty: "transform",
										transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
										transitionDuration: "150ms",
									},
								}}
								fallbackSrc={useFallbackImageUrl(
									props.isLoading
										? "Loading..."
										: props.name
											? getInitials(props.name)
											: undefined,
								)}
							/>
							{props.progress ? (
								<Paper
									h={5}
									bg="red"
									left={0}
									bottom={0}
									pos="absolute"
									w={`${props.progress}%`}
								/>
							) : null}
						</Paper>
					</Tooltip>
				</Anchor>
				{props.imageOverlay?.topLeft ? (
					<Center top={5} left={5} {...defaultOverlayProps}>
						{props.imageOverlay.topLeft}
					</Center>
				) : null}
				{props.imageOverlay?.topRight ? (
					<Center top={5} right={5} {...defaultOverlayProps}>
						{props.imageOverlay.topRight}
					</Center>
				) : null}
				{props.imageOverlay?.bottomLeft ? (
					<Center
						left={5}
						bottom={props.progress ? 8 : 5}
						{...defaultOverlayProps}
					>
						{props.imageOverlay.bottomLeft}
					</Center>
				) : null}
				{props.imageOverlay?.bottomRight ? (
					<Center
						right={5}
						bottom={props.progress ? 8 : 5}
						{...defaultOverlayProps}
					>
						{props.imageOverlay.bottomRight}
					</Center>
				) : null}
			</Box>
			{props.isLoading ? (
				<>
					<Skeleton height={22} mt={10} />
					<Skeleton height={22} mt={8} />
				</>
			) : (
				<Flex
					mt={2}
					w="100%"
					direction="column"
					px={match(gridPacking)
						.with(GridPacking.Normal, () => ({ base: 6, md: 3 }))
						.with(GridPacking.Dense, () => ({ md: 2 }))
						.exhaustive()}
				>
					<Flex w="100%" direction="row" justify="space-between">
						<Text
							size="sm"
							c="dimmed"
							visibleFrom={gridPacking === GridPacking.Dense ? "md" : undefined}
						>
							{props.labels?.left}
						</Text>
						<Text c="dimmed" size="sm">
							{props.labels?.right}
						</Text>
					</Flex>
					<Flex mb="xs" align="center" justify="space-between">
						<Text
							w="100%"
							truncate
							fw="bold"
							c={props.highlightName ? "yellow" : undefined}
						>
							{props.altName ?? props.name}
						</Text>
					</Flex>
				</Flex>
			)}
		</Flex>
	);
};
