use std::{sync::Arc, time::Duration};

use async_graphql::{Error, Result};
use async_trait::async_trait;
use axum::{
    Extension, RequestPartsExt,
    extract::FromRequestParts,
    http::{StatusCode, header::AUTHORIZATION, request::Parts},
};
use chrono::{NaiveDate, NaiveDateTime, Utc};
use common_utils::{FRONTEND_OAUTH_ENDPOINT, USER_AGENT_STR, ryot_log};
use file_storage_service::FileStorageService;
use media_models::{
    GraphqlSortOrder, PodcastEpisode, PodcastSpecifics, ShowEpisode, ShowSeason, ShowSpecifics,
};
use openidconnect::{
    ClientId, ClientSecret, IssuerUrl, RedirectUrl,
    core::{CoreClient, CoreProviderMetadata},
    reqwest,
};
use reqwest::{
    Client, ClientBuilder, ClientBuilder,
    header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT},
};
use sea_orm::Order;

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

pub fn get_current_time(timezone: &chrono_tz::Tz) -> NaiveDateTime {
    Utc::now().with_timezone(timezone).naive_local()
}

pub fn get_current_date(timezone: &chrono_tz::Tz) -> NaiveDate {
    get_current_time(timezone).date()
}

pub fn graphql_to_db_order(value: GraphqlSortOrder) -> Order {
    match value {
        GraphqlSortOrder::Desc => Order::Desc,
        GraphqlSortOrder::Asc => Order::Asc,
    }
}

pub fn get_show_episode_by_numbers(
    val: &ShowSpecifics,
    season_number: i32,
    episode_number: i32,
) -> Option<(&ShowSeason, &ShowEpisode)> {
    val.seasons
        .iter()
        .find(|s| s.season_number == season_number)
        .and_then(|s| {
            s.episodes
                .iter()
                .find(|e| e.episode_number == episode_number)
                .map(|e| (s, e))
        })
}

pub fn get_podcast_episode_by_number(
    val: &PodcastSpecifics,
    episode_number: i32,
) -> Option<&PodcastEpisode> {
    val.episodes.iter().find(|e| e.number == episode_number)
}

pub fn get_podcast_episode_number_by_name(val: &PodcastSpecifics, name: &str) -> Option<i32> {
    val.episodes
        .iter()
        .find(|e| e.title == name)
        .map(|e| e.number)
}

async fn create_oidc_client(config: &config::AppConfig) -> Option<(reqwest::Client, CoreClient)> {
    match RedirectUrl::new(config.frontend.url.clone() + FRONTEND_OAUTH_ENDPOINT) {
        Ok(redirect_url) => match IssuerUrl::new(config.server.oidc.issuer_url.clone()) {
            Ok(issuer_url) => {
                let async_http_client = reqwest::ClientBuilder::new()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap();
                match CoreProviderMetadata::discover_async(issuer_url, &async_http_client).await {
                    Ok(provider_metadata) => {
                        let core_client = CoreClient::from_provider_metadata(
                            provider_metadata,
                            ClientId::new(config.server.oidc.client_id.clone()),
                            Some(ClientSecret::new(config.server.oidc.client_secret.clone())),
                        )
                        .set_redirect_uri(redirect_url);
                        Some((async_http_client, core_client))
                    }
                    Err(e) => {
                        ryot_log!(debug, "Error while creating OIDC client: {:?}", e);
                        None
                    }
                }
            }
            Err(e) => {
                ryot_log!(debug, "Error while processing OIDC issuer url: {:?}", e);
                None
            }
        },
        Err(e) => {
            ryot_log!(debug, "Error while processing OIDC redirect url: {:?}", e);
            None
        }
    }
}
