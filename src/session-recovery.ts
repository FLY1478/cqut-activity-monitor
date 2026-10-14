export type StudentEvidence={studentRoute:boolean;studentMenu:boolean;loginPrompt:boolean};
export function requireStudentSession(evidence:StudentEvidence):void{
  if(!evidence.studentRoute||!evidence.studentMenu||evidence.loginPrompt)throw new Error('STUDENT_SESSION_NOT_CONFIRMED');
}
export function recoverableSessionFailure(error:unknown):boolean{
  return error instanceof Error&&['STUDENT_SESSION_NOT_CONFIRMED','UNEXPECTED_EMPTY_SCAN_NOT_COMMITTED'].includes(error.message);
}
// Exactly one clean context, through the normal authentication flow. Transport,
// schema, credentials and CAPTCHA failures never cause a repeated login loop.
export async function withSessionRecovery<T>(run:(forceFresh:boolean)=>Promise<T>,forceFresh=false,onRecovery?:(code:string)=>void):Promise<T>{
  try{return await run(forceFresh);}catch(error){
    if(!recoverableSessionFailure(error))throw error;
    onRecovery?.((error as Error).message);
    return await run(true);
  }
}
