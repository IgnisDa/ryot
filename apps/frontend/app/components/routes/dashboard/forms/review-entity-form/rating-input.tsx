import {
	Flex,
	Group,
	Input,
	NumberInput,
	Rating,
	Stack,
	Text,
	ThemeIcon,
	rem,
} from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { UserReviewScale } from "@ryot/generated/graphql/backend/graphql";
import {
	IconMoodEmpty,
	IconMoodHappy,
	IconMoodSad,
	IconPercentage,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { match } from "ts-pattern";
import { ThreePointSmileyRating } from "~/lib/types";
import { convertThreePointSmileyToDecimal } from "../../utils";
import type { ReviewFormValues } from "./helpers";

interface RatingInputProps {
	form: UseFormReturnType<ReviewFormValues>;
	reviewScale: UserReviewScale;
}

const SmileySurround = (props: {
	children: ReactNode;
	smileyRating: ThreePointSmileyRating;
	form: UseFormReturnType<ReviewFormValues>;
}) => (
	<ThemeIcon
		size="xl"
		variant={
			props.smileyRating === props.form.getValues().ratingInThreePointSmiley
				? "outline"
				: "transparent"
		}
		onClick={() => {
			props.form.setFieldValue("ratingInThreePointSmiley", props.smileyRating);
			props.form.setFieldValue(
				"rating",
				convertThreePointSmileyToDecimal(props.smileyRating).toString(),
			);
		}}
	>
		{props.children}
	</ThemeIcon>
);

export const RatingInput = (props: RatingInputProps) => {
	return match(props.reviewScale)
		.with(UserReviewScale.OutOfFive, () => (
			<Flex gap="sm" mt="lg">
				<Input.Label>Rating:</Input.Label>
				<Rating
					fractions={2}
					value={
						props.form.getValues().rating
							? Number(props.form.getValues().rating)
							: undefined
					}
					onChange={(v) =>
						props.form.setFieldValue("rating", v ? v.toString() : undefined)
					}
				/>
			</Flex>
		))
		.with(UserReviewScale.OutOfHundred, () => (
			<NumberInput
				w="40%"
				min={0}
				step={1}
				max={100}
				hideControls
				label="Rating"
				rightSection={<IconPercentage size={16} />}
				value={
					props.form.getValues().rating
						? Number(props.form.getValues().rating)
						: undefined
				}
				onChange={(v) =>
					props.form.setFieldValue("rating", v ? v.toString() : undefined)
				}
			/>
		))
		.with(UserReviewScale.OutOfTen, () => (
			<NumberInput
				w="40%"
				min={0}
				max={10}
				step={0.1}
				hideControls
				label="Rating"
				rightSectionWidth={rem(60)}
				rightSection={
					<Text size="xs" c="dimmed">
						Out of 10
					</Text>
				}
				value={
					props.form.getValues().rating
						? Number(props.form.getValues().rating)
						: undefined
				}
				onChange={(v) =>
					props.form.setFieldValue("rating", v ? v.toString() : undefined)
				}
			/>
		))
		.with(UserReviewScale.ThreePointSmiley, () => (
			<Stack gap={4}>
				<Text size="xs" c="dimmed">
					How did it make you feel?
				</Text>
				<Group justify="space-around">
					<SmileySurround
						smileyRating={ThreePointSmileyRating.Happy}
						form={props.form}
					>
						<IconMoodHappy size={36} />
					</SmileySurround>
					<SmileySurround
						smileyRating={ThreePointSmileyRating.Neutral}
						form={props.form}
					>
						<IconMoodEmpty size={36} />
					</SmileySurround>
					<SmileySurround
						smileyRating={ThreePointSmileyRating.Sad}
						form={props.form}
					>
						<IconMoodSad size={36} />
					</SmileySurround>
				</Group>
			</Stack>
		))
		.exhaustive();
};
