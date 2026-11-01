use std::{fs::write, path::PathBuf, result::Result as StdResult, sync::Arc};

use anyhow::Result;
use async_graphql::http::{GraphQLPlaygroundConfig, playground_source};
use axum::{
    Extension, Json,
    body::Body,
    extract::{FromRequest, Multipart, Path, Request},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE, PRAGMA},
    },
    response::{Html, IntoResponse},
};
use background_models::{ApplicationJob, SingleApplicationJob};
use common_utils::get_temporary_directory;
use config_definition::MaskedConfig;
use dependent_models::{ApplicationCacheKey, EmptyCacheValue, ExpireCacheKeyInput};
use nanoid::nanoid;
use supporting_service::SupportingService;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

pub async fn graphql_playground_handler() -> impl IntoResponse {
    Html(playground_source(GraphQLPlaygroundConfig::new(
        "/backend/graphql",
    )))
}

pub async fn config_handler(Extension(ss): Extension<Arc<SupportingService>>) -> impl IntoResponse {
    Json(ss.config.masked())
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

async fn read_webhook_payload(request: Request, limit: usize) -> StdResult<String, StatusCode> {
    let is_multipart = request
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("multipart/form-data"));
    if !is_multipart {
        let bytes = axum::body::to_bytes(request.into_body(), limit)
            .await
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        return String::from_utf8(bytes.to_vec()).map_err(|_| StatusCode::BAD_REQUEST);
    }
    let mut multipart = Multipart::from_request(request, &())
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
    {
        if field.name() == Some("payload") {
            return field.text().await.map_err(|_| StatusCode::BAD_REQUEST);
        }
    }
    Err(StatusCode::BAD_REQUEST)
}

pub async fn integration_webhook_handler(
    Path(integration_slug): Path<String>,
    Extension(ss): Extension<Arc<SupportingService>>,
    request: Request,
) -> StdResult<(StatusCode, String), StatusCode> {
    let limit = 1024 * 1024 * ss.config.server.max_file_size_mb;
    let payload = read_webhook_payload(request, limit).await?;
    ss.perform_application_job(ApplicationJob::Single(
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
