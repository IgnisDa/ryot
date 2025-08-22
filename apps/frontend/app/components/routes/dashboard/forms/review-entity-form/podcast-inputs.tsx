import { Select } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import type { MetadataDetailsQuery } from "@ryot/generated/graphql/backend/graphql";
import type { ReviewFormValues } from "./helpers";

interface PodcastInputsProps {
	form: UseFormReturnType<ReviewFormValues>;
	metadataDetails: MetadataDetailsQuery["metadataDetails"] | undefined;
}

export const PodcastInputs = (props: PodcastInputsProps) => {
	return (
		<Select
			clearable
			limit={50}
			searchable
			label="Episode"
			value={props.form.getValues().podcastEpisodeNumberString}
			onChange={(v) => {
				props.form.setFieldValue("podcastEpisodeNumberString", v || undefined);
				props.form.setFieldValue(
					"podcastEpisodeNumber",
					v ? Number(v) : undefined,
				);
			}}
			data={props.metadataDetails?.podcastSpecifics?.episodes.map((se) => ({
				label: se.title.toString(),
				value: se.number.toString(),
			}))}
		/>
	);
};
