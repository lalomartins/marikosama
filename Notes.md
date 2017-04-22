# Notes

- Separate library code from app data, no namespace clashing
- Everything accessible from instance.m.* or class.M.*
- Pluggable, optional features; for now schema (mongoose), persistence (remote API and Pouch), view links (valuelink)
- Schema comes with validation and (optional) accessors

## TODO/WIP

- hook up valuelink
- react wrapping component for rerendering on changes
- “changelog” option
- react HOC for notifying of changes (replacing nestedreact)
- abstract persistence

--- DONE ---

- react HOCs for single document and document listing/query
  - the HOC keeps hold of the actual model, and passes a proxy to props; on changes, it creates a new proxy
  - loading indication
  - do we want to handle paging? Search? Sort?
- create object with default values and initializers
- validate required
- mixed
- transactional
- generic pouch persistence
- generic remote/restful api
