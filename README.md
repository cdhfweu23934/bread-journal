# BREAD

A static paper-trading journal with a searchable, paginated ledger, return chart, and trade details.

The viewing password is `123`. This is a client-side convenience gate; the published data remains public.

Legacy entries retain their executed-price market caps and recorded display-time USD conversion. New paper calls show USD market caps using each entry or exit minute's cached SOL/USD close; the drawer identifies those minutes. Missing conversions display an em dash, never SOL. FX changes display only: paper-call PnL compares the original native market-cap observations after the entry and exit delays. Historical returns and scores remain unchanged. Open or unresolved positions have no fabricated exit or realized return.

Non-SOL calls show USD market caps from each quote asset's recorded rate. PnL remains in the original quote units; trade details identify that unit.

The UI is served through GitHub Pages. A separate `live` branch carries the sanitized trade export so data updates don't rebuild the site.
