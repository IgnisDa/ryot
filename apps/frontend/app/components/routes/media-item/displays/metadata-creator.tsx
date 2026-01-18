import { useInViewport } from "@mantine/hooks";
import {
	EntityTranslationVariant,
	type MetadataCreator,
} from "@ryot/generated/graphql/backend/graphql";
import { useMemo } from "react";
import { $path } from "safe-routes";
import { BaseEntityDisplay } from "~/components/media/base-display";
import { usePersonDetails } from "~/lib/shared/hooks";

export const MetadataCreatorDisplay = (props: { data: MetadataCreator }) => {
	const { ref, inViewport } = useInViewport();
	const [{ data: personDetails }, usePersonTranslationValue] = usePersonDetails(
		props.data.idOrName,
		inViewport && !props.data.isFree,
	);

	const personTitleTranslation = usePersonTranslationValue({
		variant: EntityTranslationVariant.Title,
		enabled: inViewport && !props.data.isFree,
	});

	const personImageTranslation = usePersonTranslationValue({
		variant: EntityTranslationVariant.Image,
		enabled: inViewport && !props.data.isFree,
	});

	const title = useMemo(() => {
		const name =
			personTitleTranslation ||
			personDetails?.details.name ||
			props.data.idOrName;
		const character = props.data.character ? ` as ${props.data.character}` : "";
		return `${name}${character}`;
	}, [personDetails, props.data, personTitleTranslation]);

	return (
		<BaseEntityDisplay
			ref={ref}
			title={title}
			image={
				personImageTranslation ||
				personDetails?.details.assets.remoteImages.at(0) ||
				undefined
			}
			link={
				props.data.isFree
					? undefined
					: $path("/media/people/item/:id", { id: props.data.idOrName })
			}
		/>
	);
};
