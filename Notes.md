# Notes

- Separate library code from app data, no namespace clashing
- Everything accessible from instance.m.* or class.M.*
- Pluggable, optional features; for now schema (mongoose), persistence (remote API and Pouch), view links (valuelink)
- Schema comes with validation and (optional) accessors

## TODO/WIP

- mixed
- hook up valuelink
- react HOC for notifying of changes (replacing nestedreact)
  - the HOC keeps hold of the actual model, and passes a proxy to props; on changes, it creates a new proxy
  - should provide an easy way to detect the changes… maybe a transactional option?
- abstract persistence
- react HOCs for single document and document listing/query
  - do we want to handle paging? Search? Sort?
- generic mongo persistence
- generic remote/restful api
