import SwaggerParser from '@apidevtools/swagger-parser';
import { fileURLToPath } from 'node:url';

const document = await SwaggerParser.validate(fileURLToPath(new URL('../openapi.yaml', import.meta.url)));
if (document.openapi !== '3.0.3') throw new Error('Unexpected OpenAPI version');
console.log(`Valid OpenAPI document with ${Object.keys(document.paths).length} paths`);
