use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use aws_sdk_s3::{
    Client, Config,
    config::{Credentials, Region},
    presigning::PresigningConfig,
};
use chrono::Duration;
use common_utils::PROJECT_NAME;
use config_definition::AppConfig;
use nanoid::nanoid;
use supporting_service::SupportingService;

fn get_client_and_bucket_name(config: &Arc<AppConfig>) -> (Client, String) {
    let mut aws_conf = Config::builder()
        .region(Region::new(config.file_storage.s3_region.clone()))
        .force_path_style(true);
    if !config.file_storage.s3_url.is_empty() {
        aws_conf = aws_conf.endpoint_url(&config.file_storage.s3_url);
    }
    if !config.file_storage.s3_access_key_id.is_empty()
        && !config.file_storage.s3_secret_access_key.is_empty()
    {
        aws_conf = aws_conf.credentials_provider(Credentials::new(
            &config.file_storage.s3_access_key_id,
            &config.file_storage.s3_secret_access_key,
            None,
            None,
            PROJECT_NAME,
        ));
    }
    let aws_conf = aws_conf.build();
    let s3_client = Client::from_conf(aws_conf);
    let bucket_name = config.file_storage.s3_bucket_name.clone();
    (s3_client, bucket_name)
}

pub async fn is_enabled(ss: &Arc<SupportingService>) -> bool {
    let (s3_client, bucket_name) = get_client_and_bucket_name(&ss.config);
    s3_client
        .head_bucket()
        .bucket(bucket_name)
        .send()
        .await
        .is_ok()
}

pub async fn get_presigned_url(ss: &Arc<SupportingService>, key: String) -> Result<String> {
    let (s3_client, bucket_name) = get_client_and_bucket_name(&ss.config);
    let url = s3_client
        .get_object()
        .bucket(bucket_name)
        .key(key)
        .presigned(PresigningConfig::expires_in(
            Duration::minutes(90).to_std()?,
        )?)
        .await?
        .uri()
        .to_string();
    Ok(url)
}

pub async fn delete_object(ss: &Arc<SupportingService>, key: String) -> Result<bool> {
    let (s3_client, bucket_name) = get_client_and_bucket_name(&ss.config);
    let response = s3_client
        .delete_object()
        .bucket(bucket_name)
        .key(key)
        .send()
        .await
        .is_ok();
    Ok(response)
}

pub async fn get_presigned_put_url(
    ss: &Arc<SupportingService>,
    filename: String,
    prefix: String,
    with_uploads: bool,
    metadata: Option<HashMap<String, String>>,
) -> Result<(String, String)> {
    let (s3_client, bucket_name) = get_client_and_bucket_name(&ss.config);
    let first = if with_uploads { "uploads/" } else { "" };
    let key = format!("{}{}/{}-{}", first, prefix, nanoid!(10), filename);
    let url = s3_client
        .put_object()
        .bucket(bucket_name)
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

pub async fn list_objects_at_prefix(
    ss: &Arc<SupportingService>,
    prefix: String,
) -> Result<Vec<(i64, String)>> {
    let (s3_client, bucket_name) = get_client_and_bucket_name(&ss.config);
    let items = s3_client
        .list_objects_v2()
        .bucket(bucket_name)
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

pub async fn get_object_metadata(
    ss: &Arc<SupportingService>,
    key: String,
) -> Result<HashMap<String, String>> {
    let (s3_client, bucket_name) = get_client_and_bucket_name(&ss.config);
    let meta = s3_client
        .head_object()
        .bucket(bucket_name)
        .key(key)
        .send()
        .await?
        .metadata
        .unwrap_or_default();
    Ok(meta)
}
