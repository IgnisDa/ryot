use std::sync::Arc;

use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_graphql::OutputType;
use async_trait::async_trait;
use chrono::{Datelike, NaiveDate};
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::{PAGE_SIZE, ryot_log};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{
    MetadataGroupPersonRelated, MetadataPersonRelated, PersonDetails, SearchResults,
};
use enum_models::{MediaLot, MediaSource};
use media_models::{
    CommitMetadataGroupInput, MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem,
    PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem, UniqueMediaIdentifier,
    VideoGameSpecifics,
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
            api_key: config.giant_bomb.api_key.clone(),
        }
    }

    fn process_search_response<T, R, F>(
        &self,
        search_response: GiantBombSearchResponse<T>,
        mapper: F,
    ) -> Result<SearchResults<R>>
    where
        F: Fn(T) -> R,
        R: OutputType,
    {
        if search_response.error != "OK" {
            return Err(anyhow!("GiantBomb API error: {}", search_response.error));
        }

        let items = search_response.results.into_iter().map(mapper).collect();
        let next_page = if search_response.offset + search_response.number_of_page_results
            < search_response.number_of_total_results
        {
            Some((search_response.offset / PAGE_SIZE) + 2)
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
struct GiantBombResource {
    guid: String,
    name: String,
    deck: Option<String>,
    description: Option<String>,
    image: Option<GiantBombImage>,
    api_detail_url: Option<String>,
    site_detail_url: Option<String>,

    // Game-specific fields
    original_release_date: Option<String>,
    genres: Option<Vec<GiantBombResource>>,
    themes: Option<Vec<GiantBombResource>>,
    people: Option<Vec<GiantBombResource>>,
    platforms: Option<Vec<GiantBombResource>>,
    developers: Option<Vec<GiantBombResource>>,
    publishers: Option<Vec<GiantBombResource>>,
    franchises: Option<Vec<GiantBombResource>>,
    similar_games: Option<Vec<GiantBombResource>>,

    // Company-specific fields
    founded: Option<i32>,
    developed_games: Option<Vec<GiantBombResource>>,
    published_games: Option<Vec<GiantBombResource>>,

    // Person-specific fields
    birth_date: Option<String>,

    // Franchise and Person shared field
    games: Option<Vec<GiantBombResource>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombSearchResponse<T> {
    offset: i32,
    error: String,
    results: Vec<T>,
    number_of_page_results: i32,
    number_of_total_results: i32,
}

#[derive(Debug, Serialize, Deserialize)]
struct GiantBombDetailsResponse<T> {
    results: T,
}

fn extract_year_from_date(date_str: Option<String>) -> Option<i32> {
    parse_date(date_str).map(|date| date.year())
}

fn parse_date(date_str: Option<String>) -> Option<NaiveDate> {
    date_str.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok())
}

fn extract_giant_bomb_guid(api_detail_url: &str) -> String {
    api_detail_url
        .split('/')
        .filter(|s| !s.is_empty())
        .last()
        .unwrap_or("")
        .to_string()
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

fn combine_description(deck: Option<String>, description: Option<String>) -> Option<String> {
    match (deck, description) {
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
    }
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

        let search_response: GiantBombSearchResponse<GiantBombResource> = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse GiantBomb response: {}", e))?;

        self.process_search_response(search_response, |game| MetadataSearchItem {
            title: game.name,
            identifier: game.guid,
            image: game.image.and_then(|img| img.original_url),
            publish_year: extract_year_from_date(game.original_release_date),
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

        let details_response: GiantBombDetailsResponse<GiantBombResource> =
            response
                .json()
                .await
                .map_err(|e| anyhow!("Failed to parse GiantBomb response: {}", e))?;

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
                            is_giant_bomb_company: Some(true),
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
                            source: MediaSource::GiantBomb,
                            identifier: extract_giant_bomb_guid(&api_url),
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

        let description = combine_description(game.deck, game.description);

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

    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let page = page.unwrap_or(1);
        let offset = (page - 1) * PAGE_SIZE;

        let search_type = match source_specifics {
            Some(PersonSourceSpecifics {
                is_giant_bomb_company: Some(true),
                ..
            }) => "company",
            _ => "person",
        };

        ryot_log!(debug, "Searching GiantBomb {} for: {}", search_type, query);

        let url = format!("{}/search/", BASE_URL);
        let response = self
            .client
            .get(&url)
            .query(&[
                ("api_key", &self.api_key),
                ("query", &query.to_string()),
                ("offset", &offset.to_string()),
                ("format", &"json".to_string()),
                ("limit", &PAGE_SIZE.to_string()),
                ("resources", &search_type.to_string()),
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

        let items = match search_type {
            "company" => {
                let search_response: GiantBombSearchResponse<GiantBombResource> =
                    response.json().await?;
                self.process_search_response(search_response, |company| PeopleSearchItem {
                    name: company.name,
                    identifier: company.guid,
                    birth_year: company.founded,
                    image: company.image.and_then(|img| img.original_url),
                })?
            }
            _ => {
                let search_response: GiantBombSearchResponse<GiantBombResource> =
                    response.json().await?;
                self.process_search_response(search_response, |person| PeopleSearchItem {
                    name: person.name,
                    identifier: person.guid,
                    image: person.image.and_then(|img| img.original_url),
                    birth_year: person
                        .birth_date
                        .and_then(|d| extract_year_from_date(Some(d))),
                })?
            }
        };

        Ok(items)
    }

    async fn person_details(
        &self,
        identifier: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let is_company = source_specifics
            .as_ref()
            .and_then(|s| s.is_giant_bomb_company)
            .unwrap_or(false);

        let endpoint = if is_company { "company" } else { "person" };

        ryot_log!(
            debug,
            "Fetching GiantBomb {} details for: {}",
            endpoint,
            identifier
        );

        let url = format!("{}/{}/{}/", BASE_URL, endpoint, identifier);
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

        let details_response: GiantBombDetailsResponse<GiantBombResource> =
            response
                .json()
                .await
                .map_err(|e| anyhow!("Failed to parse GiantBomb response: {}", e))?;

        let resource = details_response.results;
        let mut related_games = Vec::new();
        let mut related_groups = Vec::new();

        if is_company {
            if let Some(developed_games) = resource.developed_games {
                for game in developed_games {
                    if let Some(api_url) = game.api_detail_url {
                        related_games.push(MetadataPersonRelated {
                            role: "Developer".to_string(),
                            metadata: PartialMetadataWithoutId {
                                title: game.name,
                                lot: MediaLot::VideoGame,
                                source: MediaSource::GiantBomb,
                                identifier: extract_giant_bomb_guid(&api_url),
                                ..Default::default()
                            },
                            ..Default::default()
                        });
                    }
                }
            }

            if let Some(published_games) = resource.published_games {
                for game in published_games {
                    if let Some(api_url) = game.api_detail_url {
                        related_games.push(MetadataPersonRelated {
                            role: "Publisher".to_string(),
                            metadata: PartialMetadataWithoutId {
                                title: game.name,
                                lot: MediaLot::VideoGame,
                                source: MediaSource::GiantBomb,
                                identifier: extract_giant_bomb_guid(&api_url),
                                ..Default::default()
                            },
                            ..Default::default()
                        });
                    }
                }
            }
        } else {
            if let Some(games) = resource.games {
                for game in games {
                    if let Some(api_url) = game.api_detail_url {
                        related_games.push(MetadataPersonRelated {
                            role: "Person".to_string(),
                            metadata: PartialMetadataWithoutId {
                                title: game.name,
                                lot: MediaLot::VideoGame,
                                source: MediaSource::GiantBomb,
                                identifier: extract_giant_bomb_guid(&api_url),
                                ..Default::default()
                            },
                            ..Default::default()
                        });
                    }
                }
            }

            if let Some(franchises) = resource.franchises {
                for franchise in franchises {
                    if let Some(api_url) = franchise.api_detail_url {
                        related_groups.push(MetadataGroupPersonRelated {
                            role: "Person".to_string(),
                            metadata_group: MetadataGroupWithoutId {
                                title: franchise.name,
                                lot: MediaLot::VideoGame,
                                source: MediaSource::GiantBomb,
                                identifier: extract_giant_bomb_guid(&api_url),
                                ..Default::default()
                            },
                        });
                    }
                }
            }
        }

        let birth_date = if is_company {
            resource
                .founded
                .map(|year| NaiveDate::from_ymd_opt(year, 1, 1).unwrap())
        } else {
            parse_date(resource.birth_date)
        };

        Ok(PersonDetails {
            name: resource.name,
            birth_date,
            source_url: resource.site_detail_url,
            related_metadata: related_games,
            identifier: resource.guid,
            related_metadata_groups: related_groups,
            source: MediaSource::GiantBomb,
            description: combine_description(resource.deck, resource.description),
            assets: EntityAssets {
                remote_images: get_prioritized_images(resource.image),
                ..Default::default()
            },
            source_specifics: match is_company {
                false => None,
                true => Some(PersonSourceSpecifics {
                    is_giant_bomb_company: Some(true),
                    ..Default::default()
                }),
            },
            ..Default::default()
        })
    }

    async fn metadata_group_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let page = page.unwrap_or(1);
        let offset = (page - 1) * PAGE_SIZE;

        ryot_log!(debug, "Searching GiantBomb franchises for: {}", query);

        let url = format!("{}/search/", BASE_URL);
        let response = self
            .client
            .get(&url)
            .query(&[
                ("api_key", &self.api_key),
                ("query", &query.to_string()),
                ("format", &"json".to_string()),
                ("offset", &offset.to_string()),
                ("limit", &PAGE_SIZE.to_string()),
                ("resources", &"franchise".to_string()),
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

        let search_response: GiantBombSearchResponse<GiantBombResource> = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse GiantBomb response: {}", e))?;

        self.process_search_response(search_response, |franchise| MetadataGroupSearchItem {
            name: franchise.name,
            identifier: franchise.guid,
            image: franchise.image.and_then(|img| img.original_url),
            ..Default::default()
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        ryot_log!(
            debug,
            "Fetching GiantBomb franchise details for: {}",
            identifier
        );

        let url = format!("{}/franchise/{}/", BASE_URL, identifier);
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

        let details_response: GiantBombDetailsResponse<GiantBombResource> =
            response
                .json()
                .await
                .map_err(|e| anyhow!("Failed to parse GiantBomb response: {}", e))?;

        let franchise = details_response.results;

        let metadata_group = MetadataGroupWithoutId {
            title: franchise.name,
            lot: MediaLot::VideoGame,
            identifier: franchise.guid,
            source: MediaSource::GiantBomb,
            source_url: franchise.site_detail_url,
            description: combine_description(franchise.deck, franchise.description),
            assets: EntityAssets {
                remote_images: get_prioritized_images(franchise.image),
                ..Default::default()
            },
            parts: franchise
                .games
                .as_ref()
                .map(|games| games.len())
                .unwrap_or(0) as i32,
        };

        let mut games = Vec::new();
        if let Some(franchise_games) = franchise.games {
            for game in franchise_games {
                if let Some(api_url) = game.api_detail_url {
                    games.push(PartialMetadataWithoutId {
                        title: game.name,
                        lot: MediaLot::VideoGame,
                        source: MediaSource::GiantBomb,
                        identifier: extract_giant_bomb_guid(&api_url),
                        ..Default::default()
                    });
                }
            }
        }

        Ok((metadata_group, games))
    }
}
