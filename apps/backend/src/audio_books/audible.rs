use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::AudibleConfig,
    graphql::AUTHOR,
    media::resolver::{MediaSearchItem, MediaSearchResults},
    utils::{
        convert_date_to_year, convert_option_path_to_vec, convert_string_to_date,
        media_tracker::TmdbNamedObject,
    },
};

use super::AudioBookSpecifics;

#[derive(Debug, Clone)]
pub struct AudibleService {
    client: Client,
}

impl AudibleService {
    pub fn new(config: &AudibleConfig) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, format!("{}/trackona", AUTHOR))
            .unwrap()
            .set_base_url(Url::parse(&config.url).unwrap())
            .try_into()
            .unwrap();
        Self { client }
    }
}

impl AudibleService {
    pub async fn details(&self, identifier: &str) -> Result<MediaSearchItem> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbMovie {
            id: i32,
            title: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            production_companies: Vec<TmdbNamedObject>,
            release_date: String,
            runtime: i32,
            genres: Vec<TmdbNamedObject>,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbMovie = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let poster_images = convert_option_path_to_vec(data.poster_path);
        let backdrop_images = convert_option_path_to_vec(data.backdrop_path);
        let detail = MediaSearchItem {
            identifier: data.id.to_string(),
            title: data.title,
            genres: data.genres.into_iter().map(|g| g.name).collect(),
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
            audio_books_specifics: Some(AudioBookSpecifics {
                runtime: Some(data.runtime),
            }),
            movie_specifics: None,
            video_game_specifics: None,
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
        let search: TmdbSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| {
                let backdrop_images = convert_option_path_to_vec(d.backdrop_path);
                let poster_images = convert_option_path_to_vec(d.poster_path);
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    title: d.title,
                    description: d.overview,
                    // TODO: Populate with correct data
                    author_names: vec![],
                    genres: vec![],
                    publish_year: convert_date_to_year(&d.release_date),
                    publish_date: convert_string_to_date(&d.release_date),
                    movie_specifics: None,
                    book_specifics: None,
                    show_specifics: None,
                    video_game_specifics: None,
                    audio_books_specifics: None,
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
}
