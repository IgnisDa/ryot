use std::{collections::HashMap, iter::zip, sync::Arc};

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::{EntityAssets, PersonSourceSpecifics, StringIdObject};
use common_utils::{SHOW_SPECIAL_SEASON_NAMES, ryot_log};
use database_models::{
    genre, metadata, metadata_group, metadata_group_to_person, metadata_to_genre,
    metadata_to_metadata, metadata_to_metadata_group, metadata_to_person, person,
    prelude::{
        Genre, Metadata, MetadataGroup, MetadataGroupToPerson, MetadataToGenre, MetadataToMetadata,
        MetadataToMetadataGroup, MetadataToPerson, Person,
    },
};
use dependent_models::MetadataBaseData;
use dependent_provider_utils::{
    details_from_provider, get_metadata_provider, get_non_metadata_provider,
};
use dependent_utility_utils::{
    expire_metadata_details_cache, expire_metadata_group_details_cache, expire_person_details_cache,
};
use enum_models::{MetadataToMetadataRelation, UserNotificationContent};
use futures::{TryFutureExt, try_join};
use itertools::Itertools;
use markdown::{CompileOptions, Options, to_html_with_options as markdown_to_html_opts};
use media_models::{
    CommitMetadataGroupInput, CommitPersonInput, GenreListItem, MediaAssociatedPersonStateChanges,
    MetadataCreator, MetadataCreatorsGroupedByRole, MetadataDetails, PartialMetadataPerson,
    PartialMetadataWithoutId, UniqueMediaIdentifier, UpdateMediaEntityResult,
};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, FromQueryResult, IntoActiveModel,
    ModelTrait, QueryFilter, QueryOrder, QuerySelect, RelationTrait,
    sea_query::{Asterisk, Condition, Expr, JoinType, OnConflict},
};
use supporting_service::SupportingService;
use traits::TraceOk;

mod metadata_commit;
mod update;
use metadata_commit::ensure_metadata_updated;
pub use metadata_commit::*;
pub use update::*;

pub async fn commit_metadata_group(
    input: CommitMetadataGroupInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    match MetadataGroup::find()
        .filter(metadata_group::Column::Lot.eq(input.unique.lot))
        .filter(metadata_group::Column::Source.eq(input.unique.source))
        .filter(metadata_group::Column::Identifier.eq(&input.unique.identifier))
        .one(&ss.db)
        .await?
        .map(|m| StringIdObject { id: m.id })
    {
        Some(m) => Ok(m),
        None => {
            let mut assets = EntityAssets::default();
            if let Some(i) = input.image.clone() {
                assets.remote_images = vec![i];
            }
            let new_group = metadata_group::ActiveModel {
                assets: ActiveValue::Set(assets),
                title: ActiveValue::Set(input.name),
                lot: ActiveValue::Set(input.unique.lot),
                is_partial: ActiveValue::Set(Some(true)),
                source: ActiveValue::Set(input.unique.source),
                identifier: ActiveValue::Set(input.unique.identifier.clone()),
                parts: ActiveValue::Set(input.parts.unwrap_or_default().try_into().unwrap()),
                ..Default::default()
            };
            let new_group = new_group.insert(&ss.db).await?;
            Ok(StringIdObject { id: new_group.id })
        }
    }
}

pub async fn commit_person(
    data: CommitPersonInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    match Person::find()
        .filter(person::Column::Source.eq(data.source))
        .filter(person::Column::Identifier.eq(&data.identifier))
        .filter(match &data.source_specifics {
            None => person::Column::SourceSpecifics.is_null(),
            Some(specifics) if *specifics == PersonSourceSpecifics::default() => {
                person::Column::SourceSpecifics.is_null()
            }
            Some(specifics) => person::Column::SourceSpecifics.eq(Some(specifics.clone())),
        })
        .one(&ss.db)
        .await?
        .map(|p| StringIdObject { id: p.id })
    {
        Some(p) => Ok(p),
        None => {
            let mut assets = EntityAssets::default();
            if let Some(i) = data.image.clone() {
                assets.remote_images = vec![i];
            }
            let source_specifics = match &data.source_specifics {
                None => ActiveValue::Set(None),
                Some(specifics) if *specifics == PersonSourceSpecifics::default() => {
                    ActiveValue::Set(None)
                }
                Some(specifics) => ActiveValue::Set(Some(specifics.clone())),
            };
            let person = person::ActiveModel {
                source_specifics,
                assets: ActiveValue::Set(assets),
                name: ActiveValue::Set(data.name),
                source: ActiveValue::Set(data.source),
                is_partial: ActiveValue::Set(Some(true)),
                identifier: ActiveValue::Set(data.identifier),
                ..Default::default()
            };
            let person = person.insert(&ss.db).await?;
            Ok(StringIdObject { id: person.id })
        }
    }
}

pub async fn generic_metadata(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
    ensure_updated: Option<bool>,
) -> Result<MetadataBaseData> {
    ensure_metadata_updated(metadata_id, ss, ensure_updated).await?;
    let Some(mut meta) = Metadata::find_by_id(metadata_id).one(&ss.db).await.unwrap() else {
        bail!("The record does not exist");
    };

    #[derive(Debug, FromQueryResult)]
    struct PartialCreator {
        id: String,
        role: String,
        character: Option<String>,
    }
    let (genres, crts, suggestions) = try_join!(
        meta.find_related(Genre)
            .order_by_asc(genre::Column::Name)
            .into_model::<GenreListItem>()
            .all(&ss.db)
            .map_err(|_| anyhow!("Failed to fetch genres")),
        MetadataToPerson::find()
            .expr(Expr::col(Asterisk))
            .filter(metadata_to_person::Column::MetadataId.eq(&meta.id))
            .join(
                JoinType::Join,
                metadata_to_person::Relation::Person
                    .def()
                    .on_condition(|left, right| {
                        Condition::all().add(
                            Expr::col((left, metadata_to_person::Column::PersonId))
                                .equals((right, person::Column::Id)),
                        )
                    }),
            )
            .order_by_asc(metadata_to_person::Column::Index)
            .into_model::<PartialCreator>()
            .all(&ss.db)
            .map_err(|_| anyhow!("Failed to fetch creators")),
        MetadataToMetadata::find()
            .select_only()
            .column(metadata_to_metadata::Column::ToMetadataId)
            .filter(metadata_to_metadata::Column::FromMetadataId.eq(&meta.id))
            .filter(
                metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion)
            )
            .into_tuple::<String>()
            .all(&ss.db)
            .map_err(|_| anyhow!("Failed to fetch suggestions")),
    )?;

    let mut creators: HashMap<String, Vec<_>> = HashMap::new();
    for cr in crts {
        let creator = MetadataCreator {
            is_free: false,
            id_or_name: cr.id,
            character: cr.character,
        };
        creators
            .entry(cr.role)
            .and_modify(|e| {
                e.push(creator.clone());
            })
            .or_insert(vec![creator.clone()]);
    }
    if let Some(free_creators) = &meta.free_creators {
        for cr in free_creators.clone() {
            let creator = MetadataCreator {
                is_free: true,
                id_or_name: cr.name,
                ..Default::default()
            };
            creators
                .entry(cr.role)
                .and_modify(|e| {
                    e.push(creator.clone());
                })
                .or_insert(vec![creator.clone()]);
        }
    }
    if let Some(ref mut d) = meta.description {
        *d = markdown_to_html_opts(
            d,
            &Options {
                compile: CompileOptions {
                    allow_dangerous_html: true,
                    allow_dangerous_protocol: true,
                    ..CompileOptions::default()
                },
                ..Options::default()
            },
        )
        .unwrap();
    }
    let creators = creators
        .into_iter()
        .sorted_by(|(k1, _), (k2, _)| k1.cmp(k2))
        .map(|(name, items)| MetadataCreatorsGroupedByRole { name, items })
        .collect_vec();
    Ok(MetadataBaseData {
        genres,
        creators,
        model: meta,
        suggestions,
    })
}
