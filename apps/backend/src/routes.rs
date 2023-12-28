use std::{fs::write, path::PathBuf, sync::Arc};

use anyhow::Result;
use async_graphql::http::GraphiQLSource;
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    extract::{Multipart, Path},
    http::StatusCode,
    response::{Html, IntoResponse},
    Extension, Json,
};
use nanoid::nanoid;
use serde_json::json;

use crate::{
    graphql::GraphqlSchema,
    miscellaneous::resolver::MiscellaneousService,
    utils::{AuthContext, TEMP_DIR},
};

pub async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    gql_ctx: AuthContext,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner().data(gql_ctx)).await.into()
}

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
        let path = PathBuf::new().join(TEMP_DIR).join(name);
        write(&path, data).unwrap();
        res.push(path.canonicalize().unwrap());
    }
    Ok(Json(json!(res)))
}

pub async fn integration_webhook(
    Path((integration, user_hash_id)): Path<(String, String)>,
    Extension(media_service): Extension<Arc<MiscellaneousService>>,
    payload: String,
) -> std::result::Result<(StatusCode, String), StatusCode> {
    let response = media_service
        .process_integration_webhook(user_hash_id, integration, payload)
        .await
        .map_err(|e| {
            tracing::error!("{:?}", e);
            StatusCode::UNPROCESSABLE_ENTITY
        })?;
    Ok((StatusCode::OK, response))
}
