# Notes

- Separate library code from app data, no namespace clashing
- Everything accessible from instance.m.* or class.M.*
- Pluggable, optional features; for now schema (mongoose), persistence (remote API and Pouch), view links (valuelink)
- Schema comes with validation and (optional) accessors

## TODO/WIP

- clean up the subDocClasses and ArrayModel stuff, mostly not needed anymore
- accessors
