import { Anchor, Avatar, Box, ScrollArea, Text } from "@mantine/core";
import { useInViewport } from "@mantine/hooks";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { MEDIA_DETAILS_HEIGHT } from "~/lib/shared/constants";
import {
	useMetadataDetails,
	useS3PresignedUrls,
	useUserMetadataDetails,
} from "~/lib/shared/hooks";
import classes from "~/styles/common.module.css";

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
	isPartialStatusActive?: boolean;
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
				className={props.isPartialStatusActive ? classes.fadeInOut : undefined}
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
	const { ref, inViewport } = useInViewport();
	const [
		{ data: metadataDetails },
		isPartialStatusActive,
		metadataTranslations,
	] = useMetadataDetails(props.metadataId, inViewport);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
		inViewport,
	);

	const s3PresignedUrls = useS3PresignedUrls(metadataDetails?.assets.s3Images);
	const images = [
		...(metadataDetails?.assets.remoteImages || []),
		...(s3PresignedUrls.data || []),
	];

	return (
		<BaseEntityDisplay
			ref={ref}
			image={images.at(0)}
			extraText={props.extraText}
			isPartialStatusActive={isPartialStatusActive}
			hasInteracted={userMetadataDetails?.hasInteracted}
			link={$path("/media/item/:id", { id: props.metadataId })}
			title={metadataTranslations?.title || metadataDetails?.title || undefined}
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
