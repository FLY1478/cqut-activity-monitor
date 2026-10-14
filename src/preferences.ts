import {join} from 'node:path';
import {readSecret} from './secrets.ts';
import type {Profile} from './activity.ts';
export async function readPreferences(directory:string):Promise<Profile>{
  return readSecret<Profile>(join(directory,'preferences.dpapi')).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw e;});
}
export function mergeProfile(school:Profile,confirmed:Profile):Profile{
  // Explicit user-confirmed facts take precedence over absent or ambiguous school labels.
  return {...school,...confirmed};
}
