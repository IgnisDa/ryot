import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

type OpenedSidebarLinks = {
	media: boolean;
	fitness: boolean;
	settings: boolean;
	collection: boolean;
};

export const defaultSidebarLinksState: OpenedSidebarLinks = {
	media: false,
	fitness: false,
	settings: false,
	collection: false,
};

const openedSidebarLinksAtom = atomWithStorage<OpenedSidebarLinks>(
	"OpenedSidebarLinks",
	defaultSidebarLinksState,
);

export const useOpenedSidebarLinks = () => {
	const [openedSidebarLinks, setOpenedSidebarLinks] = useAtom(
		openedSidebarLinksAtom,
	);
	return { openedSidebarLinks, setOpenedSidebarLinks };
};

type FullscreenImageData = { src: string };

const fullscreenImageAtom = atom<FullscreenImageData | null>(null);

export const useFullscreenImage = () => {
	const [fullscreenImage, setFullscreenImage] = useAtom(fullscreenImageAtom);
	return { fullscreenImage, setFullscreenImage };
};
