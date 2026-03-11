# NC DMV Appointment Monitor

## Goals

- Poll the North Carolina DMV scheduler for newly opened appointments.
- Let each watcher express preferences for office, distance, date window, and time window.
- Send notifications only when a newly discovered slot matches those preferences.
- Keep the NC DMV scraping logic isolated so the rest of the system survives site changes.

## High-level Design

1. `NcDmvProvider`
   - Owns the DMV-specific journey.
   - Uses a stateful HTTP session with cookie persistence.
   - Parses each returned HTML step into a normalized structure.
   - Produces normalized `AppointmentSlot` records.

2. `JourneySession`
   - Handles GET/POST requests, anti-forgery token reuse, hidden-field replay, and form submission.
   - Exposes the current step as parsed HTML plus structured metadata.
   - Can run in debug mode to print titles, form fields, and buttons as the site evolves.

3. `WatchMatcher`
   - Applies user preferences to normalized slots.
   - Supports office include/exclude filters, radius constraints, date range, weekdays, and time windows.

4. `StateStore`
   - Persists dedupe state in `data/state.json`.
   - Remembers which slot IDs were already notified per watcher.

5. `NotifierFanout`
   - Sends the same event to console, Resend email, and/or webhook notifiers.
   - Keeps notification transport independent from the scraping/provider layer.

6. `MonitorRunner`
   - Loads config, polls providers, filters slots, dedupes, and dispatches notifications.
   - Supports `once`, continuous `run`, and `debug:journey` entry points.

## Why this Architecture

- The NC DMV site is a multi-step journey, not a public JSON API.
- The provider must preserve hidden inputs, cookies, and step state between requests.
- User preferences should be evaluated after normalization, not mixed into the scraper.
- Notifications must be idempotent because the same slot can appear in multiple polling cycles.

## Current NC DMV Strategy

- The implementation uses direct HTTP requests first.
- It replays the appointment journey by submitting the full form payload plus the selected action.
- HTML is parsed into generic controls and slot candidates using string-based parsers so the project stays dependency-light.
- `debug:journey` is included because this site may change markup without notice; the provider is structured so new step rules can be added quickly.

## Known Risk

- The NC DMV scheduler can change step IDs, hidden field names, or client-side behavior.
- If direct HTTP navigation becomes unreliable, the provider boundary is the fallback point for a Playwright-based implementation without rewriting matching, storage, or notifications.
