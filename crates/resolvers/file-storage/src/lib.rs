use async_graphql::{Context, Object, Result};
use common_models::PresignedPutUrlResponse;
use file_storage_service::FileStorageService;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct FileStorageQueryResolver;

impl AuthProvider for FileStorageQueryResolver {}
impl GraphqlResolverSvc<FileStorageService> for FileStorageQueryResolver {}

#[Object]
impl FileStorageQueryResolver {
    /// Get a presigned URL (valid for 90 minutes) for a given key.
    async fn get_presigned_s3_url(&self, gql_ctx: &Context<'_>, key: String) -> Result<String> {
        let service = self.svc(gql_ctx);
        Ok(service.get_presigned_url(key).await?)
    }
}

#[derive(Default)]
pub struct FileStorageMutationResolver;

impl AuthProvider for FileStorageMutationResolver {}
impl GraphqlResolverSvc<FileStorageService> for FileStorageMutationResolver {}

#[Object]
impl FileStorageMutationResolver {
    /// Get a presigned URL (valid for 10 minutes) for uploads under a prefix.
    async fn presigned_put_s3_url(
        &self,
        gql_ctx: &Context<'_>,
        prefix: String,
    ) -> Result<PresignedPutUrlResponse> {
        let service = self.svc(gql_ctx);
        let (key, upload_url) = service.get_presigned_put_url(prefix, true, None).await?;
        Ok(PresignedPutUrlResponse { upload_url, key })
    }

    /// Delete an S3 object by the given key.
    async fn delete_s3_object(&self, gql_ctx: &Context<'_>, key: String) -> Result<bool> {
        let service = self.svc(gql_ctx);
        Ok(service.delete_object(key).await?)
    }
}
