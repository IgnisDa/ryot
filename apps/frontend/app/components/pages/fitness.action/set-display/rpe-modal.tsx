import {
	Anchor,
	Button,
	Collapse,
	Group,
	Modal,
	NumberInput,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { isNumber } from "@ryot/ts-utils";
import { produce } from "immer";
import { useState } from "react";
import invariant from "tiny-invariant";
import { useCurrentWorkout } from "~/lib/state/fitness";

interface RpeModalProps {
	setIdx: number;
	opened: boolean;
	onClose: () => void;
	exerciseIdx: number;
	currentRpe?: number | null;
}

export const RpeModal = ({
	opened,
	setIdx,
	onClose,
	currentRpe,
	exerciseIdx,
}: RpeModalProps) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [isRpeDetailsOpen, setIsRpeDetailsOpen] = useState(false);

	invariant(currentWorkout);

	return (
		<Modal
			opened={opened}
			onClose={onClose}
			withCloseButton={false}
			title={
				<Group justify="space-between" gap="xl">
					<Text>Rate of Perceived Exertion</Text>
					<Button
						variant="outline"
						size="compact-xs"
						onClick={() => setIsRpeDetailsOpen(!isRpeDetailsOpen)}
					>
						{isRpeDetailsOpen ? "Hide" : "Show"} instructions
					</Button>
				</Group>
			}
		>
			<Stack>
				<Group>
					<NumberInput
						min={0}
						max={10}
						flex={1}
						value={currentRpe ?? undefined}
						onChange={(v) => {
							setCurrentWorkout(
								produce(currentWorkout, (draft) => {
									const value = isNumber(v) ? v : null;
									const currentSet = draft.exercises[exerciseIdx].sets[setIdx];
									currentSet.rpe = value;
								}),
							);
						}}
					/>
				</Group>
				<Button fullWidth variant="outline" onClick={onClose}>
					Done
				</Button>
				<Collapse in={isRpeDetailsOpen}>
					<Stack gap="xs">
						<Text size="xs">
							Your rate of perceived exertion (RPE) refers to how hard you think
							you're pushing yourself during exercise. It's subjective, which
							means that you decide how hard you feel you're working during
							physical activity.
							<Anchor
								ml={2}
								size="xs"
								target="_blank"
								href="https://my.clevelandclinic.org/health/articles/17450-rated-perceived-exertion-rpe-scale"
							>
								Source.
							</Anchor>
						</Text>
						<Table
							p={0}
							fz="xs"
							withRowBorders
							withTableBorder
							withColumnBorders
							data={{
								head: ["Rating", "Perceived Exertion Level"],
								body: [
									["0", "No exertion (at rest)"],
									["1", "Very light"],
									["2 to 3", "Light"],
									["4 to 5", "Moderate (somewhat hard)"],
									["6 to 7", "High (vigorous)"],
									["8 to 9", "Very hard"],
									["10", "Maximum effort (highest possible)"],
								],
							}}
						/>
					</Stack>
				</Collapse>
			</Stack>
		</Modal>
	);
};
