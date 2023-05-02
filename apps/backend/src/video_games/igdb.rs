use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use surf::Client;

use crate::{
    config::VideoGameConfig,
    media::resolver::{MediaSearchItem, MediaSearchResults},
    utils::{convert_date_to_year, convert_option_path_to_vec, convert_string_to_date, igdb},
};

use super::VideoGameSpecifics;

#[derive(Debug, Clone)]
pub struct IgdbService {
    client: Client,
    image_url: String,
}

impl IgdbService {
    pub async fn new(video_game_config: &VideoGameConfig) -> Self {
        let client = igdb::get_client_config(
            &video_game_config.twitch.access_token_url,
            &video_game_config.twitch.client_id,
            &video_game_config.twitch.client_secret,
            &video_game_config.igdb.base_url,
        )
        .await;
        Self {
            client,
            image_url: "".to_owned(),
        }
    }
}

impl IgdbService {
    pub async fn details(&self, identifier: &str) -> Result<MediaSearchItem> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct IgdbCreator {
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct IgdbMovie {
            id: i32,
            title: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            production_companies: Vec<IgdbCreator>,
            release_date: String,
            runtime: i32,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: IgdbMovie = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let poster_images =
            convert_option_path_to_vec(data.poster_path.map(|p| self.get_cover_image_url(&p)));
        let backdrop_images =
            convert_option_path_to_vec(data.backdrop_path.map(|p| self.get_cover_image_url(&p)));
        let detail = MediaSearchItem {
            identifier: data.id.to_string(),
            title: data.title,
            author_names: data
                .production_companies
                .into_iter()
                .map(|p| p.name)
                .collect(),
            poster_images,
            backdrop_images,
            publish_year: convert_date_to_year(&data.release_date),
            publish_date: convert_string_to_date(&data.release_date),
            description: Some(data.overview),
            movie_specifics: None,
            video_game_specifics: Some(VideoGameSpecifics {
                runtime: Some(data.runtime),
            }),
            book_specifics: None,
            show_specifics: None,
        };
        Ok(detail)
    }

    pub async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        #[derive(Serialize, Deserialize)]
        struct Query {
            query: String,
            page: i32,
            language: String,
        }
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct IgdbMovie {
            id: i32,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            overview: Option<String>,
            title: String,
            release_date: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct IgdbSearchResponse {
            total_results: i32,
            results: Vec<IgdbMovie>,
        }
        let mut rsp = self
            .client
            .get("search/movie")
            .query(&Query {
                query: query.to_owned(),
                page: page.unwrap_or(1),
                language: "en-US".to_owned(),
            })
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: IgdbSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| {
                let backdrop_images = convert_option_path_to_vec(
                    d.backdrop_path.map(|p| self.get_cover_image_url(&p)),
                );
                let poster_images =
                    convert_option_path_to_vec(d.poster_path.map(|p| self.get_cover_image_url(&p)));
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    title: d.title,
                    description: d.overview,
                    author_names: vec![],
                    publish_year: convert_date_to_year(&d.release_date),
                    publish_date: convert_string_to_date(&d.release_date),
                    video_game_specifics: Some(VideoGameSpecifics { runtime: None }),
                    movie_specifics: None,
                    book_specifics: None,
                    show_specifics: None,
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
