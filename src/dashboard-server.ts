import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Registration} from './registration.ts';
export async function startDashboard(options:{data:()=>Promise<unknown>;registration:Registration;inspect?:(id:string)=>Promise<unknown>}){
  const token=randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');let authenticated=false;let origin='';
  const equal=(a:string,b:string)=>{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
  const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const body=async(req:IncomingMessage)=>{let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>4096)throw new Error('BODY_TOO_LARGE');}return JSON.parse(text);};
  const server=createServer((req,res)=>{void(async()=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(req.headers.host!==origin.replace('http://','')){json(res,403,{error:'FORBIDDEN_HOST'});return;}
    const path=new URL(req.url??'/',origin).pathname;
    if(req.method==='GET'&&['/','/app.js','/style.css'].includes(path)){
      const name=path==='/'?'index.html':path.slice(1);const data=await readFile(new URL(`../web/${name}`,import.meta.url));
      res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(data);return;
    }
    if(req.method==='POST'){
      if(req.headers.origin!==origin){json(res,403,{error:'FORBIDDEN_ORIGIN'});return;}
      if(path==='/api/login'){
        const value=await body(req);if(authenticated||typeof value.token!=='string'||!equal(value.token,token)){json(res,403,{error:'LOGIN_LINK_EXPIRED'});return;}
        authenticated=true;res.setHeader('Set-Cookie',`cqut_session=${session}; HttpOnly; SameSite=Strict; Path=/`);json(res,200,{ok:true});return;
      }
    }
    const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('cqut_session='))?.slice(13)??'';
    if(!authenticated||!equal(cookie,session)){json(res,401,{error:'LOGIN_REQUIRED'});return;}
    if(req.method==='GET'&&path==='/api/data'){json(res,200,{data:await options.data(),csrf});return;}
    if(req.method==='POST'){
      if(typeof req.headers['x-csrf-token']!=='string'||!equal(req.headers['x-csrf-token'],csrf)){json(res,403,{error:'CSRF_REQUIRED'});return;}
      const value=await body(req);
      if(path==='/api/signup/prepare'){json(res,200,await options.registration.prepare(String(value.id??'')));return;}
      if(path==='/api/signup/submit'){json(res,200,await options.registration.submit(String(value.intent??''),String(value.captcha??''),value.confirmed===true));return;}
      if(path==='/api/signup/inspect'&&options.inspect){json(res,200,await options.inspect(String(value.id??'')));return;}
    }
    json(res,404,{error:'NOT_FOUND'});
  })().catch(e=>json(res,400,{error:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'LOCAL_REQUEST_FAILED'}));});
  server.requestTimeout=20000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('LOCAL_LISTEN_FAILED');origin=`http://127.0.0.1:${address.port}`;
  return {url:`${origin}/#${token}`,origin,close:async()=>{await options.registration.close();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
