use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use surf::Client;

use crate::{
    media::resolver::{MediaSearchItem, MediaSearchResults},
    shows::{ShowEpisode, ShowSeason},
    utils::{
        convert_date_to_year, convert_option_path_to_vec, get_data_parallely_from_sources,
        get_tmdb_config,
    },
};

use super::ShowSpecifics;

#[derive(Debug, Clone)]
pub struct TmdbService {
    client: Client,
    image_url: String,
}

impl TmdbService {
    pub async fn new(url: &str, access_token: &str) -> Self {
        let (client, image_url) = get_tmdb_config(url, access_token).await;
        Self { client, image_url }
    }
}

impl TmdbService {
    pub async fn show_details(&self, identifier: &str) -> Result<MediaSearchItem> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbAuthor {
            name: String,
        }
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
            production_companies: Vec<TmdbAuthor>,
            first_air_date: String,
            seasons: Vec<TmdbSeasonNumber>,
        }
        let mut rsp = self
            .client
            .get(format!("tv/{}", &identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbShow = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let poster_images =
            convert_option_path_to_vec(data.poster_path.map(|p| self.get_cover_image_url(&p)));
        let backdrop_images =
            convert_option_path_to_vec(data.backdrop_path.map(|p| self.get_cover_image_url(&p)));
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbEpisode {
            id: i32,
            name: String,
            episode_number: i32,
            overview: Option<String>,
            air_date: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbSeason {
            id: i32,
            name: String,
            overview: Option<String>,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            air_date: String,
            season_number: i32,
            episodes: Vec<TmdbEpisode>,
        }
        let seasons: Vec<TmdbSeason> =
            get_data_parallely_from_sources(&data.seasons, &self.client, |s| {
                format!("tv/{}/season/{}", identifier.to_owned(), s.season_number)
            })
            .await;
        Ok(MediaSearchItem {
            identifier: data.id.to_string(),
            title: data.name,
            description: data.overview,
            author_names: vec![],
            publish_year: convert_date_to_year(&data.first_air_date),
            show_specifics: Some(ShowSpecifics {
                runtime: None,
                seasons: seasons
                    .into_iter()
                    .map(|s| ShowSeason {
                        id: s.id,
                        name: s.name,
                        publish_year: convert_date_to_year(&s.air_date),
                        overview: s.overview,
                        poster_path: s.poster_path,
                        backdrop_path: s.backdrop_path,
                        season_number: s.season_number,
                        episodes: s
                            .episodes
                            .into_iter()
                            .map(|e| ShowEpisode {
                                id: e.id,
                                name: e.name,
                                publish_year: convert_date_to_year(&e.air_date),
                                overview: e.overview,
                                episode_number: e.episode_number,
                            })
                            .collect(),
                    })
                    .collect(),
            }),
            movie_specifics: None,
            book_specifics: None,
            poster_images,
            backdrop_images,
        })
    }

    pub async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        #[derive(Serialize, Deserialize)]
        struct Query {
            query: String,
            page: i32,
            language: String,
        }
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
        }
        let mut rsp = self
            .client
            .get("search/tv")
            .query(&Query {
                query: query.to_owned(),
                page: page.unwrap_or(1),
                language: "en-US".to_owned(),
            })
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| {
                let poster_images = if let Some(c) = d.poster_path {
                    vec![self.get_cover_image_url(&c)]
                } else {
                    vec![]
                };
                let backdrop_images = if let Some(c) = d.backdrop_path {
                    vec![self.get_cover_image_url(&c)]
                } else {
                    vec![]
                };
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    title: d.name,
                    description: d.overview,
                    author_names: vec![],
                    publish_year: convert_date_to_year(&d.first_air_date),
                    show_specifics: Some(ShowSpecifics {
                        runtime: None,
                        seasons: vec![],
                    }),
                    movie_specifics: None,
                    book_specifics: None,
                    poster_images,
                    backdrop_images,
                }
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults {
            total: search.total_results,
            items: resp,
        })
    }

    fn get_cover_image_url(&self, c: &str) -> String {
        format!("{}{}{}", self.image_url, "original", c)
    }
}
