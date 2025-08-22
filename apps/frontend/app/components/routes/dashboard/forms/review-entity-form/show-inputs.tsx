import { Select, Stack } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import type { MetadataDetailsQuery } from "@ryot/generated/graphql/backend/graphql";
import type { ReviewFormValues } from "./helpers";

interface ShowInputsProps {
	form: UseFormReturnType<ReviewFormValues>;
	metadataDetails: MetadataDetailsQuery["metadataDetails"] | undefined;
}

export const ShowInputs = (props: ShowInputsProps) => {
	return (
		<Stack gap={4}>
			<Select
				size="xs"
				clearable
				searchable
				limit={50}
				label="Season"
				value={props.form.getValues().showSeasonNumberString}
				onChange={(v) => {
					props.form.setFieldValue("showSeasonNumberString", v || undefined);
					props.form.setFieldValue(
						"showSeasonNumber",
						v ? Number(v) : undefined,
					);
				}}
				data={props.metadataDetails?.showSpecifics?.seasons.map((s) => ({
					label: `${s.seasonNumber}. ${s.name.toString()}`,
					value: s.seasonNumber.toString(),
				}))}
			/>
			<Select
				size="xs"
				clearable
				searchable
				limit={50}
				label="Episode"
				value={props.form.getValues().showEpisodeNumberString}
				onChange={(v) => {
					props.form.setFieldValue("showEpisodeNumberString", v || undefined);
					props.form.setFieldValue(
						"showEpisodeNumber",
						v ? Number(v) : undefined,
					);
				}}
				data={
					props.metadataDetails?.showSpecifics?.seasons
						.find(
							(s) =>
								s.seasonNumber.toString() ===
								props.form.getValues().showSeasonNumberString,
						)
						?.episodes.map((e) => ({
							label: `${e.episodeNumber}. ${e.name.toString()}`,
							value: e.episodeNumber.toString(),
						})) || []
				}
			/>
		</Stack>
	);
};
