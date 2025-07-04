use std::sync::Arc;

use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::Datelike;
use common_models::SearchDetails;
use common_utils::{PAGE_SIZE, ryot_log};
use dependent_models::SearchResults;
use media_models::{MetadataDetails, MetadataSearchItem};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use traits::MediaProvider;

static BASE_URL: &str = "https://www.giantbomb.com/api";

#[derive(Clone)]
pub struct GiantBombService {
    client: Client,
    api_key: String,
}

impl GiantBombService {
    pub async fn new(ss: Arc<SupportingService>) -> Self {
        let client = get_base_http_client(None);
        let config = ss.config.video_games.clone();
        Self {
            client,
            api_key: config.giantbomb.api_key.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombImage {
    icon_url: Option<String>,
    tiny_url: Option<String>,
    small_url: Option<String>,
    super_url: Option<String>,
    thumb_url: Option<String>,
    screen_url: Option<String>,
    medium_url: Option<String>,
    original_url: Option<String>,
    screen_large_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombPlatform {
    id: i32,
    name: String,
    abbreviation: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombCompany {
    id: i32,
    name: String,
    api_detail_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombPerson {
    id: i32,
    name: String,
    api_detail_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombGenre {
    id: i32,
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombTheme {
    id: i32,
    name: String,
    api_detail_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombFranchise {
    id: i32,
    name: String,
    api_detail_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombSimilarGame {
    id: i32,
    name: String,
    api_detail_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombGame {
    id: i32,
    guid: String,
    name: String,
    deck: Option<String>,
    description: Option<String>,
    image: Option<GiantBombImage>,
    genres: Option<Vec<GiantBombGenre>>,
    themes: Option<Vec<GiantBombTheme>>,
    people: Option<Vec<GiantBombPerson>>,
    original_release_date: Option<String>,
    platforms: Option<Vec<GiantBombPlatform>>,
    developers: Option<Vec<GiantBombCompany>>,
    publishers: Option<Vec<GiantBombCompany>>,
    franchises: Option<Vec<GiantBombFranchise>>,
    similar_games: Option<Vec<GiantBombSimilarGame>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombSearchResponse {
    limit: i32,
    offset: i32,
    error: String,
    status_code: i32,
    number_of_page_results: i32,
    results: Vec<GiantBombGame>,
    number_of_total_results: i32,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombGameDetailsResponse {
    error: String,
    status_code: i32,
    results: GiantBombGame,
}

fn extract_year_from_date(date_str: Option<String>) -> Option<i32> {
    date_str.and_then(|d| {
        chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d")
            .ok()
            .map(|date| date.year())
    })
}

#[async_trait]
impl MediaProvider for GiantBombService {
    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let offset = (page - 1) * PAGE_SIZE;

        ryot_log!(debug, "Searching GiantBomb for: {}", query);

        let url = format!("{}/search/", BASE_URL);
        let response = self
            .client
            .get(&url)
            .query(&[
                ("api_key", &self.api_key),
                ("format", &"json".to_string()),
                ("query", &query.to_string()),
                ("resources", &"game".to_string()),
                ("limit", &PAGE_SIZE.to_string()),
                ("offset", &offset.to_string()),
            ])
            .send()
            .await
            .map_err(|e| anyhow!("Failed to send request to GiantBomb: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "GiantBomb API returned status: {}",
                response.status()
            ));
        }

        let search_response: GiantBombSearchResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse GiantBomb response: {}", e))?;

        if search_response.error != "OK" {
            return Err(anyhow!("GiantBomb API error: {}", search_response.error));
        }

        let items = search_response
            .results
            .into_iter()
            .map(|game| MetadataSearchItem {
                title: game.name,
                identifier: game.guid,
                image: game.image.and_then(|img| img.original_url),
                publish_year: extract_year_from_date(game.original_release_date),
            })
            .collect();

        let next_page = if search_response.offset + search_response.number_of_page_results
            < search_response.number_of_total_results
        {
            Some(page + 1)
        } else {
            None
        };

        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total: search_response.number_of_total_results,
            },
        })
    }

    async fn metadata_details(&self, _identifier: &str) -> Result<MetadataDetails> {
        // TODO: Implement in next step
        Err(anyhow!(
            "metadata_details not yet implemented for GiantBomb"
        ))
    }
}
