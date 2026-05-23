import { S3Client } from "bun";

import { config } from "./config";

const createS3Config = () => {
	const { region, bucketName, accessKeyId, url: endpoint, secretAccessKey } = config.fileStorage;

	if (!endpoint || !bucketName || !accessKeyId || !secretAccessKey) {
		return null;
	}

	return {
		endpoint,
		accessKeyId,
		secretAccessKey,
		bucket: bucketName,
		...(region ? { region } : {}),
	};
};

const s3Config = createS3Config();

export const s3BucketName = config.fileStorage.bucketName ?? null;

export const s3 = s3Config ? new S3Client(s3Config) : null;
