import { atom, useAtom } from "jotai";

const onboardingTourAtom = atom<boolean>(false);

export const useOnboardingTour = () => {
	const [isTourStarted, setIsTourStarted] = useAtom(onboardingTourAtom);
	return { isTourStarted, setIsTourStarted };
};
