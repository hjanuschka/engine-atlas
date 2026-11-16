# Engine Atlas - browser contributor map spec

## Goal

A public, opt-in map of Chromium, Firefox, WebKit and DevTools contributors, designed to help people find nearby peers and eventually organize meetups. Contributors claim a project badge using an eligible email: Chromium's [AUTHORS](https://github.com/chromium/chromium/blob/main/AUTHORS), WebKit's [contributors.json](https://github.com/WebKit/WebKit/blob/main/metadata/contributors.json), DevTools' [AUTHORS](https://github.com/ChromeDevTools/devtools-frontend/blob/main/AUTHORS), or an exact commit-author email in the public [Firefox/gecko-dev mirror](https://github.com/mozilla/gecko-dev). Mozilla's `AUTHORS` points to a credits page without an email roster; Firefox commit-author eligibility includes synced WPT commits and must not be presented as an official Mozilla contributor credential. There are no passwords or persistent logins: creating, editing, hiding, and deleting a profile all start with a fresh email verification link.

**Important distinction:** Public source data establishes eligibility for an email address, not current employment, endorsement by a browser project, or the identity behind a display name. Only people who explicitly publish a profile appear on the map. The footer presents it as a community directory, not an official project site.

## Visual direction

Use [vacation.januschka.com](https://vacation.januschka.com/) as the look-and-feel reference: near-black background (`#121212`), muted gray text, amber/yellow accent (`#FFC107`), JetBrains Mono, rounded terminal-like panels with amber borders and subtle glow, short `// section` labels, and compact chips. Keep the map itself uncluttered; amber markers and restrained geographic colors should stand out against a dark globe. Mobile layout should prioritize a usable map and a collapsible contributor list. Honor reduced-motion settings and provide keyboard-accessible controls.

Landing page: concise headline, globe/map as the focal point, visible contributor count, search/filter controls, and a prominent "Add yourself" action. A short privacy note near the action explains that publication is voluntary and location is approximate. Show a useful list view if WebGL is unavailable; do not block the directory behind animation or a third-party map service.

## MVP user journeys

1. A visitor browses the globe, rotates/zooms to a region, selects a marker/cluster, and opens a contributor card. Search by public display name, city/region, and interests; filter by availability/status. Offer an accessible list view with the same filters.
2. A contributor enters an email on "Add yourself" or "Edit my profile". The server checks the cached Chromium/WebKit/DevTools rosters and Firefox commit search *before* calling SES. A single link grants all matching project badges; if Firefox lookup fails but a roster matches, a link can still be sent with those known badges and a later verification can add Firefox. The response is the same whether the address is eligible or not: "If this address is eligible, check your inbox." Never reveal whether an address is in AUTHORS or has a profile.
3. An eligible contributor receives a short-lived, single-use link. Following it opens a form to create a profile or edit the existing one for that email. A GET to the link must not consume it (mail scanners often prefetch links). The first explicit "Continue" POST redeems it and starts a short-lived, scoped editing session. Invalid/expired/used links lead to a request-new-link screen.
4. The contributor chooses a public display name, approximate location, status, interests, and optional links/bio, previews what will be visible, consents to publication, and saves. Their marker and card become visible. Saving changes, hiding, or deleting the profile requires a fresh verification flow when the session ends.
5. If the email later disappears from a roster, the existing public profile remains visible until the owner hides/deletes it; issuing *new* edit links is blocked pending a documented support/recovery policy. This avoids silently erasing published information while not treating old membership as perpetual verification. Provide a private admin/support path to resolve removals or upstream address changes, not a public override.

No account creation, password, social login, public contributor-email list, or automatic profile generation from source data.

## Public profile and privacy

- Required: display name; approximate location (city/region/country selected from geocoder suggestions or equivalent structured place); explicit publication consent.
- Optional: short bio, interests (bounded free-text tags or curated tags), status/availability (e.g. open to meeting, open to mentoring, just browsing), public website/GitHub link. Status is user-supplied, not inferred from activity. Avoid free-form contact details by default.
- Store exact normalized email privately as a unique profile owner key; never include it in public HTML, API responses, map data, or analytics. A display name need not match AUTHORS. Explain clearly that the email is used only for eligibility and edit links. On first save, store the MD5 Gravatar hash and show it as the avatar; the hash is public by Gravatar's design but is still derived from the email, so it is generated only for profiles the owner published, never for unpublished ones.
- Store public location at city/region granularity, not an address or live GPS coordinates. Use an approximate city-center coordinate for map placement; round/coarsen if necessary. Show the place label and "approximate location" in cards. Do not collect browser geolocation by default.
- Only published profiles appear in public endpoints/search/counts. Include a hide/unpublish action and a permanent delete action in the verified edit screen. Delete removes profile data; keep only minimal abuse-prevention logs with retention limits.
- Render user text safely (escape HTML, reject dangerous URL schemes), enforce field length limits, and add a report/contact mechanism for impersonation or abuse. Publish a privacy notice including data retention, map/geocoder provider, and contact for deletion requests.

## Contributor eligibility and refresh

- Chromium: `https://chromium.googlesource.com/chromium/src/+/main/AUTHORS?format=TEXT` (base64-encoded raw file). WebKit: `https://raw.githubusercontent.com/WebKit/WebKit/main/metadata/contributors.json` (individual `emails` arrays only). DevTools: `https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/AUTHORS` (same AUTHORS format as Chromium). Both are eligibility lists, **not** the map dataset. Refresh each once per day independently and retain the last good snapshot on failure. Firefox: GitHub's commit search for `repo:mozilla/gecko-dev author-email:<email>`, checking the exact returned commit-author address (not just the hit count); cache positive lookups for 24 hours and negatives for one hour. Search failures or incomplete results fail closed. Use a server-side `GITHUB_TOKEN` if rate limits require it.
- Download and parse it once every 24 hours in a background job, including both individuals and any other documented email-bearing entries only if the parser can unambiguously extract an individual address. Inspect actual upstream formatting before implementing the parser; add fixtures for comments, duplicates, Unicode names, and malformed lines. Normalize email for lookup using a documented policy (trim whitespace and case-fold for lookup, preserve original for display in private admin tools); do not accidentally accept substrings or domain-only matches.
- Validate nonempty, plausible file size and parsed count; build a new allowlist in a transaction and atomically swap only after validation. Record last successful refresh, source revision/ETag, counts, and errors. Do not replace a good list with an empty or partially parsed response. Use conditional requests where supported.
- Refresh once at startup if there is no cached list, then every 24 hours. Keep the last known good copy across container restarts in persistent storage. If there has never been a valid snapshot, verification requests must fail closed with a temporary-unavailable message. If the last valid snapshot is older than 72 hours, pause new link issuance and alert an operator rather than relying on stale eligibility. Provide a manual refresh command and health status.
- Never expose the parsed allowlist through public APIs or logs. Do not fetch AUTHORS on every form submission. Clarify in the UI that contributors recently added upstream may take up to a day to become eligible.

## Email verification and abuse controls

- Generate cryptographically random tokens (at least 256 bits), store only a hash, bind each to normalized email and purpose (profile edit), expire after 15-30 minutes, and redeem atomically once. Replace/invalidate outstanding links for the same email on re-request as appropriate. A link alone must not publish anything until the owner submits the form.
- Use an HTTPS absolute URL derived from a configured canonical origin, not an untrusted Host header. Avoid logging tokens, and set `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on verification/edit pages. Strip the token from the URL after redemption. Scoped edit session: secure HttpOnly SameSite cookie, CSRF protection for writes, short idle/absolute timeout, no general account session.
- Rate-limit requests per IP and per normalized email, throttle sends and retries, cap global send volume, and monitor SES bounce/complaint rates. Keep responses and timing reasonably uniform for eligible/ineligible and existing/new profiles; avoid exposing distinctions in errors or metrics. A bot challenge can be added if abuse warrants it.
- Use Amazon SES for transactional links only. Credentials/configuration are injected at runtime through environment variables or container secrets (prefer task/instance roles if deployed on AWS); never committed to the repo or baked into the image. Configuration: SES region, verified sender, canonical site URL, and credentials/role. Document SES sandbox and production sending requirements. Degrade gracefully when SES is unconfigured: show a service-unavailable response, do not pretend an email was sent. Provide a local dev mail sink with no real sends.

## Map and discovery

- Use MapLibre GL JS with OpenFreeMap's public dark vector style and globe projection. No account, key, credit card or billing required. Cluster markers and provide an accessible list fallback when WebGL or the tile service is unavailable. Keep OpenFreeMap/OpenMapTiles/OpenStreetMap attribution visible. OpenFreeMap's public service has no SLA; tile requests go to OpenFreeMap/Cloudflare, so disclose that before launch. Do not bulk-download tiles; self-host or switch providers if reliability demands it.
- Public API returns only published, consented fields and approximate coordinates. Cluster dense cities; on selection, show a list of profiles rather than overlapping pins. Keep filtering/search usable at all zoom levels and on touch devices. Attribution must remain visible.
- Meetups are a later phase: data model and navigation should leave room for opt-in event pages and city-based discovery, but MVP does not collect RSVPs, exact venues, direct messages, or notifications.

## Suggested implementation shape

A small web app with a server-rendered shell plus client-side map; one backend service for eligibility, verification, profiles, and the public directory; a persistent SQLite database (reassess PostgreSQL if scaling demands it); an isolated daily refresh worker/scheduler; SES as outbound mail. The app and worker can share one image with distinct commands. Run them with `yarn start` locally or Docker Compose for self-hosting; ensure only one scheduled worker runs (or use a DB lock). Use migrations, a persistent database volume, readiness/health checks, graceful restarts, and a reverse proxy/TLS endpoint. No SES secrets in `compose.yaml`; supply an example env file with placeholders only. Back up the DB and document restore and deploy steps. Implementation framework and map library remain to be chosen after a small proof of concept.

Minimum tables: `authors_snapshots` (source metadata, refresh timestamp/status), `eligible_emails` (normalized email, snapshot ID), `profiles` (private normalized email; public fields, coordinates, publication state, timestamps), `verification_tokens` (token hash, email, expiry, redeemed timestamp), and rate-limit/send metadata with expiry. Do not include eligible emails in public exports. Index email lookups and published-profile geospatial/list queries.

Potential endpoints (exact names can change): `GET /` directory; `GET /api/profiles` filtered public data; `POST /verification/request` generic response; `GET /verify?token=...` confirm screen; `POST /verify` redeem; `GET/POST /profile/edit` authenticated by scoped session; `POST /profile/hide`; `POST /profile/delete`; internal health/refresh interfaces not publicly exposed.

## Acceptance criteria

- An address not verified against any available source never triggers SES; the visible request response does not disclose eligibility or profile existence.
- A newly added Chromium, WebKit or DevTools contributor can request a link after the next successful daily refresh; failed refreshes retain the prior valid per-project snapshot; missing/over-72-hour snapshots block new links for that project. Firefox uses commit search with a bounded cache, not a daily AUTHORS snapshot.
- A valid link permits one scoped editing session; expired, replayed, and scanner-prefetched links cannot grant edit access. Creating, editing after session expiry, hiding, and deleting require email verification.
- Only opted-in, published profiles appear in map, list, search, and counts; no public endpoint leaks email or precise location. Hide/delete removes the public entry promptly.
- Globe/map works on desktop/mobile without an API key, clusters dense areas, has attribution and a keyboard-accessible list fallback; design matches the dark amber terminal-inspired reference.
- Docker setup persists profiles and allowlist across restarts, refreshes once per day with a single worker, and sends mail via SES when configured; local development runs without AWS credentials using a mail sink.
- Automated tests cover AUTHORS parsing/refresh and rollback, eligibility checks before send, generic responses, rate limits, token expiry/replay/prefetch, scoped edit authorization/CSRF, profile visibility, and public-data privacy.

## Open decisions before implementation

- Product name/domain and the precise status/interests vocabulary.
- Whether to move off public OpenFreeMap tiles or public Nominatim geocoding if traffic grows, and how to disclose those third parties in the privacy notice.
- Operator contact and policy for contributors who leave a source, change email, or report impersonation.
- Hosting target, SES region/verified sender, retention periods, and privacy-policy jurisdiction. Credentials can be provided at deployment time; they are not needed to build the local development flow.
