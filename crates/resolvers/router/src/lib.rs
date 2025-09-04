use std::{fs::write, path::PathBuf, result::Result as StdResult, sync::Arc};

use anyhow::Result;
use async_graphql::http::{GraphQLPlaygroundConfig, playground_source};
use axum::{
    Extension, Json,
    extract::{Multipart, Path},
    http::StatusCode,
    response::{Html, IntoResponse},
};
use common_utils::{get_temporary_directory, ryot_log};
use integration_service::IntegrationService;
use nanoid::nanoid;

pub async fn graphql_playground_handler() -> impl IntoResponse {
    Html(playground_source(GraphQLPlaygroundConfig::new(
        "/backend/graphql",
    )))
}

pub async fn config_handler(
    Extension(config): Extension<Arc<config_definition::AppConfig>>,
) -> impl IntoResponse {
    Json(config.masked_value())
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
    let response = integration_service
        .process_integration_webhook(integration_slug, payload)
        .await
        .map_err(|e| {
            ryot_log!(debug, "{:?}", e);
            StatusCode::UNPROCESSABLE_ENTITY
        })?;
    Ok((StatusCode::OK, response))
}
