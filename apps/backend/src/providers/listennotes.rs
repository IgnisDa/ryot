use std::collections::HashMap;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use itertools::Itertools;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_with::{formats::Flexible, serde_as, TimestampMilliSeconds};
use surf::Client;

use crate::{
    config::PodcastConfig,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataCreator, MetadataImage,
            MetadataImageUrl, PodcastEpisode, PodcastSpecifics,
        },
        SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::PAGE_LIMIT,
};

pub static URL: &str = "https://listen-api.listennotes.com/api/v2/";

#[derive(Debug, Clone)]
pub struct ListennotesService {
    client: Client,
    genres: HashMap<i32, String>,
}

impl MediaProviderLanguages for ListennotesService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl ListennotesService {
    pub async fn new(config: &PodcastConfig) -> Self {
        let (client, genres) = utils::get_client_config(URL, &config.listennotes.api_token).await;
        Self { client, genres }
    }
}

#[async_trait]
impl MediaProvider for ListennotesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut details = self
            .details_with_paginated_episodes(identifier, None, None)
            .await?;
        match details.specifics {
            MediaSpecifics::Podcast(ref mut specifics) => loop {
                if specifics.total_episodes > i32::try_from(specifics.episodes.len()).unwrap() {
                    let last_episode = specifics.episodes.last().unwrap();
                    let next_pub_date = last_episode.publish_date;
                    let episode_number = last_episode.number;
                    let new_details = self
                        .details_with_paginated_episodes(
                            identifier,
                            Some(next_pub_date),
                            Some(episode_number),
                        )
                        .await?;
                    match new_details.specifics {
                        MediaSpecifics::Podcast(p) => {
                            specifics.episodes.extend(p.episodes);
                        }
                        _ => unreachable!(),
                    }
                } else {
                    break;
                }
            },
            _ => unreachable!(),
        };
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title_original: String,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            image: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct SearchResponse {
            total: i32,
            results: Vec<Podcast>,
            next_offset: Option<i32>,
        }
        let mut rsp = self
            .client
            .get("search")
            .query(&json!({
                "q": query.to_owned(),
                "offset": (page - 1) * PAGE_LIMIT,
                "type": "podcast"
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;

        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let total = search.total;

        let next_page = search.next_offset.map(|_| page + 1);
        let resp = search
            .results
            .into_iter()
            .map(|r| MediaSearchItem {
                identifier: r.id,
                lot: MetadataLot::Podcast,
                title: r.title_original,
                image: r.image,
                publish_year: r.publish_date.map(|r| r.year()),
            })
            .collect_vec();
        Ok(SearchResults {
            total,
            items: resp,
            next_page,
        })
    }
}

impl ListennotesService {
    // The API does not return all the episodes for a podcast, and instead needs to be
    // paginated through. It also does not return the episode number. So we have to
    // handle those manually.
    pub async fn details_with_paginated_episodes(
        &self,
        identifier: &str,
        next_pub_date: Option<i64>,
        episode_number: Option<i32>,
    ) -> Result<MediaDetails> {
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title: String,
            description: Option<String>,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            publisher: Option<String>,
            image: Option<String>,
            episodes: Vec<PodcastEpisode>,
            genre_ids: Vec<i32>,
            total_episodes: i32,
        }
        let mut rsp = self
            .client
            .get(format!("podcasts/{}", identifier))
            .query(&json!({
                "sort": "oldest_first",
                "next_episode_pub_date": next_pub_date.map(|d| d.to_string()).unwrap_or_else(|| "null".to_owned())
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let d: Podcast = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        Ok(MediaDetails {
            identifier: d.id,
            title: d.title,
            production_status: "Released".to_owned(),
            description: d.description,
            lot: MetadataLot::Podcast,
            source: MetadataSource::Listennotes,
            creators: Vec::from_iter(d.publisher.map(|p| MetadataCreator {
                name: p,
                role: "Publishing".to_owned(),
                image_urls: vec![],
            })),
            genres: d
                .genre_ids
                .into_iter()
                .filter_map(|g| self.genres.get(&g).cloned())
                .unique()
                .collect(),
            images: Vec::from_iter(d.image.map(|a| MetadataImage {
                url: MetadataImageUrl::Url(a),
                lot: MetadataImageLot::Poster,
            })),
            publish_year: d.publish_date.map(|r| r.year()),
            publish_date: d.publish_date.map(|d| d.date_naive()),
            specifics: MediaSpecifics::Podcast(PodcastSpecifics {
                episodes: d
                    .episodes
                    .into_iter()
                    .enumerate()
                    .map(|(idx, episode)| PodcastEpisode {
                        number: (episode_number.unwrap_or_default() + idx as i32 + 1),
                        runtime: episode.runtime.map(|r| r / 60), // the api responds in seconds
                        ..episode
                    })
                    .collect(),
                total_episodes: d.total_episodes,
            }),
        })
    }
}

mod utils {
    use std::{collections::HashMap, env, fs};

    use crate::utils::{get_base_http_client, read_file_to_json};

    use super::*;

    pub async fn get_client_config(url: &str, api_token: &str) -> (Client, HashMap<i32, String>) {
        let path = env::temp_dir().join("listennotes.json");
        let client: Client = get_base_http_client(url, vec![("X-ListenAPI-Key", api_token)]);
        #[derive(Debug, Serialize, Deserialize, Default)]
        struct Genre {
            id: i32,
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Default)]
        struct GenreResponse {
            genres: Vec<Genre>,
        }
        let genres = if let Some(details) = read_file_to_json::<HashMap<i32, String>>(&path) {
            details
        } else {
            let mut rsp = client.get("genres").await.unwrap();
            let data: GenreResponse = rsp.body_json().await.unwrap_or_default();
            let mut genres = HashMap::new();
            for genre in data.genres {
                genres.insert(genre.id, genre.name);
            }
            fs::write(path, serde_json::to_string(&genres).unwrap()).ok();
            genres
        };
        (client, genres)
    }
}
