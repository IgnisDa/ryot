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
use serde_json::json;
use supporting_service::SupportingService;

const URL: &str = "https://api4.thetvdb.com/v4";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbLanguageResponse {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbLanguagesApiResponse {
    pub data: Vec<TvdbLanguageResponse>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbLoginData {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct TvdbLoginResponse {
    pub data: TvdbLoginData,
}

pub struct TvdbService {
    pub client: Client,
    pub settings: TvdbSettings,
}

impl TvdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let settings = get_settings(&ss).await.unwrap_or_default();
        let client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&settings.access_token).unwrap(),
        )]));
        Ok(Self { client, settings })
    }

    pub fn get_all_languages(&self) -> Vec<String> {
        self.settings
            .languages
            .iter()
            .map(|l| l.code.clone())
            .collect()
    }
}

async fn get_settings(ss: &Arc<SupportingService>) -> Result<TvdbSettings> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::TvdbSettings,
        ApplicationCacheValue::TvdbSettings,
        || async {
            let client = Client::new();
            let login_response = client
                .post(format!("{URL}/login"))
                .json(&json!({
                    "apikey": ss.config.movies_and_shows.tvdb.api_key
                }))
                .send()
                .await?;
            let login_data: TvdbLoginResponse = login_response.json().await?;
            let access_token = format!("Bearer {}", login_data.data.token);
            let client = get_base_http_client(Some(vec![(
                AUTHORIZATION,
                HeaderValue::from_str(&access_token).unwrap(),
            )]));

            let resp = client.get(format!("{URL}/languages")).send().await?;
            let languages_response: TvdbLanguagesApiResponse = resp.json().await?;
            let languages: Vec<TvdbLanguage> = languages_response
                .data
                .into_iter()
                .flat_map(|l| l.name.map(|name| TvdbLanguage { name, code: l.id }))
                .collect();

            let settings = TvdbSettings {
                languages,
                access_token,
            };
            Ok(settings)
        },
    )
    .await
    .map(|c| c.response)
}
