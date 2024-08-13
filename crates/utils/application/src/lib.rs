use std::sync::Arc;

use async_graphql::{Error, Result};
use async_trait::async_trait;
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    Extension, RequestPartsExt,
};
use common_utils::PROJECT_NAME;
use file_storage_service::FileStorageService;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT},
    ClientBuilder,
};

pub const AUTHOR: &str = "ignisda";
pub const AUTHOR_EMAIL: &str = "ignisda2001@gmail.com";
#[cfg(debug_assertions)]
pub const VERSION: &str = dotenvy_macro::dotenv!("APP_VERSION");
#[cfg(not(debug_assertions))]
pub const VERSION: &str = env!("APP_VERSION");
pub const USER_AGENT_STR: &str = const_str::concat!(
    AUTHOR,
    "/",
    PROJECT_NAME,
    "-v",
    VERSION,
    " (",
    AUTHOR_EMAIL,
    ")"
);

pub fn user_id_from_token(token: &str, jwt_secret: &str) -> Result<String> {
    jwt_service::verify(token, jwt_secret)
        .map(|c| c.sub)
        .map_err(|e| Error::new(format!("Encountered error: {:?}", e)))
}

#[derive(Debug, Default)]
pub struct AuthContext {
    pub auth_token: Option<String>,
    pub user_id: Option<String>,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthContext
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let mut ctx = AuthContext {
            ..Default::default()
        };
        if let Some(h) = parts.headers.get(AUTHORIZATION) {
            ctx.auth_token = h.to_str().map(|s| s.replace("Bearer ", "")).ok();
        } else if let Some(h) = parts.headers.get("x-auth-token") {
            ctx.auth_token = h.to_str().map(String::from).ok();
        }
        if let Some(auth_token) = ctx.auth_token.as_ref() {
            let Extension(config) = parts
                .extract::<Extension<Arc<config::AppConfig>>>()
                .await
                .unwrap();
            if let Ok(user_id) = user_id_from_token(auth_token, &config.users.jwt_secret) {
                ctx.user_id = Some(user_id);
            }
        }
        Ok(ctx)
    }
}

#[async_trait]
pub trait GraphqlRepresentation {
    async fn graphql_representation(
        self,
        file_storage_service: &Arc<FileStorageService>,
    ) -> Result<Self>
    where
        Self: Sized;
}

pub fn get_base_http_client(
    url: &str,
    headers: Option<Vec<(HeaderName, HeaderValue)>>,
) -> reqwest::Client {
    let mut req_headers = HeaderMap::new();
    req_headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_STR));
    for (header, value) in headers.unwrap_or_default().into_iter() {
        req_headers.insert(header, value);
    }
    ClientBuilder::new()
        .default_headers(req_headers)
        .base_url(url.to_owned())
        .build()
        .unwrap()
}
