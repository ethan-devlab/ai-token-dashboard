# Security model

The dashboard defaults to loopback and rejects non-loopback binding without `ALLOW_REMOTE=1`. Paths are redacted server-side unless loopback `EXPOSE_FULL_PATHS=1` is explicitly set. JSONL/conversation content never reaches browser routes. Static/API routes retain same-origin CSP, nosniff, traversal rejection, Host/Origin checks, and CSV formula escaping.
