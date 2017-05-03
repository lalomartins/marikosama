import featureRegistry from '../feature-registry';
import Schema from 'mongoose/lib/schema';

// we could potentially subclass it
export {Schema};
export default Schema;

if (!featureRegistry.has(`schemas`)) featureRegistry.set(`schemas`, new Map());
const feature = featureRegistry.get(`schemas`);
const implementation = {};
feature.set(`mongoose`, implementation);

implementation.test = function test(schema) {return schema instanceof Schema};
