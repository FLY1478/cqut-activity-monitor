import {build} from 'esbuild';
const result=await build({entryPoints:['./src/cloud-browser-probe.ts'],outfile:'build/browser-probe/worker.js',bundle:true,format:'esm',platform:'browser',external:['node:buffer'],target:'es2022',minify:true,legalComments:'inline',metafile:true});
console.log(JSON.stringify({file:'build/browser-probe/worker.js',bytes:Object.values(result.metafile!.outputs).reduce((sum,value)=>sum+value.bytes,0),schoolCredentialsIncluded:false,wechatSecretsIncluded:false}));
