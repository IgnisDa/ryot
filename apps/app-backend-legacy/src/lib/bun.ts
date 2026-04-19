type TemporaryDirectoryEnv = {
	TMP?: string;
	TEMP?: string;
	TMPDIR?: string;
};

const resolveBunTemporaryDirectoryEnv = (): TemporaryDirectoryEnv => ({
	TMP: Bun.env.TMP,
	TEMP: Bun.env.TEMP,
	TMPDIR: Bun.env.TMPDIR,
});

export const sha1Hex = (value: string) => {
	const hasher = new Bun.CryptoHasher("sha1");
	hasher.update(value);
	return hasher.digest("hex");
};

export const getTemporaryDirectory = (
	env: TemporaryDirectoryEnv = resolveBunTemporaryDirectoryEnv(),
) => {
	const temporaryDirectoryCandidates = [env.TMPDIR, env.TMP, env.TEMP];
	const temporaryDirectory = temporaryDirectoryCandidates.find(
		(value) => value && value.length > 0,
	);

	return temporaryDirectory ?? "/tmp";
};

export const joinTemporaryDirectoryPath = (temporaryDirectory: string, fileName: string) =>
	`${temporaryDirectory.replace(/[\\/]+$/, "")}/${fileName}`;
