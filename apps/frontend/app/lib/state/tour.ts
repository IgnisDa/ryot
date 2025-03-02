import { atom, useAtom } from "jotai";

const onboardingTourAtom = atom<true | null>(null);

export const useOnboardingTour = () => {
	const [tour, setTour] = useAtom(onboardingTourAtom);
	return { tour, setTour };
};
