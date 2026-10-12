import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function storageKey():Buffer {
  const key=process.env.CQUT_STORAGE_KEY;
  if(!key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error('STORAGE_KEY_REQUIRED');
  return Buffer.from(key,'hex');
}

function dpapi(operation: 'protect'|'unprotect', value: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('DPAPI_REQUIRES_WINDOWS');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
      fileURLToPath(new URL('../scripts/dpapi.ps1', import.meta.url)), '-Operation', operation],
      {windowsHide: true, stdio: ['pipe','pipe','pipe']});
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', c => { output += c; });
    child.stderr.resume(); // Never forward diagnostic output that might contain private data.
    child.on('error', () => reject(new Error('SECRET_PROCESS_FAILED')));
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error('SECRET_OPERATION_FAILED')));
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}

export async function readSecret<T>(path: string): Promise<T> {
  const encrypted=await readFile(path,'utf8');
  if(process.platform==='win32') return JSON.parse(await dpapi('unprotect',encrypted));
  const envelope=JSON.parse(encrypted);
  if(envelope.version!==1) throw new Error('SECRET_VERSION_UNSUPPORTED');
  const decipher=createDecipheriv('aes-256-gcm',storageKey(),Buffer.from(envelope.iv,'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));
}

export async function writeSecret(path: string, value: unknown): Promise<void> {
  let encrypted:string;
  if(process.platform==='win32') encrypted=await dpapi('protect',JSON.stringify(value));
  else {
    const iv=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',storageKey(),iv);
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    encrypted=JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
  }
  await mkdir(dirname(path), {recursive:true});
  const temporary = path + '.tmp';
  await writeFile(temporary, encrypted, {mode:0o600});
  await rename(temporary, path);
}
