use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::AudibleConfig,
    graphql::AUTHOR,
    media::{
        resolver::{MediaSearchItem, MediaSearchResults},
        LIMIT,
    },
    utils::{
        convert_date_to_year, convert_option_path_to_vec, convert_string_to_date, NamedObject,
    },
};

use super::AudioBookSpecifics;

#[derive(Debug, Serialize, Deserialize, SimpleObject)]
pub struct AudiblePoster {
    #[serde(rename = "2400")]
    image: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, SimpleObject)]
pub struct AudibleItem {
    asin: String,
    title: String,
    authors: Vec<NamedObject>,
    product_images: AudiblePoster,
    merchandising_summary: Option<String>,
    release_date: Option<String>,
}

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
            production_companies: Vec<NamedObject>,
            release_date: String,
            runtime: i32,
            genres: Vec<NamedObject>,
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
            title: String,
            num_results: i32,
            page: i32,
            response_groups: String,
            image_sizes: String,
            products_sort_by: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct AudibleSearchResponse {
            total_results: i32,
            products: Vec<AudibleItem>,
        }
        let mut rsp = self
            .client
            .get("")
            .query(&Query {
                title: query.to_owned(),
                num_results: LIMIT,
                page: page.unwrap_or(1),
                response_groups: ["contributors", "media", "product_attrs"].join(","),
                image_sizes: ["2400"].join(","),
                products_sort_by: "Relevance".to_owned(),
            })
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: AudibleSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .products
            .into_iter()
            .map(|d| {
                let poster_images = convert_option_path_to_vec(d.product_images.image);
                let release_date = d.release_date.unwrap_or_default();
                MediaSearchItem {
                    identifier: d.asin,
                    title: d.title,
                    description: d.merchandising_summary,
                    author_names: d.authors.into_iter().map(|a| a.name).collect(),
                    genres: vec![],
                    publish_year: convert_date_to_year(&release_date),
                    publish_date: convert_string_to_date(&release_date),
                    movie_specifics: None,
                    book_specifics: None,
                    show_specifics: None,
                    video_game_specifics: None,
                    audio_books_specifics: None,
                    poster_images,
                    backdrop_images: vec![],
                }
            })
            .collect::<Vec<_>>();
        dbg!(&resp);
        Ok(MediaSearchResults {
            total: search.total_results,
            items: resp,
        })
    }
}
