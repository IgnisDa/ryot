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

export const WorkoutModals = ({
	stopTimer,
	startTimer,
	closeTimerDrawer,
	timerDrawerOpened,
	assetsModalOpened,
	pauseOrResumeTimer,
	setAssetsModalOpened,
	isReorderDrawerOpened,
	closeBulkDeleteDrawer,
	setSupersetModalOpened,
	bulkDeleteDrawerOpened,
	exerciseToDelete,
	currentWorkoutExercises,
	setIsReorderDrawerOpened,
	supersetWithExerciseIdentifier,
}: ModalsProps) => (
	<>
		<BulkDeleteDrawer
			opened={bulkDeleteDrawerOpened}
			onClose={closeBulkDeleteDrawer}
			exerciseToDelete={exerciseToDelete}
		/>
		<DisplaySupersetModal
			supersetWith={supersetWithExerciseIdentifier}
			onClose={() => setSupersetModalOpened(null)}
		/>
		<UploadAssetsModal
			modalOpenedBy={assetsModalOpened}
			closeModal={() => setAssetsModalOpened(undefined)}
		/>
		<ReorderDrawer
			exerciseToReorder={isReorderDrawerOpened}
			opened={isReorderDrawerOpened !== undefined}
			onClose={() => setIsReorderDrawerOpened(undefined)}
			key={currentWorkoutExercises?.map((e) => e.identifier).join(",")}
		/>
		<TimerAndStopwatchDrawer
			stopTimer={stopTimer}
			startTimer={startTimer}
			opened={timerDrawerOpened}
			onClose={closeTimerDrawer}
			pauseOrResumeTimer={pauseOrResumeTimer}
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
