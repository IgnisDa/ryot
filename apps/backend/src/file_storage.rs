use std::time::Duration;

use anyhow::{Context, Result};
use aws_sdk_s3::{presigning::PresigningConfig, primitives::ByteStream};

#[derive(Debug)]
pub struct FileStorageService {
    s3_client: aws_sdk_s3::Client,
    bucket_name: String,
}

impl FileStorageService {
    pub fn new(s3_client: aws_sdk_s3::Client, bucket_name: &str) -> Self {
        Self {
            s3_client: s3_client.clone(),
            bucket_name: bucket_name.to_owned(),
        }
    }

    pub async fn head_bucket(&self) -> bool {
        self.s3_client
            .head_bucket()
            .bucket(&self.bucket_name)
            .send()
            .await
            .is_err()
    }

    pub async fn get_presigned_url(&self, key: String) -> String {
        self.s3_client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .presigned(PresigningConfig::expires_in(Duration::from_secs(90 * 60)).unwrap())
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
