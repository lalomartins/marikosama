
import * as marikosama from 'marikosama';
import Schema from 'mongoose/lib/schema';
import {model} from 'marikosama';

const onlinePresenceSchema = new Schema({
  website: String,
  photoStreams: [String],
  videoChannels: [String],
});

const personOrOrgaSchema = new Schema({
  name: String,
  online: onlinePresenceSchema,
});

const kittySchema = new Schema({
  name: {type: String, required: true},
  likes: [{
    thing: {type: String, required: true},
    level: {type: Number, default: 5, min: 0, max: 10},
  }],
  quotes: [String],
  online: onlinePresenceSchema,
  related: [onlinePresenceSchema],
  features: {
    breed: {type: String, required: true},
    eyes: String,
    coat: String,
  },
  matrioska: {
    name: String,
    second: {
      name: String,
      third: {
        name: String,
        fourth: {
          name: String,
          fifth: {
            name: String,
          },
        },
      },
    },
  },
  owner: personOrOrgaSchema,
  // other stuff doesn't get deep/clever accessors but you can still use deepGet and deepSet
  notes: Schema.Types.Mixed,
  justToBeAnnoying: Schema.Types.ObjectId,
});

@model({schema: kittySchema, options: {validateOnCreation: false}})
class Kitty {
  mew() {console.log(`${this.name} says: mew`)}
}

window.marikoTest = {Schema, model, kittySchema, Kitty, marikosama};

const tartar = Kitty.M.load({
  name: `Tartar Sauce`,
  likes: [],
  online: {
    website: `https://www.grumpycats.com/`,
  },
  features: {
    breed: `mixed`,
    eyes: `blue`,
  },
  quotes: [`no.`, `NO`, `it was awful`],
});
tartar.mew();

const maru = Kitty.M.load({
  name: `maru`,
  likes: [{thing: `boxes`, level: 7}],
  online: {
    website: `http://sisinmaru.com/`,
  },
  features: {
    breed: `Scottish Fold`,
  },
});
maru.mew();

window.marikoTest = {...window.marikoTest, tartar, maru};
