`data/trades.json` is the only public data artifact. `tools/export-paper-data.mjs` reads retained local paper snapshots, bounded archived execution/event logs, and the existing per-position market-cap cache. It performs no network requests, provider reads, credential/config reads, Discord notifications, signing, Git operation, or deployment. Missing evidence stays `null`. It never changes the bot or its financial history.

Run once with `node tools/export-paper-data.mjs --source-root ../iJustNeedBreadFFS`, or use `--watch` for a serial local refresh every ten seconds. Import callers may use `exportPaperData({workspaceRoot, outputPath})`, with output restricted to this site's `data/trades.json`. The exporter writes a temporary file in the site's own `data` directory, fsyncs it, and atomically renames it to `trades.json`. Byte-identical output and timestamp-only heartbeat changes are skipped. `updatedAt` and `live.asOf` use the retained snapshot's `updatedAt` if supplied, otherwise the source file timestamp; they are not newly invented trade times. Publication remains a separate workflow.

Version 1 has exactly these fields:

- `schemaVersion`: `1`.
- `updatedAt`: UTC timestamp of the source snapshot.
- `live`: `{state, asOf, closed, unresolved, open}`. State is `running`, `stopped`, `awaiting_recovery`, or `unknown`. Unresolved inventory remains distinct from closed inventory.
- `stats`: `{closedTrades, unresolvedTrades, openTrades, knownPnlTrades, wins, losses, winRatePercent, meanPnlPercent, lastTenCappedMeanPercent}`.
- `trades`: rows `{id, mint, name, symbol, status, entryMarketCapUsd, exitMarketCapUsd, pnlPercent, openedAt, closedAt}`. Status is `closed`, `open`, or `unresolved`.

Trade PnL preserves the existing report/goal definition exactly: `(actual executed gross exit proceeds − actual executed entry principal) / actual executed entry principal × 100`. It derives from matching successful local VM buy/sell facts, not the position's rounded stored ROI, wallet cash outlay, refundable rent, or a quote. Fees are excluded from this metric. All losses remain in the series. The last-ten mean requires ten closed outcomes with known PnL and caps only each positive contribution above +333%. Open and unresolved rows have no realized PnL or exit market cap.

Market cap is `actual executed principal or gross proceeds / actual token quantity × actual mint supply`. Supply comes from decoded execution facts, a strictly matching existing per-position cache record, or the matching execution's actual mint account bytes. USD conversion reuses that position's already cached SOL/USD observation, which is a cached display-time conversion and is **not a historical USD execution price**. No fresh exchange rate is fetched. Entry and exit use the same position-specific cached rate. Unavailable USD values remain `null`.

Entry/exit timestamps come only from matching archived `paper.entry` and `paper.exit` records. Original process monotonic times are never converted to UTC or relabeled. The current retained trade records do not prove token names/symbols, so those fields remain `null`; UI may display a shortened mint. Such metadata must not be inferred from news or unverified labels.

The public allowlist excludes wallet addresses, account arrays, raw receipts, execution IDs, source paths, provider details, keys, webhooks, configuration, and debug/error payloads. `assertPublicSchema` rejects extra keys before any output write. A browser-side `123` gate is a convenience screen; static public JSON remains publicly retrievable and contains only this sanitized projection.
