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
	assetsModalOpened: string | null | undefined;
	supersetWithExerciseIdentifier: string | null;
	isReorderDrawerOpened: string | null | undefined;
	setSupersetModalOpened: (value: string | null) => void;
	currentWorkoutExercises?: Array<{ identifier: string }>;
	setAssetsModalOpened: (value: string | null | undefined) => void;
	setIsReorderDrawerOpened: (value: string | null | undefined) => void;
}

export function WorkoutModals({
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
	currentWorkoutExercises,
	setIsReorderDrawerOpened,
	supersetWithExerciseIdentifier,
}: ModalsProps) {
	return (
		<>
			<UploadAssetsModal
				modalOpenedBy={assetsModalOpened}
				closeModal={() => setAssetsModalOpened(undefined)}
			/>
			<TimerAndStopwatchDrawer
				stopTimer={stopTimer}
				startTimer={startTimer}
				opened={timerDrawerOpened}
				onClose={closeTimerDrawer}
				pauseOrResumeTimer={pauseOrResumeTimer}
			/>
			<ReorderDrawer
				exerciseToReorder={isReorderDrawerOpened}
				opened={isReorderDrawerOpened !== undefined}
				onClose={() => setIsReorderDrawerOpened(undefined)}
				key={currentWorkoutExercises?.map((e) => e.identifier).join(",")}
			/>
			<DisplaySupersetModal
				supersetWith={supersetWithExerciseIdentifier}
				onClose={() => setSupersetModalOpened(null)}
			/>
			<BulkDeleteDrawer
				opened={bulkDeleteDrawerOpened}
				onClose={closeBulkDeleteDrawer}
			/>
		</>
	);
}

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
	const [
		bulkDeleteDrawerOpened,
		{ open: openBulkDeleteDrawer, close: closeBulkDeleteDrawer },
	] = useDisclosure(false);
	const [isReorderDrawerOpened, setIsReorderDrawerOpened] = useState<
		string | null
	>();
	const [supersetWithExerciseIdentifier, setSupersetModalOpened] = useState<
		string | null
	>(null);

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
		isReorderDrawerOpened,
		setSupersetModalOpened,
		openBulkDeleteDrawer,
		setIsReorderDrawerOpened,
		bulkDeleteDrawerOpened,
		closeBulkDeleteDrawer,
		supersetWithExerciseIdentifier,
	};
}
