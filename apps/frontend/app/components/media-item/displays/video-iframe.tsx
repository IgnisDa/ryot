import { Box } from "@mantine/core";
import { useDidUpdate, useInViewport } from "@mantine/hooks";
import { EntityRemoteVideoSource } from "@ryot/generated/graphql/backend/graphql";
import { useState } from "react";
import { match } from "ts-pattern";

export const VideoIframe = (props: {
	videoId: string;
	videoSource: EntityRemoteVideoSource;
}) => {
	const [isMounted, setIsMounted] = useState(false);
	const { ref, inViewport } = useInViewport();

	useDidUpdate(() => {
		if (inViewport) setIsMounted(true);
	}, [inViewport]);

	return (
		<Box ref={ref}>
			{isMounted ? (
				<iframe
					width="100%"
					height={200}
					src={
						match(props.videoSource)
							.with(
								EntityRemoteVideoSource.Youtube,
								() => "https://www.youtube.com/embed/",
							)
							.with(
								EntityRemoteVideoSource.Dailymotion,
								() => "https://www.dailymotion.com/embed/video/",
							)
							.exhaustive() + props.videoId
					}
					title="Video player"
					allowFullScreen
				/>
			) : null}
		</Box>
	);
};
