type S3StoredImage = { readonly type: "s3"; readonly key: string };
type RemoteStoredImage = { readonly type: "remote"; readonly url: string };

export type StoredEntityImage = S3StoredImage | RemoteStoredImage;
