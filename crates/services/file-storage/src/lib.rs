use std::collections::HashMap;

use anyhow::Result;
use aws_sdk_s3::{Client, presigning::PresigningConfig};
use chrono::Duration;
use nanoid::nanoid;

#[derive(Debug)]
pub struct FileStorageService {
    s3_client: Client,
    bucket_name: String,
}

impl FileStorageService {
    pub fn new(s3_client: Client, bucket_name: String) -> Self {
        Self {
            s3_client,
            bucket_name,
        }
    }

    pub async fn is_enabled(&self) -> bool {
        self.s3_client
            .head_bucket()
            .bucket(&self.bucket_name)
            .send()
            .await
            .is_ok()
    }

    pub async fn get_presigned_url(&self, key: String) -> Result<String> {
        let url = self
            .s3_client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .presigned(PresigningConfig::expires_in(
                Duration::minutes(90).to_std()?,
            )?)
            .await?
            .uri()
            .to_string();
        Ok(url)
    }

    pub async fn delete_object(&self, key: String) -> bool {
        self.s3_client
            .delete_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await
            .is_ok()
    }

    pub async fn get_presigned_put_url(
        &self,
        filename: String,
        prefix: String,
        with_uploads: bool,
        metadata: Option<HashMap<String, String>>,
    ) -> Result<(String, String)> {
        let first = if with_uploads { "uploads/" } else { "" };
        let key = format!("{}{}/{}-{}", first, prefix, nanoid!(10), filename);
        let url = self
            .s3_client
            .put_object()
            .bucket(&self.bucket_name)
            .key(&key)
            .set_metadata(metadata)
            .presigned(PresigningConfig::expires_in(
                Duration::minutes(10).to_std()?,
            )?)
            .await?
            .uri()
            .to_string();
        Ok((key, url))
    }

    pub async fn list_objects_at_prefix(&self, prefix: String) -> Result<Vec<(i64, String)>> {
        let items = self
            .s3_client
            .list_objects_v2()
            .bucket(&self.bucket_name)
            .prefix(prefix)
            .send()
            .await?
            .contents
            .unwrap_or_default()
            .into_iter()
            .map(|o| (o.size.unwrap_or_default(), o.key.unwrap()))
            .collect();
        Ok(items)
    }

    pub async fn get_object_metadata(&self, key: String) -> Result<HashMap<String, String>> {
        let meta = self
            .s3_client
            .head_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await?
            .metadata
            .unwrap_or_default();
        Ok(meta)
    }
}
