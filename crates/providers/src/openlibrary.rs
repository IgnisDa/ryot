use anyhow::{anyhow, Result};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::{Datelike, NaiveDate};
use common_models::{PersonSourceSpecifics, SearchDetails};
use common_utils::{ryot_log, PAGE_SIZE};
use convert_case::{Case, Casing};
use dependent_models::{PeopleSearchResponse, SearchResults};
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    BookSpecifics, MetadataDetails, MetadataImageForMediaDetails, MetadataPerson,
    MetadataPersonRelated, MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId,
    PeopleSearchItem,
};
use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::json;
use traits::{MediaProvider, };

static URL: &str = "https://openlibrary.org";
static IMAGE_BASE_URL: &str = "https://covers.openlibrary.org";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct OpenlibraryEditionsResponse {
    entries: Option<Vec<OpenlibraryEdition>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct OpenlibraryEdition {
    title: Option<String>,
    key: String,
    publish_date: Option<String>,
    number_of_pages: Option<i32>,
    covers: Option<Vec<i64>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum OpenlibraryDescription {
    Text(String),
    Nested {
        #[serde(rename = "type")]
        key: String,
        value: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct BookSearchResults {
    total: i32,
    items: Vec<BookSearchItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BookSearchItem {
    identifier: String,
    title: String,
    description: Option<String>,
    author_names: Vec<String>,
    genres: Vec<String>,
    images: Vec<String>,
    publish_year: Option<i32>,
    publish_date: Option<NaiveDate>,
    book_specifics: BookSpecifics,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct OpenlibraryKey {
    key: String,
}

#[derive(Debug, Clone)]
pub struct OpenlibraryService {
    image_url: String,
    image_size: String,
    client: Client,
}

#[derive(Serialize, Deserialize, Debug)]
struct OpenMediaLibrarySearchResponse {
    num_found: i32,
    docs: Vec<MetadataSearchOpenlibraryBook>,
}

#[derive(Serialize, Deserialize, Debug)]
struct OpenAuthorLibrarySearchResponse {
    #[serde(alias = "numFound")]
    num_found: i32,
    docs: Vec<PeopleSearchOpenlibraryAuthor>,
}

impl OpenlibraryService {
    pub async fn new(config: &config::OpenlibraryConfig) -> Self {
        let client = get_base_http_client(None);
        Self {
            image_url: IMAGE_BASE_URL.to_owned(),
            image_size: config.cover_image_size.to_string(),
            client,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PeopleSearchOpenlibraryAuthor {
    key: String,
    name: String,
    birth_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PersonDetailsOpenlibraryLink {
    url: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
struct PersonDetailsOpenlibraryAuthor {
    key: String,
    bio: Option<OpenlibraryDescription>,
    name: String,
    photos: Option<Vec<i64>>,
    links: Option<Vec<PersonDetailsOpenlibraryLink>>,
    birth_date: Option<String>,
    death_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MetadataDetailsOpenlibraryAuthor {
    author: OpenlibraryKey,
    #[serde(rename = "type", flatten)]
    role: Option<OpenlibraryKey>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum MetadataDetailsOpenlibraryAuthorResponse {
    Flat(OpenlibraryKey),
    Nested(MetadataDetailsOpenlibraryAuthor),
}
#[derive(Debug, Serialize, Deserialize, Clone)]
struct MetadataDetailsOpenlibraryBook {
    key: String,
    description: Option<OpenlibraryDescription>,
    title: String,
    covers: Option<Vec<i64>>,
    authors: Option<Vec<MetadataDetailsOpenlibraryAuthorResponse>>,
    subjects: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct MetadataSearchOpenlibraryBook {
    key: String,
    title: String,
    author_name: Option<Vec<String>>,
    cover_i: Option<i64>,
    publish_year: Option<Vec<i32>>,
    first_publish_year: Option<i32>,
    number_of_pages_median: Option<i32>,
}

#[async_trait]
impl MediaProvider for OpenlibraryService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<PeopleSearchResponse> {
        let page = page.unwrap_or(1);
        let rsp = self
            .client
            .get(format!("{}/search/authors.json", URL))
            .query(&json!({
                "q": query.to_owned(),
                "offset": (page - 1) * PAGE_SIZE,
                "limit": PAGE_SIZE,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: OpenAuthorLibrarySearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .docs
            .into_iter()
            .map(|d| PeopleSearchItem {
                identifier: get_key(&d.key),
                name: d.name,
                image: None,
                birth_year: d.birth_date.and_then(|b| parse_date(&b)).map(|d| d.year()),
            })
            .collect_vec();
        let data = SearchResults {
            details: SearchDetails {
                total: search.num_found,
                next_page: if search.num_found - ((page) * PAGE_SIZE) > 0 {
                    Some(page + 1)
                } else {
                    None
                },
            },
            items: resp,
        };
        Ok(data)
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<MetadataPerson> {
        let rsp = self
            .client
            .get(format!("{}/authors/{}.json", URL, identifier))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: PersonDetailsOpenlibraryAuthor = rsp.json().await.map_err(|e| anyhow!(e))?;
        let identifier = get_key(&data.key);
        let description = data.bio.map(|d| match d {
            OpenlibraryDescription::Text(s) => s,
            OpenlibraryDescription::Nested { value, .. } => value,
        });
        let images = data
            .photos
            .unwrap_or_default()
            .into_iter()
            .filter(|c| c > &0)
            .map(|c| self.get_author_cover_image_url(c))
            .unique()
            .collect();
        let author_works: OpenlibraryEditionsResponse = self
            .client
            .get(format!("{}/authors/{}/works.json", URL, identifier))
            .query(&serde_json::json!({ "limit": 600 }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut related = vec![];
        for entry in author_works.entries.unwrap_or_default() {
            if let Some(title) = entry.title {
                let image = entry
                    .covers
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|c| c > &0)
                    .map(|c| self.get_book_cover_image_url(c))
                    .collect_vec()
                    .first()
                    .cloned();
                related.push(MetadataPersonRelated {
                    character: None,
                    role: "Author".to_owned(),
                    metadata: PartialMetadataWithoutId {
                        title,
                        image,
                        lot: MediaLot::Book,
                        is_recommendation: None,
                        identifier: get_key(&entry.key),
                        source: MediaSource::Openlibrary,
                    },
                })
            }
        }
        ryot_log!(debug, "Found {} related works.", related.len());
        let name = data.name;
        Ok(MetadataPerson {
            related,
            place: None,
            description,
            gender: None,
            name: name.clone(),
            images: Some(images),
            source_specifics: None,
            identifier: identifier.clone(),
            source: MediaSource::Openlibrary,
            birth_date: data.birth_date.and_then(|b| parse_date(&b)),
            death_date: data.death_date.and_then(|b| parse_date(&b)),
            source_url: Some(format!(
                "https://openlibrary.org/authors/{}/{}",
                identifier, name
            )),
            website: data
                .links
                .and_then(|l| l.first().and_then(|a| a.url.clone())),
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .client
            .get(format!("{}/works/{}.json", URL, identifier))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;

        ryot_log!(debug, "Getting work details.");
        let data: MetadataDetailsOpenlibraryBook = rsp.json().await.map_err(|e| anyhow!(e))?;

        let identifier = get_key(&data.key);
        ryot_log!(debug, "Getting edition details.");
        let rsp = self
            .client
            .get(format!("{}/works/{}/editions.json", URL, identifier))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let editions: OpenlibraryEditionsResponse = rsp.json().await.map_err(|e| anyhow!(e))?;

        let entries = editions.entries.unwrap_or_default();
        let all_pages = entries
            .iter()
            .filter_map(|f| f.number_of_pages)
            .collect_vec();
        let num_pages = if all_pages.is_empty() {
            0
        } else {
            all_pages.iter().sum::<i32>() / all_pages.len() as i32
        };
        let first_release_date = entries
            .iter()
            .filter_map(|f| f.publish_date.clone())
            .filter_map(|f| Self::parse_date(&f))
            .min();
        let mut people = vec![];
        for a in data.authors.unwrap_or_default().iter() {
            let (key, role) = match a {
                MetadataDetailsOpenlibraryAuthorResponse::Flat(s) => {
                    (s.key.to_owned(), "Author".to_owned())
                }
                MetadataDetailsOpenlibraryAuthorResponse::Nested(s) => (
                    s.author.key.to_owned(),
                    s.role
                        .as_ref()
                        .map(|r| r.key.clone())
                        .unwrap_or_else(|| "Author".to_owned()),
                ),
            };
            people.push(PartialMetadataPerson {
                identifier: get_key(&key),
                name: "".to_owned(),
                role,
                source: MediaSource::Openlibrary,
                character: None,
                source_specifics: None,
            });
        }
        let description = data.description.map(|d| match d {
            OpenlibraryDescription::Text(s) => s,
            OpenlibraryDescription::Nested { value, .. } => value,
        });

        let mut images = vec![];
        for c in data.covers.iter().flatten() {
            images.push(*c);
        }
        for c in entries
            .iter()
            .flat_map(|e| e.covers.to_owned().unwrap_or_default())
        {
            images.push(c);
        }

        let images = images
            .into_iter()
            .filter(|c| c > &0)
            .map(|c| MetadataImageForMediaDetails {
                image: self.get_book_cover_image_url(c),
            })
            .unique()
            .collect();

        let genres = data
            .subjects
            .unwrap_or_default()
            .into_iter()
            .flat_map(|s| s.split(", ").map(|d| d.to_case(Case::Title)).collect_vec())
            .collect_vec();

        #[derive(Debug, Serialize, Deserialize)]
        struct OpenlibraryPartialResponse {
            #[serde(rename = "0")]
            data: String,
        }

        ryot_log!(debug, "Getting suggestion details.");
        // DEV: Reverse engineered the API
        let html = self
            .client
            .get(format!("{}/partials.json", URL))
            .query(&json!({ "workid": identifier, "_component": "RelatedWorkCarousel" }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<OpenlibraryPartialResponse>()
            .await
            .map_err(|e| anyhow!(e))?
            .data;

        let mut suggestions = vec![];

        let fragment = Html::parse_document(&html);

        let carousel_item_selector = Selector::parse(".book.carousel__item").unwrap();
        let image_selector = Selector::parse("img.bookcover").unwrap();
        let identifier_selector = Selector::parse("a[href]").unwrap();

        for item in fragment.select(&carousel_item_selector) {
            let identifier = get_key(
                &item
                    .select(&identifier_selector)
                    .next()
                    .and_then(|a| a.value().attr("href"))
                    .map(|href| href.to_string())
                    .unwrap(),
            );
            if let Some(n) = item
                .select(&image_selector)
                .next()
                .and_then(|img| img.value().attr("alt"))
                .map(|alt| alt.to_string())
            {
                let name = n
                    .split(" by ")
                    .next()
                    .map(|name| name.trim().to_string())
                    .unwrap();
                let image = item
                    .select(&image_selector)
                    .next()
                    .and_then(|img| img.value().attr("src"))
                    .map(|src| src.to_string());
                suggestions.push(PartialMetadataWithoutId {
                    title: name,
                    image,
                    identifier,
                    lot: MediaLot::Book,
                    source: MediaSource::Openlibrary,
                    is_recommendation: None,
                });
            }
        }
        let identifier = get_key(&data.key);
        Ok(MetadataDetails {
            people,
            genres,
            description,
            suggestions,
            url_images: images,
            lot: MediaLot::Book,
            title: data.title.clone(),
            identifier: identifier.clone(),
            source: MediaSource::Openlibrary,
            publish_year: first_release_date.map(|d| d.year()),
            source_url: Some(format!(
                "https://openlibrary.org/works/{}/{}",
                identifier, data.title
            )),
            book_specifics: Some(BookSpecifics {
                pages: Some(num_pages),
            }),
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let fields = [
            "key",
            "title",
            "author_name",
            "cover_i",
            "first_publish_year",
        ]
        .join(",");
        let rsp = self
            .client
            .get(format!("{}/search.json", URL))
            .query(&json!({
                "q": query.to_owned(),
                "fields": fields,
                "offset": (page - 1) * PAGE_SIZE,
                "limit": PAGE_SIZE,
                "type": "work".to_owned(),
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: OpenMediaLibrarySearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .docs
            .into_iter()
            .map(|d| {
                let images = Vec::from_iter(d.cover_i.map(|f| self.get_book_cover_image_url(f)));
                BookSearchItem {
                    identifier: get_key(&d.key),
                    title: d.title,
                    description: None,
                    author_names: d.author_name.unwrap_or_default(),
                    genres: vec![],
                    publish_year: d.first_publish_year,
                    publish_date: None,
                    book_specifics: BookSpecifics {
                        pages: d.number_of_pages_median,
                    },
                    images,
                }
            })
            .collect_vec();
        let data = BookSearchResults {
            total: search.num_found,
            items: resp,
        };
        let next_page = if search.num_found - ((page) * PAGE_SIZE) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: data.total,
                next_page,
            },
            items: data
                .items
                .into_iter()
                .map(|b| MetadataSearchItem {
                    identifier: b.identifier,
                    title: b.title,
                    image: b.images.first().cloned(),
                    publish_year: b.publish_year,
                })
                .collect(),
        })
    }
}

impl OpenlibraryService {
    fn get_book_cover_image_url(&self, c: i64) -> String {
        self.get_cover_image_url("b", c)
    }

    fn get_author_cover_image_url(&self, c: i64) -> String {
        self.get_cover_image_url("a", c)
    }

    fn get_cover_image_url(&self, t: &str, c: i64) -> String {
        format!(
            "{}/{}/id/{}-{}.jpg?default=false",
            self.image_url, t, c, self.image_size
        )
    }

    fn parse_date(input: &str) -> Option<NaiveDate> {
        let formats = ["%b %d, %Y", "%Y", "%b %d, %Y"];
        for format in formats.iter() {
            if let Ok(date) = NaiveDate::parse_from_str(input, format) {
                return Some(date);
            }
        }
        None
    }

    /// Get a book's ID from its ISBN
    pub async fn id_from_isbn(&self, isbn: &str) -> Option<String> {
        self.client
            .get(format!("{}/isbn/{}.json", URL, isbn))
            .send()
            .await
            .ok()?
            .json::<MetadataDetailsOpenlibraryBook>()
            .await
            .ok()
            .map(|data| get_key(&data.key))
    }
}

pub fn get_key(key: &str) -> String {
    key.split('/')
        .collect_vec()
        .last()
        .cloned()
        .unwrap()
        .to_owned()
}

fn parse_date(date_str: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date_str, "%e %B %Y").ok()
}
