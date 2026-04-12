# Versature CDR Shape Verification

- Inspection date: 2026-04-12
- Sample day checked: 2026-04-10
- Total CDR rows returned for sample day: 500 (with `limit=500`)
- DNIS-touching rows: 391 of 500 (rows where `from.id` or `to.id` is `+16135949199`)

## Endpoint Discovery

The implementation plan assumed `GET /cdrs/users/` as the CDR endpoint. This is **incorrect** for this tenant.

| Endpoint | Behavior |
|----------|----------|
| `GET /cdrs/users/?start_date=...&end_date=...` | Returns `{ result: [], cursor: null, more: false }` — always 0 rows |
| `GET /cdrs/users/` (no date filter) | Returns `{ message: "...", status: 422 }` |
| `GET /cdrs/?start_date=...&end_date=...` | Returns a **direct JSON array** of CDR objects. This is the correct endpoint. |
| `GET /cdrs/?start_date=...&end_date=...&limit=N` | Pagination works via `limit` param. Default page size appears to be 20. |

**Correct CDR endpoint: `GET /cdrs/`**

## Page Wrapper

- Page wrapper keys: `["<array-root>"]` — the response IS the array, no wrapping object
- Primary row array key: `<array-root>`
- Pagination: `limit` parameter controls page size. `page` parameter for offset pagination (page=2 returns next set).
- No `cursor` / `more` / `next` fields — the `/cdrs/` endpoint returns a flat array.

**Impact on plan:** The `extractPagedItems(...)` helper in Task 4 must handle direct-array responses, not `{ result, cursor, more }` wrappers. The plan's S2 helper needs to detect the array-root case.

## CDR Row Shape

Each CDR row has exactly 6 top-level fields:

```json
{
  "duration": 180,
  "answer_time": "2026-04-10T20:56:43",
  "start_time": "2026-04-10T20:56:43",
  "end_time": "2026-04-10T20:59:43",
  "from": {
    "call_id": "sbcsipuac.2_169.132.219.57_sbc03_1_1_2026041016564370_0696918103_01",
    "name": "On Call Centre SIP",
    "id": "+16132772283",
    "user": null,
    "domain": null
  },
  "to": {
    "call_id": "20260412124235006585-e59992c9f78270db5ffe7580696d5869",
    "id": "+16138082842",
    "user": "40",
    "domain": "neolore.com"
  }
}
```

### Field inventory

| Field | Type | Always present | Notes |
|-------|------|---------------|-------|
| `duration` | number (seconds) | Yes | Total segment duration |
| `answer_time` | string (ISO) or null | Yes (but nullable) | null when call was not answered |
| `start_time` | string (ISO) | Yes | Segment start |
| `end_time` | string (ISO) | Yes | Segment end |
| `from.call_id` | string | Yes | SIP call identifier on the originating side |
| `from.name` | string or null | Yes | Caller name (often null or SIP trunk name) |
| `from.id` | string or null | Yes (but nullable) | Caller phone number (E.164 format when present) |
| `from.user` | string or null | Yes | Internal user ID |
| `from.domain` | string or null | Yes | SIP domain |
| `to.call_id` | string | Yes | SIP call identifier on the receiving side |
| `to.id` | string or null | Yes (but nullable) | Destination phone/extension |
| `to.user` | string or null | Yes | Internal user ID |
| `to.domain` | string or null | Yes | SIP domain |

### Notable: No `call_type` field

The CDR rows do **not** contain a `call_type` field (e.g., "Incoming"). Direction must be inferred from whether the DNIS appears in `from.id` (outbound from the tracked line) or `to.id` (inbound to the tracked line).

### Notable: No top-level `id` field

There is **no** top-level row `id` field on any sampled CDR.

## Shared Call Identifier

### Confirmed: `from.call_id`

The `from.call_id` field links multiple CDR segments that belong to the same originating call.

**Evidence from 500-row sample (2026-04-10):**

- 473 unique `from.call_id` values
- **27 multi-segment groups** where the same `from.call_id` appears on 2+ rows
- These groups consistently show the same caller (`from.id`) calling the DNIS, with segments routing to different `to.id` destinations (AA, queue, agent)

### Multi-segment group examples

**Example 1:** Caller +16132772283 → DNIS +16135949199

```
from.call_id: sbcsipuac.2_169.132.219.57_sbc03_1_1_2026041016564370_0696918103_01
  Seg 1: from=+16132772283 → to=+16135949199  dur=180s  answered=Y  start=2026-04-10T20:56:43
  Seg 2: from=+16132772283 → to=null           dur=847s  answered=Y  start=2026-04-10T20:56:43
```

Interpretation: call enters the tracked DNIS (seg 1, 180s queue/AA leg), then routes to an internal destination (seg 2, 847s agent conversation with `to.id` null = internal extension).

**Example 2:** Caller +14168887702 → DNIS +16135949199

```
from.call_id: sbcsipuac.2_169.132.219.113_sbc17_1_1_2026041016234091_2116511581_01
  Seg 1: from=+14168887702 → to=null           dur=1263s answered=Y  start=2026-04-10T20:23:40
  Seg 2: from=+14168887702 → to=+16135949199   dur=471s  answered=Y  start=2026-04-10T20:23:40
```

Same pattern: multiple segments, same `from.call_id`, same `start_time`, different destinations.

**Example 3:** Caller +16138629864 → DNIS +16135949199

```
from.call_id: sbcsipuac.2_169.132.219.113_sbc17_1_1_2026041015064866_1188476444_01
  Seg 1: from=+16138629864 → to=+16135949199   dur=296s  answered=Y  start=2026-04-10T19:06:48
  Seg 2: from=+16138629864 → to=null            dur=535s  answered=Y  start=2026-04-10T19:06:48
```

### `to.call_id` also shows multi-segment groups (20 found)

The `to.call_id` links different originating calls that arrived at the same internal destination. This is less useful for deduplication (it groups transfers from different callers into the same agent), but confirms the call routing topology.

### `from.call_id` format patterns

Two patterns observed:

1. **SBC-originated:** `sbcsipuac.2_{IP}_sbc{N}_1_1_{timestamp}_{id}_01` — these are external inbound calls from the SIP trunk
2. **Internal-originated:** hex hashes or `{N}@192.168.17.{N}` — these are internal/outbound legs

The SBC pattern reliably groups multi-segment inbound calls. Internal-originated legs typically have unique `from.call_id` values.

## Dedupe Decision

**Primary dedupe key: `from.call_id`**

The `from.call_id` field is confirmed to be:
- Present on every sampled row
- Shared across AA, queue, and answered legs of the same originating call
- Stable across segment types (both DNIS-touching and internal-routed segments share the same value)

**Fallback:** Caller number (`from.id`) + Toronto-local 1-minute bucket for any rows where `from.call_id` might be missing or unreliable (none observed, but the fallback is retained as a safety net per the plan).

## Raw CDR Identity Decision

**No reliable top-level `id` field exists.**

- `source_hash` must be the primary upsert conflict target for `cdr_segments`
- The hash should be derived from `from.call_id + to.call_id + start_time` (these three fields together uniquely identify a segment)
- A schema comment must warn that `source_hash` is sensitive to payload-shape changes

## Follow-Up Edits Required Before Task 4 and Task 5

1. **Task 4 — `extractPagedItems(...)`:** Must handle direct-array responses from `/cdrs/`. The `/cdrs/users/` wrapper shape (`result`, `cursor`, `more`) is irrelevant for CDR fetching but may still be needed for other endpoints (queues).

2. **Task 4 — Endpoint URL:** Change CDR endpoint from `/cdrs/users/` to `/cdrs/`. Keep query params `start_date`, `end_date`, `limit`, `page`.

3. **Task 4 — `VersatureCdr` type:** Must match the 6-field shape documented above. There is no `call_type` field — direction is inferred from DNIS position.

4. **Task 5 — `getSharedCallId(...)`:** Use `row.from.call_id` as the primary grouping key.

5. **Task 2 — `cdr_segments` migration:** Use `source_hash` (derived from `from.call_id + to.call_id + start_time`) as the conflict target. No `external_id` column needed.

6. **Task 5 — Direction inference:** Since there is no `call_type` field, the logical-call builder must determine direction by checking whether the tracked DNIS appears in `to.id` (inbound) or `from.id` (outbound from the tracked line).

## API Version Note

The tenant is running `VERSATURE_API_VERSION=application/vnd.integrate.v1.10.0+json`. The plan defaulted to `v1.6.0`. The `v1.10.0` version works and returns the documented shape above. No breaking differences were observed.
