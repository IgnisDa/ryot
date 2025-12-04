import { useInViewport } from "@mantine/hooks";
import type { MetadataCreator } from "@ryot/generated/graphql/backend/graphql";
import { useMemo } from "react";
import { $path } from "safe-routes";
import { BaseEntityDisplay } from "~/components/media/base-display";
import { usePersonDetails, useUserPersonDetails } from "~/lib/shared/hooks";

export const MetadataCreatorDisplay = (props: {
	data: MetadataCreator;
}) => {
	const { ref, inViewport } = useInViewport();
	const [{ data }, isPartialStatusActive] = usePersonDetails(
		props.data.idOrName,
		inViewport && !props.data.isFree,
	);
	const { data: userPersonDetails } = useUserPersonDetails(props.data.idOrName);

	const title = useMemo(() => {
		const name =
			userPersonDetails?.translatedDetails.title ||
			data?.details.name ||
			props.data.idOrName;
		const character = props.data.character ? ` as ${props.data.character}` : "";
		return `${name}${character}`;
	}, [data, props.data, userPersonDetails]);

	return (
		<BaseEntityDisplay
			ref={ref}
			title={title}
			isPartialStatusActive={isPartialStatusActive}
			image={data?.details.assets.remoteImages.at(0) || undefined}
			link={
				props.data.isFree
					? undefined
					: $path("/media/people/item/:id", { id: props.data.idOrName })
			}
		/>
	);
};
