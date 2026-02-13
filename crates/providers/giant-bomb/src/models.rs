use anyhow::{Result, bail};
use async_graphql::OutputType;
use chrono::{Datelike, NaiveDate};
use common_models::SearchDetails;
use common_utils::compute_next_page;
use dependent_models::SearchResults;
use serde::{Deserialize, Serialize};

use crate::base::GiantBombService;

#[derive(Debug, Serialize, Deserialize)]
pub struct GiantBombImage {
    pub icon_url: Option<String>,
    pub tiny_url: Option<String>,
    pub small_url: Option<String>,
    pub super_url: Option<String>,
    pub thumb_url: Option<String>,
    pub screen_url: Option<String>,
    pub medium_url: Option<String>,
    pub original_url: Option<String>,
    pub screen_large_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GiantBombResource {
    pub guid: Option<String>,
    pub name: Option<String>,
    pub deck: Option<String>,
    pub description: Option<String>,
    pub image: Option<GiantBombImage>,
    pub api_detail_url: Option<String>,
    pub site_detail_url: Option<String>,

    // Game-specific fields
    pub original_release_date: Option<String>,
    pub genres: Option<Vec<GiantBombResource>>,
    pub themes: Option<Vec<GiantBombResource>>,
    pub people: Option<Vec<GiantBombResource>>,
    pub platforms: Option<Vec<GiantBombResource>>,
    pub developers: Option<Vec<GiantBombResource>>,
    pub publishers: Option<Vec<GiantBombResource>>,
    pub franchises: Option<Vec<GiantBombResource>>,
    pub similar_games: Option<Vec<GiantBombResource>>,

    // Company-specific fields
    pub founded: Option<i32>,
    pub developed_games: Option<Vec<GiantBombResource>>,
    pub published_games: Option<Vec<GiantBombResource>>,

    // Person-specific fields
    pub birth_date: Option<String>,

    // Franchise and Person shared field
    pub games: Option<Vec<GiantBombResource>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GiantBombSearchResponse<T> {
    pub offset: u64,
    pub error: String,
    pub results: Vec<T>,
    pub number_of_page_results: u64,
    pub number_of_total_results: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GiantBombDetailsResponse<T> {
    pub results: T,
}

pub fn extract_year_from_date(date_str: Option<String>) -> Option<i32> {
    parse_date(date_str).map(|date| date.year())
}

pub fn parse_date(date_str: Option<String>) -> Option<NaiveDate> {
    date_str.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok())
}

pub fn extract_giant_bomb_guid(api_detail_url: &str) -> String {
    api_detail_url
        .split('/')
        .rfind(|s| !s.is_empty())
        .unwrap_or("")
        .to_string()
}

pub fn get_prioritized_images(image: Option<GiantBombImage>) -> Vec<String> {
    image.map_or(vec![], |img| {
        [
            img.original_url,
            img.super_url,
            img.medium_url,
            img.screen_large_url,
            img.screen_url,
            img.small_url,
            img.thumb_url,
            img.icon_url,
            img.tiny_url,
        ]
        .into_iter()
        .flatten()
        .collect()
    })
}

pub fn combine_description(deck: Option<String>, description: Option<String>) -> Option<String> {
    match (deck, description) {
        (Some(deck), Some(desc)) => {
            if deck.trim().is_empty() {
                Some(desc)
            } else if desc.trim().is_empty() {
                Some(deck)
            } else {
                Some(format!("{deck}\n\n{desc}"))
            }
        }
        (Some(deck), None) => Some(deck),
        (None, Some(desc)) => Some(desc),
        (None, None) => None,
    }
}

impl GiantBombService {
    pub fn process_search_response<T, R, F>(
        &self,
        page: u64,
        search_response: GiantBombSearchResponse<T>,
        mapper: F,
    ) -> Result<SearchResults<R>>
    where
        F: Fn(T) -> R,
        R: OutputType,
    {
        if search_response.error != "OK" {
            bail!("GiantBomb API error: {}", search_response.error);
        }

        let items = search_response.results.into_iter().map(mapper).collect();
        let next_page = compute_next_page(page, search_response.number_of_total_results);

        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items: search_response.number_of_total_results,
            },
        })
    }
}
