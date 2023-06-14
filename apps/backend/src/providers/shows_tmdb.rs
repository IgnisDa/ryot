use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::Client;

use crate::{
    config::ShowsTmdbConfig,
    media::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl,
    },
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    models::{ShowEpisode, ShowSeason, ShowSpecifics},
    traits::MediaProvider,
    utils::{
        convert_date_to_year, convert_string_to_date,
        tmdb::{self, save_all_images, TmdbCredit},
        NamedObject,
    },
};

#[derive(Debug, Clone)]
pub struct TmdbService {
    client: Client,
    image_url: String,
}

impl TmdbService {
    pub async fn new(config: &ShowsTmdbConfig) -> Self {
        let (client, image_url) = tmdb::get_client_config(&config.url, &config.access_token).await;
        Self { client, image_url }
    }
}

#[async_trait]
impl MediaProvider for TmdbService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbSeasonNumber {
            season_number: i32,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbShow {
            id: i32,
            name: String,
            overview: Option<String>,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            first_air_date: Option<String>,
            seasons: Vec<TmdbSeasonNumber>,
            genres: Vec<NamedObject>,
        }
        let mut rsp = self
            .client
            .get(format!("tv/{}", &identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbShow = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut image_ids = Vec::from_iter(data.poster_path);
        if let Some(u) = data.backdrop_path {
            image_ids.push(u);
        }
        save_all_images(&self.client, "tv", identifier, &mut image_ids).await?;

        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbEpisode {
            id: i32,
            name: String,
            episode_number: i32,
            still_path: Option<String>,
            overview: Option<String>,
            air_date: Option<String>,
            runtime: Option<i32>,
            guest_stars: Vec<TmdbCredit>,
            crew: Vec<TmdbCredit>,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbSeason {
            id: i32,
            name: String,
            overview: Option<String>,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            air_date: Option<String>,
            season_number: i32,
            episodes: Vec<TmdbEpisode>,
        }
        let mut seasons = vec![];
        for s in data.seasons.iter() {
            let mut rsp = self
                .client
                .get(format!(
                    "tv/{}/season/{}",
                    identifier.to_owned(),
                    s.season_number
                ))
                .await
                .map_err(|e| anyhow!(e))?;
            let data: TmdbSeason = rsp.body_json().await.map_err(|e| anyhow!(e))?;
            seasons.push(data);
        }
        let author_names = seasons
            .iter()
            .flat_map(|s| {
                s.episodes
                    .iter()
                    .flat_map(|e| {
                        let mut gs = e
                            .guest_stars
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
                            .collect::<Vec<_>>();
                        let crew = e
                            .crew
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
                            .collect::<Vec<_>>();
                        gs.extend(crew);
                        Vec::from_iter(gs)
                    })
                    .collect::<Vec<_>>()
            })
            .unique()
            .collect::<Vec<_>>();
        Ok(MediaDetails {
            identifier: data.id.to_string(),
            title: data.name,
            lot: MetadataLot::Show,
            source: MetadataSource::Tmdb,
            description: data.overview,
            creators: author_names,
            genres: data.genres.into_iter().map(|g| g.name).unique().collect(),
            publish_date: convert_string_to_date(&data.first_air_date.clone().unwrap_or_default()),
            images: image_ids
                .into_iter()
                .unique()
                .map(|p| MetadataImage {
                    url: MetadataImageUrl::Url(self.get_cover_image_url(&p)),
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            publish_year: convert_date_to_year(&data.first_air_date.unwrap_or_default()),
            specifics: MediaSpecifics::Show(ShowSpecifics {
                seasons: seasons
                    .into_iter()
                    .map(|s| {
                        let poster_images =
                            Vec::from_iter(s.poster_path.map(|p| self.get_cover_image_url(&p)));
                        let backdrop_images =
                            Vec::from_iter(s.backdrop_path.map(|p| self.get_cover_image_url(&p)));
                        ShowSeason {
                            id: s.id,
                            name: s.name,
                            publish_date: convert_string_to_date(&s.air_date.unwrap_or_default()),
                            overview: s.overview,
                            poster_images,
                            backdrop_images,
                            season_number: s.season_number,
                            episodes: s
                                .episodes
                                .into_iter()
                                .map(|e| {
                                    let poster_images = Vec::from_iter(
                                        e.still_path.map(|p| self.get_cover_image_url(&p)),
                                    );
                                    ShowEpisode {
                                        id: e.id,
                                        name: e.name,
                                        runtime: e.runtime,
                                        publish_date: convert_string_to_date(
                                            &e.air_date.unwrap_or_default(),
                                        ),
                                        overview: e.overview,
                                        episode_number: e.episode_number,
                                        poster_images,
                                    }
                                })
                                .collect(),
                        }
                    })
                    .collect(),
            }),
        })
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct TmdbShow {
            id: i32,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            overview: Option<String>,
            name: String,
            first_air_date: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct TmdbSearchResponse {
            total_results: i32,
            results: Vec<TmdbShow>,
            total_pages: i32,
        }
        let mut rsp = self
            .client
            .get("search/tv")
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
                    lot: MetadataLot::Show,
                    title: d.name,
                    publish_year: convert_date_to_year(&d.first_air_date),
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
