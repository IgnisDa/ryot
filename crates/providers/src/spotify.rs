use std::sync::Arc;

use anyhow::Result;
use application_utils::get_base_http_client;
use async_trait::async_trait;
use common_models::{MetadataSearchSourceSpecifics, PersonSourceSpecifics};
use config::SpotifyConfig;
use data_encoding::BASE64;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, PersonDetails, SearchResults};
use media_models::{
    MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem, PartialMetadataWithoutId,
    PeopleSearchItem,
};
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use traits::MediaProvider;

static SPOTIFY_TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
static SPOTIFY_API_URL: &str = "https://api.spotify.com/v1";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyTokenResponse {
    access_token: String,
}

pub struct SpotifyService {
    client: Client,
    config: SpotifyConfig,
    ss: Arc<SupportingService>,
}

async fn get_spotify_access_token(
    config: &SpotifyConfig,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let cc = &ss.cache_service;
    let cached_response = cc
        .get_or_set_with_callback(
            ApplicationCacheKey::SpotifyAccessToken,
            ApplicationCacheValue::SpotifyAccessToken,
            || async {
                let credentials = format!("{}:{}", config.client_id, config.client_secret);
                let encoded_credentials = BASE64.encode(credentials.as_bytes());

                let response = Client::new()
                    .post(SPOTIFY_TOKEN_URL)
                    .header("Authorization", format!("Basic {}", encoded_credentials))
                    .form(&[("grant_type", "client_credentials")])
                    .send()
                    .await
                    .unwrap();

                let token_response: SpotifyTokenResponse = response.json().await.unwrap();

                Ok(token_response.access_token)
            },
        )
        .await
        .unwrap();

    Ok(cached_response.response)
}

impl SpotifyService {
    pub async fn new(config: &SpotifyConfig, ss: Arc<SupportingService>) -> Self {
        let access_token = get_spotify_access_token(config, &ss).await.unwrap();
        let client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", access_token)).unwrap(),
        )]));

        Self {
            ss,
            client,
            config: config.clone(),
        }
    }
}

#[async_trait]
impl MediaProvider for SpotifyService {
    async fn metadata_details(&self, _identifier: &str) -> Result<MetadataDetails> {
        todo!("Implement Spotify metadata_details")
    }

    async fn metadata_search(
        &self,
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        todo!("Implement Spotify metadata_search")
    }

    async fn metadata_group_details(
        &self,
        _identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        todo!("Implement Spotify metadata_group_details")
    }

    async fn metadata_group_search(
        &self,
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        todo!("Implement Spotify metadata_group_search")
    }

    async fn person_details(
        &self,
        _identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        todo!("Implement Spotify person_details")
    }

    async fn people_search(
        &self,
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        todo!("Implement Spotify people_search")
    }
}
