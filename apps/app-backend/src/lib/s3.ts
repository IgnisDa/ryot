import { S3Client } from "bun";
import { config } from "./config";

const createS3Config = () => {
	const endpoint = config.FILE_STORAGE_S3_URL;
	const bucketName = config.FILE_STORAGE_S3_BUCKET_NAME;
	const accessKeyId = config.FILE_STORAGE_S3_ACCESS_KEY_ID;
	const secretAccessKey = config.FILE_STORAGE_S3_SECRET_ACCESS_KEY;

	if (!endpoint || !bucketName || !accessKeyId || !secretAccessKey) return null;

	return {
		endpoint,
		accessKeyId,
		secretAccessKey,
		bucket: bucketName,
		...(config.FILE_STORAGE_S3_REGION
			? { region: config.FILE_STORAGE_S3_REGION }
			: {}),
	};
};

const s3Config = createS3Config();

export const s3BucketName = config.FILE_STORAGE_S3_BUCKET_NAME ?? null;

export const s3 = s3Config ? new S3Client(s3Config) : null;
