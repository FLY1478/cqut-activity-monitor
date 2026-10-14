import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
export async function acquireLocalLock(privateDir:string,scope='scan'):Promise<()=>Promise<void>> {
  const path=await realpath(privateDir);
  const hash=createHash('sha256').update((process.platform==='win32'?path.toLowerCase():path)+'\0'+scope).digest();
  const port=40000+(hash.readUInt16BE(0)%10000);
  // The OS releases the listening socket when a process crashes. A stale lock
  // file must not prevent automatic recovery after a restart.
  const server=createServer(socket=>socket.destroy());
  await new Promise<void>((resolve,reject)=>{server.once('error',()=>reject(new Error('LOCAL_MONITOR_ALREADY_LOCKED')));server.listen(port,'127.0.0.1',resolve);});
  return ()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
