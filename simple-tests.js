
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
});

@model({schema: kittySchema, options: {validateOnCreation: false, allowSettingThrough: true}})
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
