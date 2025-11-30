use std::{fs::write, path::PathBuf, result::Result as StdResult, sync::Arc};

use anyhow::Result;
use async_graphql::http::{GraphQLPlaygroundConfig, playground_source};
use axum::{
    Extension, Json,
    body::Body,
    extract::{Multipart, Path},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE, PRAGMA},
    },
    response::{Html, IntoResponse},
};
use background_models::{ApplicationJob, SingleApplicationJob};
use common_utils::get_temporary_directory;
use config_definition::{AppConfig, MaskedConfig};
use dependent_models::{ApplicationCacheKey, EmptyCacheValue, ExpireCacheKeyInput};
use integration_service::IntegrationService;
use nanoid::nanoid;
use supporting_service::SupportingService;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

pub async fn graphql_playground_handler() -> impl IntoResponse {
    Html(playground_source(GraphQLPlaygroundConfig::new(
        "/backend/graphql",
    )))
}

pub async fn config_handler(Extension(config): Extension<Arc<AppConfig>>) -> impl IntoResponse {
    Json(config.masked())
}

/// Upload a file to the temporary file system. Primarily to be used for uploading
/// import files.
pub async fn upload_file_handler(
    mut files: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mut res = vec![];
    while let Some(file) = files.next_field().await.unwrap() {
        let name = file
            .file_name()
            .map(String::from)
            .unwrap_or_else(|| "file.png".to_string());
        let data = file.bytes().await.unwrap();
        let name = format!("{}-{}", nanoid!(), name);
        let path = PathBuf::new().join(get_temporary_directory()).join(name);
        write(&path, data).unwrap();
        res.push(path.canonicalize().unwrap());
    }
    Ok(Json(serde_json::json!(res)))
}

pub async fn integration_webhook_handler(
    Path(integration_slug): Path<String>,
    Extension(integration_service): Extension<Arc<IntegrationService>>,
    payload: String,
) -> StdResult<(StatusCode, String), StatusCode> {
    integration_service
        .0
        .perform_application_job(ApplicationJob::Single(
            SingleApplicationJob::ProcessIntegrationWebhook(integration_slug, payload),
        ))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::ACCEPTED,
        "Webhook queued for processing".to_owned(),
    ))
}

pub async fn download_logs_handler(
    Path(token): Path<String>,
    Extension(ss): Extension<Arc<SupportingService>>,
) -> StdResult<impl IntoResponse, StatusCode> {
    let key = ApplicationCacheKey::LogDownloadToken(token.clone());

    if cache_service::get_value::<EmptyCacheValue>(&ss, key.clone())
        .await
        .is_none()
    {
        return Err(StatusCode::UNAUTHORIZED);
    }

    cache_service::expire_key(&ss, ExpireCacheKeyInput::ByKey(Box::new(key)))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let file = File::open(&ss.log_file_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let file_size = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_LENGTH, HeaderValue::from(file_size));
    headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/plain"));
    headers.insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_static(r#"attachment; filename="ryot.log""#),
    );

    Ok((headers, body))
}
