use async_graphql::{Context, Object, Result};
use common_models::PresignedPutUrlResponse;
use file_storage_service::{delete_object, get_presigned_put_url, get_presigned_url};
use traits::GraphqlDependencyInjector;

#[derive(Default)]
pub struct FileStorageQueryResolver;

impl GraphqlDependencyInjector for FileStorageQueryResolver {}

#[Object]
impl FileStorageQueryResolver {
    /// Get a presigned URL (valid for 90 minutes) for a given key.
    async fn get_presigned_s3_url(&self, gql_ctx: &Context<'_>, key: String) -> Result<String> {
        let service = self.dependency(gql_ctx);
        Ok(get_presigned_url(service, key).await?)
    }
}

#[derive(Default)]
pub struct FileStorageMutationResolver;

impl GraphqlDependencyInjector for FileStorageMutationResolver {}

#[Object]
impl FileStorageMutationResolver {
    /// Get a presigned URL (valid for 10 minutes) for uploads under a prefix.
    async fn presigned_put_s3_url(
        &self,
        gql_ctx: &Context<'_>,
        prefix: String,
    ) -> Result<PresignedPutUrlResponse> {
        let service = self.dependency(gql_ctx);
        let (key, upload_url) = get_presigned_put_url(service, prefix, true, None).await?;
        Ok(PresignedPutUrlResponse { upload_url, key })
    }

    /// Delete an S3 object by the given key.
    async fn delete_s3_object(&self, gql_ctx: &Context<'_>, key: String) -> Result<bool> {
        let service = self.dependency(gql_ctx);
        Ok(delete_object(service, key).await?)
    }
}
