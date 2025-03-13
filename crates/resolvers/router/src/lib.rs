use std::{fs::write, path::PathBuf, sync::Arc};

use anyhow::Result;
use async_graphql::http::GraphiQLSource;
use axum::{
    Extension, Json,
    extract::{Multipart, Path},
    http::StatusCode,
    response::{Html, IntoResponse},
};
use common_utils::{TEMPORARY_DIRECTORY, ryot_log};
use integration_service::IntegrationService;
use nanoid::nanoid;
use serde_json::json;

pub async fn graphql_playground() -> impl IntoResponse {
    Html(
        GraphiQLSource::build()
            .endpoint("/backend/graphql")
            .finish(),
    )
}

pub async fn config_handler(
    Extension(config): Extension<Arc<config::AppConfig>>,
) -> impl IntoResponse {
    Json(config.masked_value())
}

/// Upload a file to the temporary file system. Primarily to be used for uploading
/// import files.
pub async fn upload_file(
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
        let path = PathBuf::new().join(TEMPORARY_DIRECTORY).join(name);
        write(&path, data).unwrap();
        res.push(path.canonicalize().unwrap());
    }
    Ok(Json(json!(res)))
}

pub async fn integration_webhook(
    Path(integration_slug): Path<String>,
    Extension(integration_service): Extension<Arc<IntegrationService>>,
    payload: String,
) -> std::result::Result<(StatusCode, String), StatusCode> {
    let response = integration_service
        .process_integration_webhook(integration_slug, payload)
        .await
        .map_err(|e| {
            ryot_log!(debug, "{:?}", e);
            StatusCode::UNPROCESSABLE_ENTITY
        })?;
    Ok((StatusCode::OK, response))
}
