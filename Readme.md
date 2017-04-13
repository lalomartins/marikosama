# marikosama
Extensible lightweight model/validation/persistence/etc for JS

I'm working on two database-centric, React-based (well, one is preact) projects at the moment. Relying on props and possibly Redux is brilliant most of the time, but when I'm dealing with fixed-shape records, and I'm persisting them (one to PouchDB and one to a REST API), there's a huge abstraction clash.

So I found something called nestedreact and it was a huge improvement, but it's written for migrating Backbone apps, and that shines through in a lot of places.

This is aimed at being the simplest thing that solves my needs for both projects.

## Validation

I want a simple way to validate form input.

## Persistence

I want a simple way to load and save to Pouch or a remote API.

I want to have control over the requests for the API persistence so I can plug in authentication.

The Pouch persistence should be optionally reactive, both on a document and query level.

I don't want to worry about serialization, just “save” and “get” and “query” and the library figures it out.

I want to use whatever query mechanism is native to the persistence layer — Pouch query or find, REST API parameters, whatever, not some funky abstraction layer that adds cognitive and processing cost.

## No namespace pollution

I want to worry as little as possible about my field names clashing with library methods. Yes, this bit me a couple of times with nestedreact.

## UI binding

I want to easily bind model fields to form controls. Fortunately, the library that does that for nestedreact is stand-alone (it's called valuelink), so I want to just use that because it's awesome. So the library should support it.

## Idiomatic React

I want to wrap my components with higher-order components, Redux-style, to get model data as painlessly as possible. 

At the same time, I want to be able to easily set model properties, and get React to do its thing and react appropriately to the changes.
