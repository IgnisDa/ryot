import { NumberInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import type { ReviewFormValues } from "./helpers";

interface AnimeInputsProps {
	form: UseFormReturnType<ReviewFormValues>;
}

export const AnimeInputs = (props: AnimeInputsProps) => {
	return (
		<NumberInput
			hideControls
			label="Episode"
			value={props.form.getValues().animeEpisodeNumber || undefined}
			onChange={(v) =>
				props.form.setFieldValue("animeEpisodeNumber", v as number)
			}
		/>
	);
};
