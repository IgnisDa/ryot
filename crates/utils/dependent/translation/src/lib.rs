use std::sync::Arc;

use anyhow::{Result, anyhow};
use database_models::{
    entity_translation, metadata, metadata_group, person,
    prelude::{EntityTranslation, Metadata, MetadataGroup, Person},
};
use enum_models::{EntityLot, EntityTranslationVariant, MediaLot, MediaSource};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use supporting_service::SupportingService;

pub async fn persist_metadata_translation(
    identifier: &str,
    lot: MediaLot,
    source: MediaSource,
    language: &str,
    values: &[(EntityTranslationVariant, Option<String>)],
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let metadata = Metadata::find()
        .filter(metadata::Column::Identifier.eq(identifier))
        .filter(metadata::Column::Lot.eq(lot))
        .filter(metadata::Column::Source.eq(source))
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Metadata not found"))?;

    persist_entity_translation_values(&metadata.id, EntityLot::Metadata, language, values, ss).await
}

pub async fn persist_metadata_group_translation(
    identifier: &str,
    source: MediaSource,
    language: &str,
    values: &[(EntityTranslationVariant, Option<String>)],
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let group = MetadataGroup::find()
        .filter(metadata_group::Column::Identifier.eq(identifier))
        .filter(metadata_group::Column::Source.eq(source))
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Metadata group not found"))?;

    persist_entity_translation_values(&group.id, EntityLot::MetadataGroup, language, values, ss)
        .await
}

pub async fn persist_person_translation(
    identifier: &str,
    source: MediaSource,
    language: &str,
    values: &[(EntityTranslationVariant, Option<String>)],
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let person = Person::find()
        .filter(person::Column::Identifier.eq(identifier))
        .filter(person::Column::Source.eq(source))
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Person not found"))?;

    persist_entity_translation_values(&person.id, EntityLot::Person, language, values, ss).await
}

async fn persist_entity_translation_values(
    entity_id: &str,
    entity_lot: EntityLot,
    language: &str,
    values: &[(EntityTranslationVariant, Option<String>)],
    ss: &Arc<SupportingService>,
) -> Result<()> {
    for (variant, value) in values {
        upsert_entity_translation(entity_id, entity_lot, language, *variant, value.clone(), ss)
            .await?;
    }
    Ok(())
}

async fn upsert_entity_translation(
    entity_id: &str,
    entity_lot: EntityLot,
    language: &str,
    variant: EntityTranslationVariant,
    value: Option<String>,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let value = value.filter(|v| !v.is_empty());
    if let Some(existing) = EntityTranslation::find()
        .filter(entity_translation::Column::EntityId.eq(entity_id))
        .filter(entity_translation::Column::EntityLot.eq(entity_lot))
        .filter(entity_translation::Column::Language.eq(language))
        .filter(entity_translation::Column::Variant.eq(variant))
        .one(&ss.db)
        .await?
    {
        let mut model: entity_translation::ActiveModel = existing.into();
        model.value = ActiveValue::Set(value);
        model.update(&ss.db).await?;
        return Ok(());
    }

    let mut model = entity_translation::ActiveModel {
        value: ActiveValue::Set(value),
        variant: ActiveValue::Set(variant),
        language: ActiveValue::Set(language.to_string()),
        ..Default::default()
    };
    match entity_lot {
        EntityLot::Person => model.person_id = ActiveValue::Set(Some(entity_id.to_string())),
        EntityLot::Metadata => model.metadata_id = ActiveValue::Set(Some(entity_id.to_string())),
        EntityLot::MetadataGroup => {
            model.metadata_group_id = ActiveValue::Set(Some(entity_id.to_string()))
        }
        _ => {}
    }
    EntityTranslation::insert(model)
        .exec_without_returning(&ss.db)
        .await?;
    Ok(())
}
