import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import {
	DisplaySupersetModal,
	ReorderDrawer,
	TimerAndStopwatchDrawer,
	UploadAssetsModal,
} from "~/components/fitness.action";

interface ModalsProps {
	stopTimer: () => void;
	timerDrawerOpened: boolean;
	openTimerDrawer: () => void;
	closeTimerDrawer: () => void;
	toggleTimerDrawer: () => void;
	pauseOrResumeTimer: () => void;
	assetsModalOpened: string | null | undefined;
	supersetWithExerciseIdentifier: string | null;
	isReorderDrawerOpened: string | null | undefined;
	setSupersetModalOpened: (value: string | null) => void;
	currentWorkoutExercises?: Array<{ identifier: string }>;
	setAssetsModalOpened: (value: string | null | undefined) => void;
	setIsReorderDrawerOpened: (value: string | null | undefined) => void;
	startTimer: (
		duration: number,
		triggeredBy?: { exerciseIdentifier: string; setIdentifier: string },
	) => void;
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
	setSupersetModalOpened,
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
				key={currentWorkoutExercises?.map((e) => e.identifier).join(",")}
				exerciseToReorder={isReorderDrawerOpened}
				opened={isReorderDrawerOpened !== undefined}
				onClose={() => setIsReorderDrawerOpened(undefined)}
			/>
			<DisplaySupersetModal
				supersetWith={supersetWithExerciseIdentifier}
				onClose={() => setSupersetModalOpened(null)}
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
		setIsReorderDrawerOpened,
		supersetWithExerciseIdentifier,
	};
}
