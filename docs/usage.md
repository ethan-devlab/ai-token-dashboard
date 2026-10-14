# Dashboard guide

[Documentation index](README.md)

## Providers and periods

Select Codex or Claude from the header. Filters and budgets are separate for each Provider. The URL selection takes precedence over saved preferences. The header version comes from the running server package. Before the provider response arrives, it shows an unknown value.

Ranges use the selected IANA timezone and half-open boundaries [from,to). Calendar comparisons use the same local progress in the previous period; custom ranges use equal elapsed time. Invalid or ambiguous civil times are rejected. Model filters count only selected-model observations.

## Charts and sessions

Select a single metric, stacked Token/cost plots, or dual axes; use bars or unsmoothed lines. The dashboard retains existing view preferences and saves the new layout and mark choices locally. Pointer movement shows a compact preview. Click a bucket to pin its complete values, or use Left/Right/Home/End and Enter. The data table exposes the same amounts and cost qualifiers.

Drag across complete buckets or use the start/end boundary selects. **Zoom** changes only the plot. **Apply** updates the local usage query, URL, KPIs, model list, sessions, and export scope. Account quota retains its own service period. **Return** restores the prior query during the same page session. Reload preserves the current exact interval, including DST offsets, but clears the Return history. Editing the query clears the chart interval and zoom; view changes preserve them.

All chart assets are served locally. See the [MIT license](../public/scripts/vendor/uplot-LICENSE.txt) and the [archived engine comparison](archive/reviews/chart-engine-comparison.md).

The overview uses short costs and optional exact values. Partial amounts remain lower bounds. A compact account-quota strip below the KPIs shows the service's remaining quota, reset times, and check time. Expand it for complete quota details and source information. Session rows scroll within a bounded table; its header and paging remain available. Failed queries mark the retained data's original scope and provide **Retry** and **Return to displayed query**.

## Downloads

Download verifies the displayed projection, then hands the file to the browser download manager. Use the browser to save or cancel. The UI does not confirm disk completion. If the data version changed, the full dashboard reloads; review it and press Download again. A transfer that already started keeps its original query, snapshot and pricing basis through later refresh or Provider changes.

Exports cover every matching Session and have no fixed 32 MiB cap. One prepared or active export is allowed per process; another request reports busy. An unused preparation expires after two minutes. The server stops transfers after 60 seconds without transport progress or 30 minutes total. Interrupted downloads restart from the Dashboard; partial files remain under browser control and Range resume is unsupported. See [the API contract](api-v2.md) and [isolated performance/desktop evidence](archive/validation/query-export-performance-validation.md).

## Reading costs and quality

Costs are API-equivalent estimates, not subscription bills. A partial known cost is a lower bound. An unknown cost is not zero. Incomplete usage and possible duplicate warnings describe the adopted data, which is not always a lower bound. Full Token/cost totals include all matched observations; Session detail returns at most 2000 observations and reports the exact full count and truncation.

Claude estimates include input, cache read, 5-minute/1-hour cache writes and output when rules match. Missing TTL prices or unknown model/modifier rates remain partial. Non-token tool fees such as web search and code execution are excluded. Pricing uses the current retained basis for historical events; quota windows come from the provider service and are independent of the usage query.
