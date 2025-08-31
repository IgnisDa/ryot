use std::sync::Arc;

use anyhow::Result;
use application_utils::get_base_http_client;
use cache_service;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, TvdbLanguage, TvdbSettings};
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use serde::Deserialize;
use supporting_service::SupportingService;

const URL: &str = "https://api4.thetvdb.com/v4";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbLanguageResponse {
    pub id: String,
    pub name: String,
    pub short_code: String,
    pub native_name: String,
}

#[derive(Deserialize)]
pub struct TvdbLanguagesApiResponse {
    pub data: Vec<TvdbLanguageResponse>,
}

pub struct TvdbService {
    pub client: Client,
    pub settings: TvdbSettings,
}

impl TvdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let api_key = &ss.config.movies_and_shows.tvdb.api_key;
        let client: Client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {api_key}"))?,
        )]));
        let settings = get_settings(&client, &ss).await.unwrap_or_default();
        Ok(Self { client, settings })
    }

    pub fn get_all_languages(&self) -> Vec<String> {
        self.settings
            .languages
            .iter()
            .map(|l| l.short_code.clone())
            .collect()
    }
}

async fn get_settings(client: &Client, ss: &Arc<SupportingService>) -> Result<TvdbSettings> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::TvdbSettings,
        ApplicationCacheValue::TvdbSettings,
        || async {
            let resp = client.get(format!("{URL}/languages")).send().await?;
            let languages_response: TvdbLanguagesApiResponse = resp.json().await?;
            let languages: Vec<TvdbLanguage> = languages_response
                .data
                .into_iter()
                .map(|l| TvdbLanguage {
                    id: l.id,
                    name: l.name,
                    short_code: l.short_code,
                    native_name: l.native_name,
                })
                .collect();
            let settings = TvdbSettings { languages };
            Ok(settings)
        },
    )
    .await
    .map(|c| c.response)
}
