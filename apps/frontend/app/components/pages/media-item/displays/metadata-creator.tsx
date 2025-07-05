import { $path } from "safe-routes";
import { BaseEntityDisplay } from "~/components/media";

export const MetadataCreator = (props: {
	id?: string;
	name: string;
	image?: string | null;
	character?: string | null;
}) => {
	return (
		<BaseEntityDisplay
			image={props.image || undefined}
			title={`${props.name} ${props.character ? `as ${props.character}` : ""}`}
			link={
				props.id ? $path("/media/people/item/:id", { id: props.id }) : undefined
			}
		/>
	);
};
