export interface LinuxSandboxStatus {pidNamespace:boolean;networkNamespace:boolean;seccomp:boolean;verified:boolean}

// Only call this with text read from the browser's own chrome://sandbox page.
export function parseSandboxStatus(text:string):LinuxSandboxStatus {
  const yes=(label:string)=>new RegExp(label+'\\s+(Yes|No)\\b','i').exec(text)?.[1]?.toLowerCase()==='yes';
  const pidNamespace=yes('PID namespaces?');
  const networkNamespace=yes('Network namespaces?');
  const seccomp=yes('Seccomp-BPF sandbox');
  return {pidNamespace,networkNamespace,seccomp,verified:pidNamespace&&networkNamespace&&seccomp};
}
