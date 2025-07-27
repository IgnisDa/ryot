use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use supporting_service::SupportingService;

mod operations;

pub use operations::*;

pub struct FileStorageService(pub Arc<SupportingService>);

impl FileStorageService {
    pub async fn is_enabled(&self) -> bool {
        operations::is_enabled(&self.0).await
    }

    pub async fn get_presigned_url(&self, key: String) -> Result<String> {
        operations::get_presigned_url(&self.0, key).await
    }

    pub async fn delete_object(&self, key: String) -> bool {
        operations::delete_object(&self.0, key).await
    }

    pub async fn get_presigned_put_url(
        &self,
        filename: String,
        prefix: String,
        with_uploads: bool,
        metadata: Option<HashMap<String, String>>,
    ) -> Result<(String, String)> {
        operations::get_presigned_put_url(&self.0, filename, prefix, with_uploads, metadata).await
    }

    pub async fn list_objects_at_prefix(&self, prefix: String) -> Result<Vec<(i64, String)>> {
        operations::list_objects_at_prefix(&self.0, prefix).await
    }

    pub async fn get_object_metadata(&self, key: String) -> Result<HashMap<String, String>> {
        operations::get_object_metadata(&self.0, key).await
    }
}
