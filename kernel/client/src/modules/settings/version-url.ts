const repositoryUrl = "https://github.com/IgnisDa/ryot";

export const versionUrl = (version: string) => {
	if (/^v\d+\.\d+\.\d+$/.test(version)) {
		return `${repositoryUrl}/releases/tag/${version}`;
	}
	const commit = /(?:^|-g)([0-9a-f]{7,40})(?:-dirty)?$/.exec(version)?.[1];
	return commit === undefined ? undefined : `${repositoryUrl}/commit/${commit}`;
};
