use std::sync::Arc;

use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::Datelike;
use common_models::{EntityAssets, SearchDetails};
use common_utils::{PAGE_SIZE, ryot_log};
use dependent_models::SearchResults;
use enum_models::{MediaLot, MediaSource};
use media_models::{
    CommitMetadataGroupInput, MetadataDetails, MetadataSearchItem, PartialMetadataPerson,
    PartialMetadataWithoutId, UniqueMediaIdentifier, VideoGameSpecifics,
};
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
struct GiantBombPartialItem {
    id: i32,
    name: String,
    abbreviation: Option<String>,
    api_detail_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombGame {
    id: i32,
    guid: String,
    name: String,
    deck: Option<String>,
    description: Option<String>,
    image: Option<GiantBombImage>,
    original_release_date: Option<String>,
    site_detail_url: Option<String>,
    genres: Option<Vec<GiantBombPartialItem>>,
    themes: Option<Vec<GiantBombPartialItem>>,
    people: Option<Vec<GiantBombPartialItem>>,
    platforms: Option<Vec<GiantBombPartialItem>>,
    developers: Option<Vec<GiantBombPartialItem>>,
    publishers: Option<Vec<GiantBombPartialItem>>,
    franchises: Option<Vec<GiantBombPartialItem>>,
    similar_games: Option<Vec<GiantBombPartialItem>>,
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

fn extract_giant_bomb_guid(api_detail_url: &str) -> String {
    api_detail_url
        .split('/')
        .last()
        .and_then(|s| s.strip_suffix('/').or(Some(s)))
        .map(|s| s.to_string())
        .unwrap()
}

fn get_prioritized_images(image: Option<GiantBombImage>) -> Vec<String> {
    image.map_or(Vec::new(), |img| {
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

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        ryot_log!(debug, "Fetching GiantBomb game details for: {}", identifier);

        let url = format!("{}/game/{}/", BASE_URL, identifier);
        let response = self
            .client
            .get(&url)
            .query(&[("api_key", &self.api_key), ("format", &"json".to_string())])
            .send()
            .await
            .map_err(|e| anyhow!("Failed to send request to GiantBomb: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "GiantBomb API returned status: {}",
                response.status()
            ));
        }

        let details_response: GiantBombGameDetailsResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse GiantBomb response: {}", e))?;

        if details_response.error != "OK" {
            return Err(anyhow!("GiantBomb API error: {}", details_response.error));
        }

        let game = details_response.results;

        let mut people = Vec::new();

        if let Some(devs) = game.developers {
            for dev in devs {
                if let Some(api_url) = dev.api_detail_url {
                    people.push(PartialMetadataPerson {
                        name: dev.name,
                        source: MediaSource::GiantBomb,
                        character: Some("Developer".to_string()),
                        identifier: extract_giant_bomb_guid(&api_url),
                        source_specifics: Some(PersonSourceSpecifics {
                            is_giant_bomb_company: Some(true),
                            ..Default::default()
                        }),
                        ..Default::default()
                    });
                }
            }
        }

        if let Some(pubs) = game.publishers {
            for publish in pubs {
                if let Some(api_url) = publish.api_detail_url {
                    people.push(PartialMetadataPerson {
                        name: publish.name,
                        source: MediaSource::GiantBomb,
                        character: Some("Publisher".to_string()),
                        identifier: extract_giant_bomb_guid(&api_url),
                        source_specifics: Some(PersonSourceSpecifics {
                            is_giant_bomb_publisher: Some(true),
                            ..Default::default()
                        }),
                        ..Default::default()
                    });
                }
            }
        }

        if let Some(game_people) = game.people {
            for person in game_people {
                if let Some(api_url) = person.api_detail_url {
                    people.push(PartialMetadataPerson {
                        name: person.name,
                        source: MediaSource::GiantBomb,
                        identifier: extract_giant_bomb_guid(&api_url),
                        ..Default::default()
                    });
                }
            }
        }

        let mut groups = Vec::new();
        if let Some(franchises) = game.franchises {
            for franchise in franchises {
                if let Some(api_url) = franchise.api_detail_url {
                    groups.push(CommitMetadataGroupInput {
                        name: franchise.name,
                        unique: UniqueMediaIdentifier {
                            lot: MediaLot::VideoGame,
                            identifier: extract_giant_bomb_guid(&api_url),
                            source: MediaSource::GiantBomb,
                        },
                        ..Default::default()
                    });
                }
            }
        }

        let mut suggestions = Vec::new();
        if let Some(similar_games) = game.similar_games {
            for similar in similar_games {
                if let Some(api_url) = similar.api_detail_url {
                    suggestions.push(PartialMetadataWithoutId {
                        title: similar.name,
                        lot: MediaLot::VideoGame,
                        source: MediaSource::GiantBomb,
                        identifier: extract_giant_bomb_guid(&api_url),
                        image: None,
                        publish_year: None,
                    });
                }
            }
        }

        let mut genres = Vec::new();
        if let Some(game_genres) = game.genres {
            for genre in game_genres {
                genres.push(genre.name);
            }
        }
        if let Some(game_themes) = game.themes {
            for theme in game_themes {
                genres.push(theme.name);
            }
        }

        let mut platforms = Vec::new();
        if let Some(game_platforms) = game.platforms {
            for platform in game_platforms {
                platforms.push(platform.name);
            }
        }

        let images = get_prioritized_images(game.image);

        let description = match (game.deck, game.description) {
            (Some(deck), Some(desc)) => {
                if deck.trim().is_empty() {
                    Some(desc)
                } else if desc.trim().is_empty() {
                    Some(deck)
                } else {
                    Some(format!("{}\n\n{}", deck, desc))
                }
            }
            (Some(deck), None) => Some(deck),
            (None, Some(desc)) => Some(desc),
            (None, None) => None,
        };

        Ok(MetadataDetails {
            people,
            genres,
            groups,
            description,
            suggestions,
            title: game.name,
            identifier: game.guid,
            lot: MediaLot::VideoGame,
            source: MediaSource::GiantBomb,
            source_url: game.site_detail_url,
            video_game_specifics: Some(VideoGameSpecifics { platforms }),
            publish_year: extract_year_from_date(game.original_release_date),
            assets: EntityAssets {
                remote_images: images,
                ..Default::default()
            },
            ..Default::default()
        })
    }
}
