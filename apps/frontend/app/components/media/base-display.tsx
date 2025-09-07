import { Anchor, Avatar, Box, ScrollArea, Text } from "@mantine/core";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { MEDIA_DETAILS_HEIGHT } from "~/lib/shared/constants";
import { useMetadataDetails, useUserMetadataDetails } from "~/lib/shared/hooks";

const WrapperComponent = (props: { link?: string; children: ReactNode }) =>
	props.link ? (
		<Anchor component={Link} to={props.link}>
			{props.children}
		</Anchor>
	) : (
		<Box>{props.children}</Box>
	);

export const BaseEntityDisplay = (props: {
	link?: string;
	image?: string;
	title?: string;
	extraText?: string;
	hasInteracted?: boolean;
	ref?: Ref<HTMLDivElement>;
}) => {
	return (
		<WrapperComponent link={props.link}>
			<Avatar
				w={85}
				h={100}
				mx="auto"
				radius="sm"
				ref={props.ref}
				src={props.image}
				name={props.title}
				imageProps={{ loading: "lazy" }}
				styles={{ image: { objectPosition: "top" } }}
			/>
			<Text
				mt={4}
				size="xs"
				ta="center"
				lineClamp={1}
				ref={props.ref}
				c={props.hasInteracted ? "yellow" : "dimmed"}
			>
				{props.title} {props.extraText}
			</Text>
		</WrapperComponent>
	);
};

export const PartialMetadataDisplay = (props: {
	metadataId: string;
	extraText?: string;
}) => {
	const { data: metadataDetails } = useMetadataDetails(props.metadataId);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);

	const images = [
		...(metadataDetails?.assets.remoteImages || []),
		...(metadataDetails?.assets.s3Images || []),
	];

	return (
		<BaseEntityDisplay
			image={images.at(0)}
			extraText={props.extraText}
			title={metadataDetails?.title || undefined}
			hasInteracted={userMetadataDetails?.hasInteracted}
			link={$path("/media/item/:id", { id: props.metadataId })}
		/>
	);
};

export const MediaScrollArea = (props: { children: ReactNode }) => {
	return (
		<ScrollArea.Autosize mah={MEDIA_DETAILS_HEIGHT}>
			{props.children}
		</ScrollArea.Autosize>
	);
};
