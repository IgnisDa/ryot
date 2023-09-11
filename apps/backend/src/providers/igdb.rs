use std::sync::OnceLock;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use itertools::Itertools;
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_with::{formats::Flexible, serde_as, TimestampSeconds};
use surf::{http::headers::AUTHORIZATION, Client};

use crate::{
    config::VideoGameConfig,
    entities::metadata_group,
    migrator::{MetadataLot, MetadataSource},
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataCreator, MetadataImage,
            MetadataImageLot, MetadataImages, MetadataVideo, MetadataVideoSource, PartialMetadata,
            VideoGameSpecifics,
        },
        IdObject, NamedObject, SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{get_base_http_client, get_now_timestamp},
};

static URL: &str = "https://api.igdb.com/v4/";
static IMAGE_URL: &str = "https://images.igdb.com/igdb/image/upload/";
static AUTH_URL: &str = "https://id.twitch.tv/oauth2/token";

static GAME_FIELDS: &str = "
fields
    id,
    name,
    summary,
    cover.*,
    first_release_date,
    involved_companies.company.name,
    involved_companies.company.logo.*,
    involved_companies.*,
    artworks.*,
    rating,
    similar_games.id,
    similar_games.name,
    similar_games.cover.*,
    platforms.name,
    collection.id,
    videos.*,
    genres.*;
where version_parent = null;
";

#[derive(Serialize, Deserialize, Debug)]
struct IgdbCompany {
    name: String,
    logo: Option<IgdbImage>,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbVideo {
    video_id: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbInvolvedCompany {
    company: IgdbCompany,
    developer: bool,
    publisher: bool,
    porting: bool,
    supporting: bool,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbImage {
    image_id: String,
}

#[serde_as]
#[derive(Serialize, Deserialize, Debug)]
struct IgdbSearchResponse {
    id: i32,
    name: Option<String>,
    rating: Option<Decimal>,
    games: Option<Vec<IgdbSearchResponse>>,
    summary: Option<String>,
    cover: Option<IgdbImage>,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    first_release_date: Option<DateTimeUtc>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    videos: Option<Vec<IgdbVideo>>,
    artworks: Option<Vec<IgdbImage>>,
    genres: Option<Vec<NamedObject>>,
    platforms: Option<Vec<NamedObject>>,
    similar_games: Option<Vec<IgdbSearchResponse>>,
    version_parent: Option<i32>,
    collection: Option<IdObject>,
    #[serde(flatten)]
    rest_data: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct IgdbService {
    image_url: String,
    image_size: String,
    config: VideoGameConfig,
    page_limit: i32,
}

impl MediaProviderLanguages for IgdbService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl IgdbService {
    pub async fn new(config: &VideoGameConfig, page_limit: i32) -> Self {
        Self {
            image_url: IMAGE_URL.to_owned(),
            image_size: config.igdb.image_size.to_string(),
            config: config.clone(),
            page_limit,
        }
    }
}

#[async_trait]
impl MediaProvider for IgdbService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let client = get_client(&self.config).await;
        let req_body = format!(
            r#"
{field}
where id = {id};
            "#,
            field = GAME_FIELDS,
            id = identifier
        );
        let mut rsp = client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let mut details: Vec<IgdbSearchResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let detail = details.pop().unwrap();
        let groups = match detail.collection.as_ref() {
            Some(c) => vec![self.group_details(&c.id.to_string()).await?],
            None => vec![],
        };
        let mut game_details = self.igdb_response_to_search_response(detail);
        game_details.groups = groups;
        Ok(game_details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let client = get_client(&self.config).await;
        let req_body = format!(
            r#"
{field}
search "{query}";
limit {limit};
offset: {offset};
            "#,
            field = GAME_FIELDS,
            limit = self.page_limit,
            offset = (page - 1) * self.page_limit
        );
        let mut rsp = client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let search: Vec<IgdbSearchResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        // DEV: API does not return total count
        let total = 100;

        let resp = search
            .into_iter()
            .map(|r| {
                let a = self.igdb_response_to_search_response(r);
                MediaSearchItem {
                    identifier: a.identifier,
                    title: a.title,
                    image: a
                        .images
                        .into_iter()
                        .map(|i| match i.url {
                            StoredUrl::S3(_u) => unreachable!(),
                            StoredUrl::Url(u) => u,
                        })
                        .collect_vec()
                        .get(0)
                        .cloned(),
                    publish_year: a.publish_year,
                }
            })
            .collect_vec();
        Ok(SearchResults {
            details: SearchDetails {
                total,
                next_page: Some(page + 1),
            },
            items: resp,
        })
    }
}

impl IgdbService {
    async fn group_details(
        &self,
        identifier: &str,
    ) -> Result<(metadata_group::Model, Vec<PartialMetadata>)> {
        let client = get_client(&self.config).await;
        let req_body = format!(
            r"
fields
    id,
    name,
    games.id,
    games.name,
    games.cover.*,
    games.version_parent;
where id = {id};
            ",
            id = identifier
        );
        let details: IgdbSearchResponse = client
            .post("collections")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?
            .body_json::<Vec<_>>()
            .await
            .map_err(|e| anyhow!(e))?
            .pop()
            .unwrap();
        let items = details
            .games
            .unwrap_or_default()
            .into_iter()
            .flat_map(|g| {
                if g.version_parent.is_some() {
                    None
                } else {
                    Some(PartialMetadata {
                        identifier: g.id.to_string(),
                        title: g.name.unwrap(),
                        image: g.cover.map(|c| self.get_cover_image_url(c.image_id)),
                        source: MetadataSource::Igdb,
                        lot: MetadataLot::VideoGame,
                    })
                }
            })
            .collect_vec();
        Ok((
            metadata_group::Model {
                id: 0,
                display_images: vec![],
                parts: items.len().try_into().unwrap(),
                identifier: details.id.to_string(),
                title: details.name.unwrap_or_default(),
                description: None,
                images: MetadataImages(vec![]),
                lot: MetadataLot::VideoGame,
                source: MetadataSource::Igdb,
            },
            items,
        ))
    }

    fn igdb_response_to_search_response(&self, item: IgdbSearchResponse) -> MediaDetails {
        let mut images = Vec::from_iter(item.cover.map(|a| MetadataImage {
            url: StoredUrl::Url(self.get_cover_image_url(a.image_id)),
            lot: MetadataImageLot::Poster,
        }));
        let additional_images =
            item.artworks
                .unwrap_or_default()
                .into_iter()
                .map(|a| MetadataImage {
                    url: StoredUrl::Url(self.get_cover_image_url(a.image_id)),
                    lot: MetadataImageLot::Poster,
                });
        images.extend(additional_images);
        let creators = item
            .involved_companies
            .into_iter()
            .flatten()
            .map(|ic| {
                let role = if ic.developer {
                    "Development"
                } else if ic.publisher {
                    "Publishing"
                } else if ic.porting {
                    "Porting"
                } else if ic.supporting {
                    "Supporting"
                } else {
                    "Unknown"
                };
                MetadataCreator {
                    name: ic.company.name,
                    image: ic
                        .company
                        .logo
                        .map(|u| self.get_cover_image_url(u.image_id)),
                    role: role.to_owned(),
                }
            })
            .unique()
            .collect();
        let videos = item
            .videos
            .unwrap_or_default()
            .into_iter()
            .map(|vid| MetadataVideo {
                identifier: StoredUrl::Url(vid.video_id),
                source: MetadataVideoSource::Youtube,
            })
            .collect_vec();
        MediaDetails {
            identifier: item.id.to_string(),
            lot: MetadataLot::VideoGame,
            source: MetadataSource::Igdb,
            production_status: "Released".to_owned(),
            title: item.name.unwrap(),
            description: item.summary,
            creators,
            images,
            videos,
            publish_date: item.first_release_date.map(|d| d.date_naive()),
            publish_year: item.first_release_date.map(|d| d.year()),
            genres: item
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .unique()
                .collect(),
            specifics: MediaSpecifics::VideoGame(VideoGameSpecifics {
                platforms: item
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.name)
                    .collect(),
            }),
            suggestions: item
                .similar_games
                .unwrap_or_default()
                .into_iter()
                .map(|g| PartialMetadata {
                    title: g.name.unwrap(),
                    image: g.cover.map(|c| self.get_cover_image_url(c.image_id)),
                    identifier: g.id.to_string(),
                    lot: MetadataLot::VideoGame,
                    source: MetadataSource::Igdb,
                })
                .collect(),
            provider_rating: item.rating,
            groups: vec![],
            is_nsfw: None,
        }
    }

    fn get_cover_image_url(&self, hash: String) -> String {
        format!("{}{}/{}.jpg", self.image_url, self.image_size, hash)
    }
}

#[derive(Deserialize, Debug, Serialize)]
struct Credentials {
    access_token: String,
    expires_at: u128,
}

async fn get_access_token(config: &VideoGameConfig) -> Credentials {
    let mut access_res = surf::post(AUTH_URL)
        .query(&json!({
            "client_id": config.twitch.client_id.to_owned(),
            "client_secret": config.twitch.client_secret.to_owned(),
            "grant_type": "client_credentials".to_owned(),
        }))
        .unwrap()
        .await
        .unwrap();
    #[derive(Deserialize, Serialize, Default, Debug)]
    struct AccessResponse {
        access_token: String,
        token_type: String,
        expires_in: u128,
    }
    let access = access_res
        .body_json::<AccessResponse>()
        .await
        .unwrap_or_default();
    let expires_at = get_now_timestamp() + (access.expires_in * 1000);
    let access_token = format!("{} {}", access.token_type, access.access_token);
    Credentials {
        access_token,
        expires_at,
    }
}

async fn get_client(config: &VideoGameConfig) -> Client {
    static TOKEN: OnceLock<Credentials> = OnceLock::new();
    async fn set_and_return_token(config: &VideoGameConfig) -> String {
        let creds = get_access_token(config).await;
        let tok = creds.access_token.clone();
        TOKEN.set(creds).ok();
        tok
    }
    let access_token = if let Some(credential_details) = TOKEN.get() {
        if credential_details.expires_at < get_now_timestamp() {
            tracing::debug!("Access token has expired, refreshing...");
            set_and_return_token(config).await
        } else {
            credential_details.access_token.clone()
        }
    } else {
        set_and_return_token(config).await
    };
    get_base_http_client(
        URL,
        vec![
            ("Client-ID".into(), config.twitch.client_id.to_owned()),
            (AUTHORIZATION, access_token),
        ],
    )
}
