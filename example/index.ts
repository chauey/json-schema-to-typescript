import { writeFileSync } from 'fs';
// import { compileFromFile } from 'json-schema-to-typescript';
import { compileFromFile } from '../../json-schema-to-typescript/dist/src'; // HACK: use local for deve/testing

console.log('hello 1');

// async function generate() {
//   writeFileSync('person.d.ts', await compileFromFile('person.json'))
// }

async function generateOasInterfacesAndClasses() {
  // writeFileSync('person.d.ts', await compileFromFile('person.json'))
  console.log('hello 2');
  writeFileSync('oas3-interfaces-classes.ts', await compileFromFile('openapi-3.0.json'))
}

generateOasInterfacesAndClasses()
