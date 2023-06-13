use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::Client;

use crate::{
    config::MoviesTmdbConfig,
    media::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl,
    },
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    traits::MediaProvider,
    utils::{
        convert_date_to_year, convert_string_to_date,
        tmdb::{self, save_all_images, TmdbCredit},
        NamedObject,
    },
};

use super::MovieSpecifics;

#[derive(Debug, Clone)]
pub struct TmdbService {
    client: Client,
    image_url: String,
}

impl TmdbService {
    pub async fn new(config: &MoviesTmdbConfig) -> Self {
        let (client, image_url) = tmdb::get_client_config(&config.url, &config.access_token).await;
        Self { client, image_url }
    }
}

#[async_trait]
impl MediaProvider for TmdbService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbMovie {
            id: i32,
            title: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            release_date: String,
            runtime: i32,
            genres: Vec<NamedObject>,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}", &identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbMovie = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbCreditsResponse {
            cast: Vec<TmdbCredit>,
            crew: Vec<TmdbCredit>,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}/credits", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let credits: TmdbCreditsResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut all_creators = credits
            .cast
            .clone()
            .into_iter()
            .flat_map(|g| {
                if let (Some(n), Some(r)) = (g.name, g.known_for_department) {
                    Some(MetadataCreator {
                        name: n,
                        role: r,
                        image_urls: Vec::from_iter(
                            g.profile_path.map(|p| self.get_cover_image_url(&p)),
                        ),
                    })
                } else {
                    None
                }
            })
            .unique()
            .collect::<Vec<_>>();
        all_creators.extend(credits.crew.into_iter().flat_map(|g| {
            if let (Some(n), Some(r)) = (g.name, g.known_for_department) {
                Some(MetadataCreator {
                    name: n,
                    role: r,
                    image_urls: Vec::from_iter(
                        g.profile_path.map(|p| self.get_cover_image_url(&p)),
                    ),
                })
            } else {
                None
            }
        }));
        let mut image_ids = Vec::from_iter(data.poster_path);
        if let Some(u) = data.backdrop_path {
            image_ids.push(u);
        }
        save_all_images(&self.client, identifier, &mut image_ids).await?;

        Ok(MediaDetails {
            identifier: data.id.to_string(),
            lot: MetadataLot::Movie,
            source: MetadataSource::Tmdb,
            title: data.title,
            genres: data.genres.into_iter().map(|g| g.name).collect(),
            creators: Vec::from_iter(all_creators),
            images: image_ids
                .into_iter()
                .unique()
                .map(|p| MetadataImage {
                    url: MetadataImageUrl::Url(self.get_cover_image_url(&p)),
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            publish_year: convert_date_to_year(&data.release_date),
            publish_date: convert_string_to_date(&data.release_date),
            description: Some(data.overview),
            specifics: MediaSpecifics::Movie(MovieSpecifics {
                runtime: Some(data.runtime),
            }),
        })
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct TmdbMovie {
            id: i32,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            overview: Option<String>,
            title: String,
            release_date: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct TmdbSearchResponse {
            total_results: i32,
            results: Vec<TmdbMovie>,
            total_pages: i32,
        }
        let mut rsp = self
            .client
            .get("search/movie")
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": "en-US".to_owned(),
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| {
                let images = Vec::from_iter(d.poster_path.map(|p| self.get_cover_image_url(&p)));
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    lot: MetadataLot::Movie,
                    title: d.title,
                    publish_year: convert_date_to_year(&d.release_date),
                    images,
                }
            })
            .collect::<Vec<_>>();
        let next_page = if page < search.total_pages {
            Some(page + 1)
        } else {
            None
        };
        Ok(MediaSearchResults {
            total: search.total_results,
            next_page,
            items: resp.to_vec(),
        })
    }
}

impl TmdbService {
    fn get_cover_image_url(&self, c: &str) -> String {
        format!("{}{}{}", self.image_url, "original", c)
    }
}
