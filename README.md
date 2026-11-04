# BREAD

A static paper-trading journal with a searchable, paginated ledger, return chart, and trade details.

The viewing password is `123`. This is a client-side convenience gate; the published data remains public.

Entry and exit market caps use executed prices and actual mint supply. USD values reuse each position's recorded display-time SOL conversion. PnL preserves the bot's executed price return, excluding fees. Unresolved positions have no fabricated exit or realized return.

The UI is served through GitHub Pages. A separate `live` branch carries the sanitized trade export so data updates don't rebuild the site.
