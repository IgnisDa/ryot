use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::PresignedPutUrlResponse;
use file_storage_service::FileStorageService;
use media_models::PresignedPutUrlInput;

#[derive(Default)]
pub struct FileStorageQuery;

#[Object]
impl FileStorageQuery {
    /// Get a presigned URL (valid for 90 minutes) for a given key.
    async fn get_presigned_s3_url(&self, gql_ctx: &Context<'_>, key: String) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<FileStorageService>>();
        let response = service.get_presigned_url(key).await?;
        Ok(response)
    }
}

#[derive(Default)]
pub struct FileStorageMutation;

#[Object]
impl FileStorageMutation {
    /// Get a presigned URL (valid for 10 minutes) for a given file name.
    async fn presigned_put_s3_url(
        &self,
        gql_ctx: &Context<'_>,
        input: PresignedPutUrlInput,
    ) -> Result<PresignedPutUrlResponse> {
        let service = gql_ctx.data_unchecked::<Arc<FileStorageService>>();
        let (key, upload_url) = service
            .get_presigned_put_url(input.file_name, input.prefix, true, None)
            .await?;
        Ok(PresignedPutUrlResponse { upload_url, key })
    }

    /// Delete an S3 object by the given key.
    async fn delete_s3_object(&self, gql_ctx: &Context<'_>, key: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FileStorageService>>();
        let response = service.delete_object(key).await?;
        Ok(response)
    }
}
