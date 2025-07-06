use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::{EntityAssets, PersonSourceSpecifics};
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
use traits::MediaProvider;

use super::base::{BASE_URL, GiantBombService, ROLE_DEVELOPER, ROLE_PERSON, ROLE_PUBLISHER};
use super::models::{
    GiantBombDetailsResponse, GiantBombResource, GiantBombSearchResponse, combine_description,
    extract_giant_bomb_guid, extract_year_from_date, get_prioritized_images, parse_date,
};

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
            title: game.name.unwrap(),
            identifier: game.guid.unwrap(),
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

        let mut add_people_from_entries =
            |entries: Option<Vec<GiantBombResource>>, role: Option<&str>, is_company: bool| {
                entries
                    .into_iter()
                    .flatten()
                    .filter_map(|entry| {
                        entry.api_detail_url.map(|api_url| PartialMetadataPerson {
                            name: entry.name.unwrap(),
                            source: MediaSource::GiantBomb,
                            character: role.map(|r| r.to_string()),
                            identifier: extract_giant_bomb_guid(&api_url),
                            source_specifics: match is_company {
                                false => None,
                                true => Some(PersonSourceSpecifics {
                                    is_giant_bomb_company: Some(true),
                                    ..Default::default()
                                }),
                            },
                            ..Default::default()
                        })
                    })
                    .for_each(|person| people.push(person));
            };

        add_people_from_entries(game.developers, Some(ROLE_DEVELOPER), true);
        add_people_from_entries(game.publishers, Some(ROLE_PUBLISHER), true);
        add_people_from_entries(game.people, None, false);

        let mut groups = Vec::new();
        if let Some(franchises) = game.franchises {
            for franchise in franchises {
                if let Some(api_url) = franchise.api_detail_url {
                    groups.push(CommitMetadataGroupInput {
                        name: franchise.name.unwrap(),
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
                        title: similar.name.unwrap(),
                        lot: MediaLot::VideoGame,
                        source: MediaSource::GiantBomb,
                        identifier: extract_giant_bomb_guid(&api_url),
                        ..Default::default()
                    });
                }
            }
        }

        let mut genres = Vec::new();
        if let Some(game_genres) = game.genres {
            for genre in game_genres {
                genres.push(genre.name.unwrap());
            }
        }
        if let Some(game_themes) = game.themes {
            for theme in game_themes {
                genres.push(theme.name.unwrap());
            }
        }

        let mut platforms = Vec::new();
        if let Some(game_platforms) = game.platforms {
            for platform in game_platforms {
                platforms.push(platform.name.unwrap());
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
            lot: MediaLot::VideoGame,
            title: game.name.unwrap(),
            identifier: game.guid.unwrap(),
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
                    name: company.name.unwrap(),
                    birth_year: company.founded,
                    identifier: company.guid.unwrap(),
                    image: company.image.and_then(|img| img.original_url),
                })?
            }
            "person" => {
                let search_response: GiantBombSearchResponse<GiantBombResource> =
                    response.json().await?;
                self.process_search_response(search_response, |person| PeopleSearchItem {
                    name: person.name.unwrap(),
                    identifier: person.guid.unwrap(),
                    image: person.image.and_then(|img| img.original_url),
                    birth_year: person
                        .birth_date
                        .and_then(|d| extract_year_from_date(Some(d))),
                })?
            }
            _ => return Err(anyhow!("Unsupported search type: {}", search_type)),
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

        let mut add_games_to_related = |games: Option<Vec<GiantBombResource>>, role: &str| {
            games
                .into_iter()
                .flatten()
                .filter_map(|game| {
                    game.api_detail_url.map(|api_url| MetadataPersonRelated {
                        role: role.to_string(),
                        metadata: PartialMetadataWithoutId {
                            lot: MediaLot::VideoGame,
                            title: game.name.unwrap(),
                            source: MediaSource::GiantBomb,
                            identifier: extract_giant_bomb_guid(&api_url),
                            ..Default::default()
                        },
                        ..Default::default()
                    })
                })
                .for_each(|game| related_games.push(game));
        };

        let mut add_franchises_to_related =
            |franchises: Option<Vec<GiantBombResource>>, role: &str| {
                franchises
                    .into_iter()
                    .flatten()
                    .filter_map(|franchise| {
                        franchise
                            .api_detail_url
                            .map(|api_url| MetadataGroupPersonRelated {
                                role: role.to_string(),
                                metadata_group: MetadataGroupWithoutId {
                                    lot: MediaLot::VideoGame,
                                    title: franchise.name.unwrap(),
                                    source: MediaSource::GiantBomb,
                                    identifier: extract_giant_bomb_guid(&api_url),
                                    ..Default::default()
                                },
                            })
                    })
                    .for_each(|franchise| related_groups.push(franchise));
            };

        if is_company {
            add_games_to_related(resource.developed_games, ROLE_DEVELOPER);
            add_games_to_related(resource.published_games, ROLE_PUBLISHER);
        } else {
            add_games_to_related(resource.games, ROLE_PERSON);
            add_franchises_to_related(resource.franchises, ROLE_PERSON);
        }

        let birth_date = match is_company {
            false => parse_date(resource.birth_date),
            true => resource
                .founded
                .map(|year| NaiveDate::from_ymd_opt(year, 1, 1).unwrap()),
        };

        Ok(PersonDetails {
            birth_date,
            name: resource.name.unwrap(),
            source: MediaSource::GiantBomb,
            related_metadata: related_games,
            identifier: resource.guid.unwrap(),
            source_url: resource.site_detail_url,
            related_metadata_groups: related_groups,
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
            name: franchise.name.unwrap(),
            identifier: franchise.guid.unwrap(),
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
            lot: MediaLot::VideoGame,
            title: franchise.name.unwrap(),
            source: MediaSource::GiantBomb,
            identifier: franchise.guid.unwrap(),
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
                        lot: MediaLot::VideoGame,
                        title: game.name.unwrap(),
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
