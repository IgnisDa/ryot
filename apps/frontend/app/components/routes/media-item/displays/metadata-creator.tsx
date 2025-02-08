import { useInViewport } from "@mantine/hooks";
import type { MetadataCreator } from "@ryot/generated/graphql/backend/graphql";
import { useMemo } from "react";
import { $path } from "safe-routes";
import { BaseEntityDisplay } from "~/components/media/base-display";
import { usePersonDetails } from "~/lib/shared/hooks";

export const MetadataCreatorDisplay = (props: { data: MetadataCreator }) => {
	const { ref, inViewport } = useInViewport();
	const [{ data: personDetails }, isPartialStatusActive] = usePersonDetails(
		props.data.idOrName,
		inViewport && !props.data.isFree,
	);

	const title = useMemo(() => {
		const name = personDetails?.details.name || props.data.idOrName;
		const character = props.data.character ? ` as ${props.data.character}` : "";
		return `${name}${character}`;
	}, [personDetails, props.data]);

	return (
		<BaseEntityDisplay
			ref={ref}
			title={title}
			isPartialStatusActive={isPartialStatusActive}
			image={personDetails?.details.assets.remoteImages.at(0)}
			link={
				props.data.isFree
					? undefined
					: $path("/media/people/item/:id", { id: props.data.idOrName })
			}
		/>
	);
};
