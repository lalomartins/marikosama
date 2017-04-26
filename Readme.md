# marikosama
Extensible lightweight model/validation/persistence/etc for JS

I'm working on two database-centric, React-based (well, one is preact) projects at the moment. Relying on props and possibly Redux is brilliant most of the time, but when I'm dealing with fixed-shape records, and I'm persisting them (one to PouchDB and one to a REST API), there's a huge abstraction clash.

So I found something called nestedreact and it was a huge improvement, but it's written for migrating Backbone apps, and that shines through in a lot of places.

## Goals

This is aimed at being the simplest thing that solves my needs for both projects.

### Validation

I want a simple way to validate form input.

### Persistence

I want a simple way to load and save to Pouch or a remote API.

I want to have control over the requests for the API persistence so I can plug in authentication.

The Pouch persistence should be optionally reactive, both on a document and query level.

I don't want to worry about serialization, just “save” and “get” and “query” and the library figures it out.

I want to use whatever query mechanism is native to the persistence layer — Pouch query or find, REST API parameters, whatever, not some funky abstraction layer that adds cognitive and processing cost.

### No namespace pollution

I want to worry as little as possible about my field names clashing with library methods. Yes, this bit me a couple of times with nestedreact.

### UI binding

I want to easily bind model fields to form controls. Fortunately, the library that does that for nestedreact is stand-alone (it's called valuelink), so I want to just use that because it's awesome. So the library should support it.

### Idiomatic React

I want to wrap my components with higher-order components, Redux-style, to get model data as painlessly as possible. 

At the same time, I want to be able to easily set model properties, and get React to do its thing and react appropriately to the changes.

## Plugin system

Many features are only activated if you import the corresponding submodule. For example, for Mongoose schemas, you `import {Schema} from 'marikosama/schemas/mongoose'`. If you don't, the feature won't be included in your bundle, and more importantly, neither will Mongoose itself (at least not unless you already imported it otherwise in your own code).

This is designed so that your bundle isn't bloated with libraries you don't need, as well as your dependencies. In my specific use case, each of my projects uses a different persistence system, so I don't want to bloat them with the other one's dependencies.

## Dependencies

There are no mandatory dependencies. However, it uses a lot of es6 features; it also uses properties (get/set) and probably something I'm forgetting. So if you're running in an environment without those, you'll want a correctly configured Babel (the `env` preset should work).

It exposes functions designed to be used as decorators, but decorator support isn't required; you can just use these functions the old-fashioned way.

It will work with, if installed and if the corresponding submodules are manually imported:

- mongoose (for schemas and validation).
- valuelink (for easy data binding).
- react >= 0.15 or preact >= 6.0 (for HOCs that encapsulate watching a model, and loading for persistence).
- *pouchdb:* a Pouch persistence module is WIP, not yet in the codebase.

(Yes, I know about `peerDependencies`, but I don't want you to get warnings if you don't have them. They're really, really optional; only needed if the corresponding submodule is imported.)

## Documentation

Yeah right.

Let's wait for at least 0.1 and the APIs to take some level of shape…

## Installing

Use the git repo for now; npm release won't be before 0.1. `npm i --save "lalomartins/marikosama#v0.0.1"`
