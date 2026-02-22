import { clientSideFileUpload } from "./ui-utils";

export const uploadImages = async (
	files: File[],
	prefix: string,
): Promise<string[]> => {
	return Promise.all(files.map((f) => clientSideFileUpload(f, prefix)));
};

export const mergeImages = (
	existing: string[],
	uploaded: string[],
): string[] => {
	return Array.from(new Set([...(existing || []), ...uploaded]));
};

export const buildImageAssets = (s3Images: string[]) => ({
	s3Images,
	s3Videos: [],
	remoteImages: [],
	remoteVideos: [],
});
