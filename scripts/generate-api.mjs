import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const input = resolve(process.env.CLIPMINT_OPENAPI_PATH ?? "../clipmint-service/openapi/openapi.yaml");
const output = resolve("src/lib/api/schema.d.ts");
const ast = await openapiTS(pathToFileURL(input));
await writeFile(output, astToString(ast), "utf8");
console.log(`Generated ${output} from ${input}`);
