use std::sync::Arc;

use anyhow::Result;
use application_utils::get_base_http_client;
use common_models::SearchDetails;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, SearchResults, TvdbSettings};
use itertools::Itertools;
use media_models::MetadataSearchItem;
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use supporting_service::SupportingService;

use crate::models::{TvdbLanguagesApiResponse, TvdbLoginResponse, TvdbSearchResponse, URL};

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
            .map(|l| l.id.clone())
            .collect()
    }

    pub fn get_language_name(&self, iso: Option<String>) -> Option<String> {
        iso.and_then(|i| {
            self.settings
                .languages
                .iter()
                .find(|l| l.id == i)
                .map(|l| l.name.clone())
        })
    }

    pub async fn trigger_search(
        &self,
        page: i32,
        query: &str,
        search_type: &str,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let limit = 20;
        let offset = (page - 1) * limit;

        let rsp = self
            .client
            .get(format!("{URL}/search"))
            .query(&[
                ("query", query),
                ("type", search_type),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
            ])
            .send()
            .await?;
        let search: TvdbSearchResponse = rsp.json().await?;

        let next_page = search
            .links
            .as_ref()
            .and_then(|l| l.next.as_ref())
            .is_some()
            .then(|| page + 1);
        let total_items = search
            .links
            .as_ref()
            .and_then(|l| l.total_items)
            .unwrap_or(0);

        let resp = search
            .data
            .into_iter()
            .map(|d| MetadataSearchItem {
                identifier: d.tvdb_id,
                image: d.poster.or(d.image_url),
                title: d.title.or(d.name).unwrap_or_default(),
                ..Default::default()
            })
            .collect_vec();

        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
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
                .json(&serde_json::json!({ "apikey": ss.config.movies_and_shows.tvdb.api_key }))
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

            let settings = TvdbSettings {
                access_token,
                languages: languages_response.data,
            };
            Ok(settings)
        },
    )
    .await
    .map(|c| c.response)
}
