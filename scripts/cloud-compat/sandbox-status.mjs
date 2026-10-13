// Parse only the browser's own chrome://sandbox status page.
export function parseSandboxStatus(text){
  const yes=label=>new RegExp(label+'\\s+(Yes|No)\\b','i').exec(text)?.[1]?.toLowerCase()==='yes';
  const pidNamespace=yes('PID namespaces?');
  const networkNamespace=yes('Network namespaces?');
  const seccomp=yes('Seccomp-BPF sandbox');
  return {pidNamespace,networkNamespace,seccomp,verified:pidNamespace&&networkNamespace&&seccomp};
}
