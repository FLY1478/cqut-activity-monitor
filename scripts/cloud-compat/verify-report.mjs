import {readFile} from 'node:fs/promises';
const report=JSON.parse(await readFile(process.env.CQUT_PROBE_RESULT_PATH??'probe-result.json','utf8'));
const flags={normalSandbox:report.actualSandbox?.verified===true,fixture:report.fixture?.passed===true,restart:report.fixture?.restartPassed===true,writeBlocked:report.fixture?.writeBlocked===true,schoolLoginPage:report.anonymous?.school?.loginPage===true&&report.anonymous.school.finalHost==='uis.cqut.edu.cn',wechatReachable:report.anonymous?.wechat?.status===200,noCredentials:report.credentialsUsed===false,noActivityAccess:report.activityAccessVerified===false};
console.log(JSON.stringify({at:report.at,checks:flags,compatible:Object.values(flags).every(Boolean)}));
if(!Object.values(flags).every(Boolean))process.exitCode=1;
