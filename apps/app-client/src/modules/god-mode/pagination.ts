export const GOD_MODE_PAGE_SIZE = 50;

export const godModePageOffsets = (pageCount: number) =>
	Array.from({ length: pageCount }, (_, index) => index * GOD_MODE_PAGE_SIZE);

export const hasMoreGodModeUsers = (input: { total: number; offset: number; loaded: number }) =>
	input.offset + input.loaded < input.total;
