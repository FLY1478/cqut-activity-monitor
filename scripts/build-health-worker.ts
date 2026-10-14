import {stripTypeScriptTypes} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
// Three dependency-free modules only: deliberately exclude all private config,
// Node credential handling, school collectors and third-party dependencies.
const files=['src/schedule.ts','src/health.ts','src/health-worker.ts'];
let bundled='';
for(const file of files){
  const source=await readFile(file,'utf8');
  bundled+=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,'').replace(/^export (?!default)/gm,''),{mode:'strip'})+'\n';
}
await mkdir('build/health',{recursive:true});await writeFile('build/health/worker.js',bundled);
console.log(JSON.stringify({file:'build/health/worker.js',modules:files.length,bytes:Buffer.byteLength(bundled)}));
