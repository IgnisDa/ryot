use anyhow::Result;
use async_graphql::http::GraphiQLSource;
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    body::{boxed, Full},
    extract::{Multipart, Path},
    headers::{authorization::Bearer, Authorization},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    Extension, Json, TypedHeader,
};
use http::header::AUTHORIZATION;
use rust_embed::RustEmbed;
use serde_json::json;
use tower_cookies::Cookies;
use uuid::Uuid;

use crate::{
    config::AppConfig,
    file_storage::FileStorageService,
    graphql::GraphqlSchema,
    miscellaneous::resolver::MiscellaneousService,
    utils::{user_id_from_token, GqlCtx, COOKIE_NAME},
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
    cookies: Cookies,
    headers: HeaderMap,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let mut req = req.0;
    let mut ctx = GqlCtx { auth_token: None };
    let strip = |t: &str| t.replace("Bearer ", "");
    if let Some(c) = cookies.get(COOKIE_NAME) {
        ctx.auth_token = Some(c.value().to_owned());
    } else if let Some(h) = headers.get(AUTHORIZATION) {
        ctx.auth_token = h.to_str().map(strip).ok();
    } else if let Some(h) = headers.get("X-Auth-Token") {
        ctx.auth_token = h.to_str().map(strip).ok();
    }
    req = req.data(ctx);
    schema.execute(req).await.into()
}

pub async fn graphql_playground() -> impl IntoResponse {
    Html(GraphiQLSource::build().endpoint("/graphql").finish())
}

pub async fn config_handler() -> impl IntoResponse {
    Json(get_app_config().masked_value())
}

pub async fn upload_handler(
    Extension(file_storage): Extension<Arc<FileStorageService>>,
    mut files: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mut res = vec![];
    while let Some(file) = files.next_field().await.unwrap() {
        let name = file
            .file_name()
            .map(String::from)
            .unwrap_or_else(|| "file.png".to_string());
        let data = file.bytes().await.unwrap();
        let key = format!("uploads/{}-{}", Uuid::new_v4(), name);
        file_storage
            .upload_file(&key, data.into())
            .await
            .map_err(|e| {
                tracing::error!("{:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"err": "an error occured during file upload"})),
                )
            })?;
        res.push(key);
    }
    Ok(Json(json!(res)))
}

pub async fn json_export(
    Extension(media_service): Extension<Arc<MiscellaneousService>>,
    TypedHeader(authorization): TypedHeader<Authorization<Bearer>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let user_id = user_id_from_token(authorization.token().to_owned(), &media_service.auth_db)
        .await
        .map_err(|e| (StatusCode::FORBIDDEN, Json(json!({"err": e.message}))))?;
    let resp = media_service.export(user_id).await.unwrap();
    Ok(Json(json!(resp)))
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
