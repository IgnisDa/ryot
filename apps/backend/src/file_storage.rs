use anyhow::{Context, Result};
use aws_sdk_s3::{presigning::PresigningConfig, primitives::ByteStream};
use chrono::Duration;

use crate::utils::{get_app_config, get_global_service};

pub fn get_file_storage_service<'a>() -> &'a FileStorageService {
    &get_global_service().file_storage_service
}

#[derive(Debug)]
pub struct FileStorageService {
    s3_client: aws_sdk_s3::Client,
    bucket_name: String,
}

impl FileStorageService {
    pub fn new(s3_client: aws_sdk_s3::Client) -> Self {
        Self {
            s3_client,
            bucket_name: get_app_config().file_storage.s3_bucket_name.clone(),
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

    pub async fn get_presigned_url(&self, key: String) -> String {
        self.s3_client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .presigned(
                PresigningConfig::expires_in(Duration::minutes(90).to_std().unwrap()).unwrap(),
            )
            .await
            .unwrap()
            .uri()
            .to_string()
    }

    pub async fn upload_file(&self, key: &str, data: ByteStream) -> Result<()> {
        self.s3_client
            .put_object()
            .bucket(&self.bucket_name)
            .key(key)
            .body(data)
            .send()
            .await
            .context("Could not upload file")
            .map(|_| ())
    }
}
