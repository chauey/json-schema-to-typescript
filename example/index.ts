import { writeFileSync } from 'fs';
import { compileFromFile } from 'json-schema-to-typescript';

async function generate() {
  // writeFileSync('person.d.ts', await compileFromFile('person.json'))
  writeFileSync('oas3-interface.ts', await compileFromFile('openapi-3.0.json'))
}

generate()
