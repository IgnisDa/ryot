import { ActionIcon, Avatar, Box } from "@mantine/core";
import { GetPresignedS3UrlDocument } from "@ryot/generated/graphql/backend/graphql";
import { IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { clientGqlService, openConfirmationModal, queryFactory } from "~/lib/common";

export const AssetDisplay = (props: {
	s3Key: string;
	type: "video" | "image";
	removeAsset: () => void;
}) => {
	const srcUrlQuery = useQuery({
		queryKey: queryFactory.miscellaneous.presignedS3Url(props.s3Key).queryKey,
		queryFn: () =>
			clientGqlService
				.request(GetPresignedS3UrlDocument, { key: props.s3Key })
				.then((v) => v.getPresignedS3Url),
	});

	return (
		<Box pos="relative">
			{props.type === "video" ? (
				<Link to={srcUrlQuery.data ?? ""} target="_blank">
					<Avatar size="lg" name="Video" />
				</Link>
			) : (
				<Avatar src={srcUrlQuery.data} size="lg" />
			)}
			<ActionIcon
				top={0}
				size="xs"
				left={-12}
				color="red"
				pos="absolute"
				onClick={() => {
					openConfirmationModal(
						"Are you sure you want to remove this video?",
						() => props.removeAsset(),
					);
				}}
			>
				<IconTrash />
			</ActionIcon>
		</Box>
	);
};