# Litmatch desktop client

Tauri application with a Rust backend and React/TypeScript interface.

## Litmatch request headers

Rust automatically generates `X-SIUA` for every request built by `lit::build_get`,
including POST metadata requests and self-profile requests. Each token uses the
request timestamp in milliseconds and a fresh UUIDv4, then zlib compression,
AES-128-CBC with PKCS7 padding, and standard Base64. The account form no longer
accepts SIUA. Existing SIUA values remain in storage for compatibility but are
not read when building requests.

The scan payload is the same fixed `SCAN_CLEAN` placeholder as the Node scripts;
it does not measure an Android device. Compressed bytes need not match the Android
zlib implementation exactly. Tests verify the decoded envelope against a Node
fixture, not acceptance by the live server. This client always adds SIUA without
fetching Android's `litEnableSIUA` setting.

`X-DFPID` still uses the optional account value entered in the form. This change
does not fetch or refresh DFPID.

## Account form

Add/edit forms do not accept a User ID. Editing preserves an existing ID in the
database; new accounts start without one. Login currently saves IM credentials,
but does not automatically copy the Litmatch User ID into the account record.

## Verification

From `apps`:

```sh
npm run typecheck
npm test
npm run build
cd src-tauri
cargo test --offline --lib
cargo test --offline --lib lit::tests::generated_headers_interoperate_with_node -- --ignored --nocapture
```

The last check requires Node.js 22.18+ and uses synthetic data without API calls.
