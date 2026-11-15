//! Eye SIUA envelope, compatible with scripts/src/crypto/siua.ts.

use std::io::{self, Write};

use aes::cipher::{BlockModeEncrypt, KeyIvInit, block_padding::Pkcs7};
use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::{Compression, write::ZlibEncoder};

const KEY: [u8; 16] = [
    0x93, 0x0f, 0x8b, 0x76, 0x14, 0xa9, 0x44, 0x6b, 0xe3, 0xb7, 0x1f, 0x55, 0x71, 0x3a, 0x85, 0x24,
];
const IV: [u8; 16] = [
    0x28, 0xf1, 0xeb, 0xe0, 0x3c, 0xce, 0xf9, 0xfc, 0xa8, 0xc5, 0xc1, 0xc0, 0x41, 0xe2, 0x22, 0x78,
];
// Placeholder shared with Node; this is not an Android device scan.
const SCAN_CLEAN: &str = "||||||none|0|none||quantity:4|RWX:0|";

pub fn generate(now_ms: u64) -> io::Result<String> {
    encode(now_ms, uuid::Uuid::new_v4())
}

fn encode(now_ms: u64, nonce: uuid::Uuid) -> io::Result<String> {
    let plaintext = ["2.1", &format!("1.9.9|{now_ms}|{nonce}"), SCAN_CLEAN, ""].join("}}");
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(plaintext.as_bytes())?;
    let compressed = encoder.finish()?;
    let encrypted = cbc::Encryptor::<aes::Aes128>::new(&KEY.into(), &IV.into())
        .encrypt_padded_vec::<Pkcs7>(&compressed);
    Ok(STANDARD.encode(encrypted))
}

#[cfg(test)]
pub(crate) fn decode(token: &str) -> String {
    use aes::cipher::BlockModeDecrypt;
    use std::io::Read;

    let bytes = STANDARD.decode(token).unwrap();
    let compressed = cbc::Decryptor::<aes::Aes128>::new(&KEY.into(), &IV.into())
        .decrypt_padded_vec::<Pkcs7>(&bytes)
        .unwrap();
    let mut plaintext = String::new();
    flate2::read::ZlibDecoder::new(compressed.as_slice())
        .read_to_string(&mut plaintext)
        .unwrap();
    plaintext
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_matches_node_plaintext() {
        let nonce = uuid::Uuid::parse_str("11111111-2222-4333-8444-555555555555").unwrap();
        let expected = "2.1}}1.9.9|1731415000123|11111111-2222-4333-8444-555555555555}}||||||none|0|none||quantity:4|RWX:0|}}";
        // Generated offline by scripts/src/crypto/siua.ts with the same inputs.
        let node_token = "P4/UshWeyH+qiIq4IG5JSDsUMfsPNYfYG3tjFZnxMGS3d2xlhGfLGTXCHJLCEF2o27ezZUHJqNbAIj5lvbj9Y0mfB0CYnNNLFG87htavYDM+iLXV3BalXNQmOpbP5QYT";
        assert_eq!(decode(node_token), expected);
        assert_eq!(decode(&encode(1731415000123, nonce).unwrap()), expected);
    }

    #[test]
    fn each_generation_has_a_new_uuid_even_at_the_same_millisecond() {
        let first = generate(1731415000123).unwrap();
        let second = generate(1731415000123).unwrap();
        assert_ne!(first, second);
        for token in [first, second] {
            let plaintext = decode(&token);
            let parts: Vec<_> = plaintext.split("}}").collect();
            assert_eq!(parts[0], "2.1");
            assert_eq!(parts[2], SCAN_CLEAN);
            assert_eq!(parts[3], "");
            let fields: Vec<_> = parts[1].split('|').collect();
            assert_eq!(fields[0], "1.9.9");
            assert_eq!(fields[1], "1731415000123");
            let nonce = uuid::Uuid::parse_str(fields[2]).unwrap();
            assert_eq!(nonce.get_version_num(), 4);
            assert_eq!(nonce.get_variant(), uuid::Variant::RFC4122);
        }
    }
}
