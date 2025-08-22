import { Group, NumberInput, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import type { ReviewFormValues } from "./helpers";

interface MangaInputsProps {
	form: UseFormReturnType<ReviewFormValues>;
}

export const MangaInputs = (props: MangaInputsProps) => {
	return (
		<Group wrap="nowrap">
			<NumberInput
				hideControls
				label="Chapter"
				value={
					props.form.getValues().mangaChapterNumber
						? Number(props.form.getValues().mangaChapterNumber)
						: undefined
				}
				onChange={(v) =>
					props.form.setFieldValue("mangaChapterNumber", v?.toString())
				}
			/>
			<Text ta="center" fw="bold" mt="sm">
				OR
			</Text>
			<NumberInput
				hideControls
				label="Volume"
				value={props.form.getValues().mangaVolumeNumber || undefined}
				onChange={(v) =>
					props.form.setFieldValue("mangaVolumeNumber", v as number)
				}
			/>
		</Group>
	);
};
