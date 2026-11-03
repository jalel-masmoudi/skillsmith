---
name: fitforge-notes
description: Working notes for the FitForge tools. Read this before answering a question about FitForge.
---

# FitForge notes

## Tool behavior and optimization

- **Search results embed IDs**: `search_members`, `search_gyms`, and `search_classes` return full objects including gym_id, class_id, and member_id. Do not make redundant `search_gyms` or `get_gym` calls when these IDs are already available from search results.

- **List operations require pagination**: `list_payments`, `list_refunds`, `list_invoices`, and `list_bookings` may return truncated results. Always check for `next_cursor` in responses and make follow-up calls to fetch complete datasets when pagination is indicated.

- **Status filters in list operations**: `list_bookings` with a status filter (e.g., "confirmed") may return empty results even when records exist with other statuses. Use unfiltered calls or verify the correct status value before filtering.

- **Date range filtering**: `list_classes` with `from` and `to` parameters may return empty results. Prefer `search_classes` for targeted queries, then retrieve full details with `get_class` if needed.

- **Batch member lookups**: When retrieving multiple member details, make parallel `get_member` calls rather than sequential ones to minimize total call count.

- **Avoid parallel redundancy**: Do not make parallel `search_gyms` and `search_members` calls when the gym_id is already known or will be returned by the member search.
