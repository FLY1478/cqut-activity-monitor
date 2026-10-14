import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {resolve,join} from 'node:path';
import {writeSecret} from '../src/secrets.ts';
const nonce=randomBytes(32).toString('hex');
const privateDir=resolve(process.env.CQUT_PRIVATE_DIR??'../../work/private');
let used=false;
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const supplied=String(req.headers['x-local-setup']??'');
  if(req.method!=='POST'||req.url!=='/configure'||supplied.length!==nonce.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(nonce))||used){res.writeHead(403);res.end();return;}
  let body='';
  try {
    for await(const chunk of req){body+=String(chunk);if(Buffer.byteLength(body)>16384)throw new Error('TOO_LARGE');}
    const value=JSON.parse(body);
    if(!/^wx[a-f0-9]{16}$/.test(value.appId)||!/^\w{32}$/.test(value.appSecret)||typeof value.templateId!=='string'||value.templateId.length<10||typeof value.openId!=='string'||value.openId.length<10)throw new Error('INVALID_CONFIG');
    used=true;
    await writeSecret(join(privateDir,'wechat.dpapi'),{appId:value.appId,appSecret:value.appSecret,templateId:value.templateId,openId:value.openId});
    res.writeHead(200,{'Content-Type':'application/json'});res.end('{"configured":true}');
    console.log('WECHAT_CONFIG_ENCRYPTED_LOCALLY');
    server.close();clearTimeout(timer);
  }catch{res.writeHead(400);res.end('{"configured":false}');}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:(server.address() as {port:number}).port,nonce})));
const timer=setTimeout(()=>{server.close();console.log('SETUP_EXPIRED');},10*60*1000);
