use anyhow::Result;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
    pub jti: Uuid,
}

impl Claims {
    pub fn new(sub: String, token_valid_for_days: i64) -> Self {
        let iat = Utc::now();
        let exp = iat + Duration::try_days(token_valid_for_days).unwrap();

        Self {
            sub,
            iat: iat.timestamp().try_into().unwrap(),
            exp: exp.timestamp().try_into().unwrap(),
            jti: Uuid::new_v4(),
        }
    }
}

pub fn sign(user_id: String, jwt_secret: &str, token_valid_for_days: i64) -> Result<String> {
    let tokens = encode(
        &Header::default(),
        &Claims::new(user_id, token_valid_for_days),
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?;
    Ok(tokens)
}

pub fn verify(token: &str, jwt_secret: &str) -> Result<Claims> {
    let claims = decode(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)?;
    Ok(claims)
}
