use std::{sync::Arc, time::Duration};

use async_graphql::{Error, Result};
use async_trait::async_trait;
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    Extension, RequestPartsExt,
};
use chrono::{NaiveDate, Utc};
use common_utils::USER_AGENT_STR;
use file_storage_service::FileStorageService;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT},
    ClientBuilder,
};

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
        file_storage_service: &FileStorageService,
    ) -> Result<Self>
    where
        Self: Sized;
}

pub fn get_base_http_client(headers: Option<Vec<(HeaderName, HeaderValue)>>) -> reqwest::Client {
    let mut req_headers = HeaderMap::new();
    req_headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_STR));
    for (header, value) in headers.unwrap_or_default().into_iter() {
        req_headers.insert(header, value);
    }
    ClientBuilder::new()
        .default_headers(req_headers)
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap()
}

pub fn get_current_date(timezone: &chrono_tz::Tz) -> NaiveDate {
    Utc::now().with_timezone(timezone).date_naive()
}
