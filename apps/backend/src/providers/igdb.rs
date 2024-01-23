use std::{collections::HashMap, fs, path::PathBuf};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use database::{MetadataLot, MetadataSource};
use itertools::Itertools;
use rust_decimal::Decimal;
use rust_iso3166::from_numeric;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use serde_with::{formats::Flexible, serde_as, TimestampSeconds};
use surf::{http::headers::AUTHORIZATION, Client};

use crate::{
    entities::metadata_group::MetadataGroupWithoutId,
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataImageForMediaDetails,
            MetadataImageLot, MetadataPerson, MetadataVideo, MetadataVideoSource,
            PartialMetadataPerson, PartialMetadataWithoutId, VideoGameSpecifics,
        },
        IdObject, NamedObject, SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{get_base_http_client, TEMP_DIR},
};

static URL: &str = "https://api.igdb.com/v4/";
static IMAGE_URL: &str = "https://images.igdb.com/igdb/image/upload/";
static AUTH_URL: &str = "https://id.twitch.tv/oauth2/token";
static FILE: &str = "igdb.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Settings {
    access_token: String,
}

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

#[derive(Serialize, Deserialize, Debug, Clone)]
struct IgdbWebsite {
    url: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbCompany {
    id: i32,
    name: String,
    logo: Option<IgdbImage>,
    country: Option<i32>,
    description: Option<String>,
    websites: Option<Vec<IgdbWebsite>>,
    developed: Option<Vec<IgdbItemResponse>>,
    published: Option<Vec<IgdbItemResponse>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbVideo {
    video_id: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbInvolvedCompany {
    id: i32,
    company: IgdbCompany,
    developer: bool,
    publisher: bool,
    porting: bool,
    supporting: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct IgdbImage {
    image_id: String,
}

#[serde_as]
#[derive(Serialize, Deserialize, Debug)]
struct IgdbItemResponse {
    id: i32,
    name: Option<String>,
    rating: Option<Decimal>,
    games: Option<Vec<IgdbItemResponse>>,
    summary: Option<String>,
    cover: Option<IgdbImage>,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    first_release_date: Option<DateTimeUtc>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    videos: Option<Vec<IgdbVideo>>,
    artworks: Option<Vec<IgdbImage>>,
    genres: Option<Vec<NamedObject>>,
    platforms: Option<Vec<NamedObject>>,
    similar_games: Option<Vec<IgdbItemResponse>>,
    version_parent: Option<i32>,
    collection: Option<IdObject>,
    #[serde(flatten)]
    rest_data: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone)]
pub struct IgdbService {
    image_url: String,
    image_size: String,
    config: config::VideoGameConfig,
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
    pub async fn new(config: &config::VideoGameConfig, page_limit: i32) -> Self {
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
    async fn group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
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
        let details: IgdbItemResponse = client
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
                    Some(PartialMetadataWithoutId {
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
            MetadataGroupWithoutId {
                display_images: vec![],
                parts: items.len().try_into().unwrap(),
                identifier: details.id.to_string(),
                title: details.name.unwrap_or_default(),
                description: None,
                images: vec![],
                lot: MetadataLot::VideoGame,
                source: MetadataSource::Igdb,
            },
            items,
        ))
    }

    async fn person_details(&self, identity: &PartialMetadataPerson) -> Result<MetadataPerson> {
        let client = get_client(&self.config).await;
        let req_body = format!(
            r#"
fields
    *,
    company.id,
    company.name,
    company.country,
    company.description,
    company.logo.*,
    company.websites.url,
    company.start_date,
    company.url,
    company.developed.id,
    company.developed.name,
    company.developed.cover.image_id,
    company.published.id,
    company.published.name,
    company.published.cover.image_id;
where id = {id};
            "#,
            id = identity.identifier
        );
        let mut rsp = client
            .post("involved_companies")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;
        let mut details: Vec<IgdbInvolvedCompany> =
            rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let detail = details.pop().map(|ic| ic.company).unwrap();
        let mut related = detail
            .published
            .unwrap_or_default()
            .into_iter()
            .map(|r| {
                let image = r.cover.map(|a| self.get_cover_image_url(a.image_id));
                (
                    "Publishing".to_owned(),
                    PartialMetadataWithoutId {
                        title: r.name.unwrap(),
                        identifier: r.id.to_string(),
                        source: MetadataSource::Igdb,
                        lot: MetadataLot::VideoGame,
                        image,
                    },
                )
            })
            .collect_vec();
        related.extend(detail.developed.unwrap_or_default().into_iter().map(|r| {
            let image = r.cover.map(|a| self.get_cover_image_url(a.image_id));
            (
                "Development".to_owned(),
                PartialMetadataWithoutId {
                    title: r.name.unwrap(),
                    identifier: r.id.to_string(),
                    source: MetadataSource::Igdb,
                    lot: MetadataLot::VideoGame,
                    image,
                },
            )
        }));
        Ok(MetadataPerson {
            identifier: detail.id.to_string(),
            name: detail.name,
            images: Some(Vec::from_iter(
                detail.logo.map(|l| self.get_cover_image_url(l.image_id)),
            )),
            source: MetadataSource::Igdb,
            description: detail.description,
            place: detail
                .country
                .and_then(from_numeric)
                .map(|c| c.name.to_owned()),
            website: detail
                .websites
                .unwrap_or_default()
                .first()
                .map(|i| i.url.clone()),
            related,
            birth_date: None,
            death_date: None,
            gender: None,
        })
    }

    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let client = get_client(&self.config).await;
        let req_body = format!(
            r#"{field} where id = {id};"#,
            field = GAME_FIELDS,
            id = identifier
        );
        let mut rsp = client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;
        let mut details: Vec<IgdbItemResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let detail = details.pop().unwrap();
        let groups = match detail.collection.as_ref() {
            Some(c) => vec![c.id.to_string()],
            None => vec![],
        };
        let mut game_details = self.igdb_response_to_search_response(detail);
        game_details.group_identifiers = groups;
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
        let count_req_body =
            format!(r#"fields id; where version_parent = null; search "{query}"; limit: 500;"#);
        let mut rsp = client
            .post("games")
            .body_string(count_req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let search_count_resp: Vec<IgdbItemResponse> =
            rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let total = search_count_resp.len().try_into().unwrap();

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

        let search: Vec<IgdbItemResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .into_iter()
            .map(|r| {
                let a = self.igdb_response_to_search_response(r);
                MediaSearchItem {
                    identifier: a.identifier,
                    title: a.title,
                    image: a.url_images.first().map(|i| i.image.clone()),
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
    fn igdb_response_to_search_response(&self, item: IgdbItemResponse) -> MediaDetails {
        let mut images = Vec::from_iter(item.cover.map(|a| MetadataImageForMediaDetails {
            image: self.get_cover_image_url(a.image_id),
            lot: MetadataImageLot::Poster,
        }));
        let additional_images =
            item.artworks
                .unwrap_or_default()
                .into_iter()
                .map(|a| MetadataImageForMediaDetails {
                    image: self.get_cover_image_url(a.image_id),
                    lot: MetadataImageLot::Poster,
                });
        images.extend(additional_images);
        let people = item
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
                PartialMetadataPerson {
                    identifier: ic.id.to_string(),
                    source: MetadataSource::Igdb,
                    role: role.to_owned(),
                    character: None,
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
            title: item.name.unwrap(),
            description: item.summary,
            people,
            url_images: images,
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
                .map(|g| PartialMetadataWithoutId {
                    title: g.name.unwrap(),
                    image: g.cover.map(|c| self.get_cover_image_url(c.image_id)),
                    identifier: g.id.to_string(),
                    lot: MetadataLot::VideoGame,
                    source: MetadataSource::Igdb,
                })
                .collect(),
            provider_rating: item.rating,
            group_identifiers: vec![],
            is_nsfw: None,
            creators: vec![],
            s3_images: vec![],
            production_status: None,
            original_language: None,
        }
    }

    fn get_cover_image_url(&self, hash: String) -> String {
        format!("{}{}/{}.jpg", self.image_url, self.image_size, hash)
    }
}

async fn get_access_token(config: &config::VideoGameConfig) -> String {
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
    format!("{} {}", access.token_type, access.access_token)
}

async fn get_client(config: &config::VideoGameConfig) -> Client {
    let path = PathBuf::new().join(TEMP_DIR).join(FILE);
    let settings = if !path.exists() {
        let tok = get_access_token(config).await;
        let settings = Settings { access_token: tok };
        let data_to_write = serde_json::to_string(&settings).unwrap();
        fs::write(path, data_to_write).unwrap();
        settings
    } else {
        let data = fs::read_to_string(path).unwrap();
        serde_json::from_str(&data).unwrap()
    };
    get_base_http_client(
        URL,
        vec![
            ("Client-ID".into(), config.twitch.client_id.to_owned()),
            (AUTHORIZATION, settings.access_token),
        ],
    )
}
