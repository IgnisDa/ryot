use std::{fs::write, path::PathBuf, sync::Arc};

use anyhow::Result;
use async_graphql::http::GraphiQLSource;
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    body::{boxed, Full},
    extract::{Multipart, Path},
    headers::{authorization::Bearer, Authorization},
    http::{header, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    Extension, Json, TypedHeader,
};
use rust_embed::RustEmbed;
use serde_json::json;

use crate::{
    config::AppConfig,
    fitness::exercise::resolver::ExerciseService,
    graphql::GraphqlSchema,
    miscellaneous::resolver::MiscellaneousService,
    models::media::ExportAllResponse,
    utils::{user_id_from_token, GqlCtx},
};

static INDEX_HTML: &str = "index.html";

#[derive(RustEmbed)]
#[folder = "../frontend/out/"]
struct Assets;

pub async fn static_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_owned();

    if path.is_empty() || path == INDEX_HTML {
        return index_html().await;
    }

    if !path.contains('.') {
        path.push_str(".html");
    }

    match Assets::get(&path) {
        Some(content) => {
            let body = boxed(Full::from(content.data));
            let mime = mime_guess::from_path(path).first_or_octet_stream();

            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(body)
                .unwrap()
        }
        None => not_found().await,
    }
}

pub async fn index_html() -> Response {
    match Assets::get(INDEX_HTML) {
        Some(content) => {
            let body = boxed(Full::from(content.data));
            Response::builder()
                .header(header::CONTENT_TYPE, "text/html")
                .body(body)
                .unwrap()
        }
        None => not_found().await,
    }
}

pub async fn not_found() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(boxed(Full::from("404")))
        .unwrap()
}

pub async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    gql_ctx: GqlCtx,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner().data(gql_ctx)).await.into()
}

pub async fn graphql_playground() -> impl IntoResponse {
    Html(GraphiQLSource::build().endpoint("/graphql").finish())
}

pub async fn config_handler(Extension(config): Extension<Arc<AppConfig>>) -> impl IntoResponse {
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
        let tmp_dir = PathBuf::new().join("tmp");
        let path = tmp_dir.join(name);
        write(&path, data).unwrap();
        res.push(path);
    }
    Ok(Json(json!(res)))
}

pub async fn json_export(
    Path(export_type): Path<String>,
    Extension(media_service): Extension<Arc<MiscellaneousService>>,
    Extension(exercise_service): Extension<Arc<ExerciseService>>,
    TypedHeader(authorization): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let user_id = user_id_from_token(authorization.token().to_owned(), &media_service.auth_db)
        .await
        .map_err(|e| (StatusCode::FORBIDDEN, Json(json!({"err": e.message}))))?;
    let resp = match export_type.as_str() {
        "all" => {
            let media = media_service.export_media(user_id).await.unwrap();
            let people = media_service.export_people(user_id).await.unwrap();
            let measurements = exercise_service.export_measurements(user_id).await.unwrap();
            json!(ExportAllResponse {
                media,
                people,
                measurements
            })
        }
        "media" => {
            json!(media_service.export_media(user_id).await.unwrap())
        }
        "people" => {
            json!(media_service.export_people(user_id).await.unwrap())
        }
        "measurements" => {
            json!(exercise_service.export_measurements(user_id).await.unwrap())
        }
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"err": "This type of export is not supported"})),
        ))?,
    };
    Ok(Json(resp))
}

pub async fn integration_webhook(
    Path((integration, user_hash_id)): Path<(String, String)>,
    Extension(media_service): Extension<Arc<MiscellaneousService>>,
    payload: String,
) -> std::result::Result<StatusCode, StatusCode> {
    media_service
        .process_integration_webhook(user_hash_id, integration, payload)
        .await
        .map_err(|e| {
            tracing::error!("{:?}", e);
            StatusCode::UNPROCESSABLE_ENTITY
        })?;
    Ok(StatusCode::OK)
}
