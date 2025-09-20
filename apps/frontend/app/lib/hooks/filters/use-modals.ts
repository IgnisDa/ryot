import { useDisclosure } from "@mantine/hooks";

export const useFilterModals = () => {
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [
		presetModalOpened,
		{ open: openPresetModal, close: closePresetModal },
	] = useDisclosure(false);

	return {
		filtersModal: {
			open: openFiltersModal,
			close: closeFiltersModal,
			opened: filtersModalOpened,
		},
		presetModal: {
			open: openPresetModal,
			close: closePresetModal,
			opened: presetModalOpened,
		},
	};
};
