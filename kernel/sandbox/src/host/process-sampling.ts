export const parseProcStatusRssBytes = (contents: string) => {
	const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(contents);
	return match?.[1] ? Number(match[1]) * 1024 : null;
};
