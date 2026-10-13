import type {BrowserContext} from 'playwright';
export function schoolReadAllowed(url:string,method:string):boolean{
  const u=new URL(url);if(u.origin!=='https://2class.cqut.edu.cn')return true;
  let path=u.pathname;try{for(let i=0;i<3;i++)path=decodeURIComponent(path);}catch{return false;}
  if(/applyGo|cancel|delete|remove|signInGo|signOutGo/i.test(path))return false;
  if(['GET','HEAD'].includes(method))return true;
  return method==='POST'&&/^\/Student\/(Activity\/getActivityCanApply|Project\/getProjectsCanApply|Course\/getCoursesCanApply)\.html$/i.test(path);
}
export function cloudReadAllowed(url:string,method:string):boolean{
  try{
    const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['2class.cqut.edu.cn','uis.cqut.edu.cn','res.wx.qq.com'].includes(u.hostname))return false;
    let path=u.pathname;for(let i=0;i<3;i++)path=decodeURIComponent(path);
    if(/logout|signout|cancel|delete|remove/i.test(path))return false;
    if(u.hostname==='2class.cqut.edu.cn')return schoolReadAllowed(url,method);
    return ['GET','HEAD'].includes(method);
  }catch{return false;}
}
export async function protectReadOnly(context:BrowserContext,onBlocked?:()=>void){
  await context.route('**/*',route=>{const policy=process.env.CQUT_CLOUD_READONLY==='1'?cloudReadAllowed:schoolReadAllowed;if(policy(route.request().url(),route.request().method()))return route.continue();onBlocked?.();return route.abort('blockedbyclient');});
}
