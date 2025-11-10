import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { BulkDeleteDrawer } from "./bulk-delete-drawer";
import { UploadAssetsModal } from "./miscellaneous";
import { ReorderDrawer } from "./reorder";
import { DisplaySupersetModal } from "./supersets";
import { TimerAndStopwatchDrawer } from "./timer-and-stopwatch-drawer";
import type { FuncStartTimer } from "./types";

interface ModalsProps {
	stopTimer: () => void;
	timerDrawerOpened: boolean;
	startTimer: FuncStartTimer;
	openTimerDrawer: () => void;
	closeTimerDrawer: () => void;
	toggleTimerDrawer: () => void;
	pauseOrResumeTimer: () => void;
	bulkDeleteDrawerOpened: boolean;
	closeBulkDeleteDrawer: () => void;
	exerciseToDelete: string | null | undefined;
	assetsModalOpened: string | null | undefined;
	supersetWithExerciseIdentifier: string | null;
	isReorderDrawerOpened: string | null | undefined;
	setSupersetModalOpened: (value: string | null) => void;
	currentWorkoutExercises?: Array<{ identifier: string }>;
	setAssetsModalOpened: (value: string | null | undefined) => void;
	setIsReorderDrawerOpened: (value: string | null | undefined) => void;
}

export const WorkoutModals = (props: ModalsProps) => (
	<>
		<BulkDeleteDrawer
			opened={props.bulkDeleteDrawerOpened}
			onClose={props.closeBulkDeleteDrawer}
			exerciseToDelete={props.exerciseToDelete}
		/>
		<DisplaySupersetModal
			supersetWith={props.supersetWithExerciseIdentifier}
			onClose={() => props.setSupersetModalOpened(null)}
		/>
		<UploadAssetsModal
			modalOpenedBy={props.assetsModalOpened}
			closeModal={() => props.setAssetsModalOpened(undefined)}
		/>
		<ReorderDrawer
			exerciseToReorder={props.isReorderDrawerOpened}
			opened={props.isReorderDrawerOpened !== undefined}
			onClose={() => props.setIsReorderDrawerOpened(undefined)}
			key={props.currentWorkoutExercises?.map((e) => e.identifier).join(",")}
		/>
		<TimerAndStopwatchDrawer
			stopTimer={props.stopTimer}
			startTimer={props.startTimer}
			opened={props.timerDrawerOpened}
			onClose={props.closeTimerDrawer}
			pauseOrResumeTimer={props.pauseOrResumeTimer}
		/>
	</>
);

export function useWorkoutModals() {
	const [assetsModalOpened, setAssetsModalOpened] = useState<
		string | null | undefined
	>(undefined);
	const [
		timerDrawerOpened,
		{
			open: openTimerDrawer,
			close: closeTimerDrawer,
			toggle: toggleTimerDrawer,
		},
	] = useDisclosure(false);
	const [exerciseToDelete, setExerciseToDelete] = useState<string | null>();
	const [isReorderDrawerOpened, setIsReorderDrawerOpened] = useState<
		string | null
	>();
	const [supersetWithExerciseIdentifier, setSupersetModalOpened] = useState<
		string | null
	>(null);

	const openBulkDeleteDrawer = (exerciseIdentifier: string | null) => {
		setExerciseToDelete(exerciseIdentifier);
		if (!exerciseIdentifier) return;
		setTimeout(() => {
			setExerciseToDelete((val) => (val === undefined ? undefined : null));
		}, 4000);
	};

	const closeBulkDeleteDrawer = () => {
		setExerciseToDelete(undefined);
	};

	const openReorderDrawer = (exerciseIdentifier: string | null) => {
		setIsReorderDrawerOpened(exerciseIdentifier);
		if (!exerciseIdentifier) return;
		setTimeout(() => {
			setIsReorderDrawerOpened((val) => (val === undefined ? undefined : null));
		}, 4000);
	};

	return {
		openTimerDrawer,
		closeTimerDrawer,
		toggleTimerDrawer,
		assetsModalOpened,
		timerDrawerOpened,
		openReorderDrawer,
		setAssetsModalOpened,
		openBulkDeleteDrawer,
		closeBulkDeleteDrawer,
		exerciseToDelete,
		isReorderDrawerOpened,
		setSupersetModalOpened,
		setIsReorderDrawerOpened,
		supersetWithExerciseIdentifier,
		bulkDeleteDrawerOpened: exerciseToDelete !== undefined,
	};
}
