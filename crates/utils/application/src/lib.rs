use std::sync::Arc;

use async_graphql::{Error, Result};
use async_trait::async_trait;
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    Extension, RequestPartsExt,
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
