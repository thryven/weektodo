export const recoveryKeyFilename="weektodo-recovery-key.txt";

export function recoveryKeyDocument(recoveryKey,email,createdAt=new Date()){
  return [
    "WeekToDo recovery key",
    "",
    recoveryKey,
    "",
    `Account: ${email || "Not specified"}`,
    `Created: ${createdAt.toISOString()}`,
    "",
    "Keep this file somewhere private and separate from your WeekToDo account.",
    "Anyone with this key may be able to access your encrypted data."
  ].join("\n");
}

export async function copyRecoveryKey(recoveryKey,clipboard=globalThis.navigator?.clipboard){
  if(!clipboard?.writeText)throw new Error("Clipboard access is unavailable. Download the recovery key instead.");
  await clipboard.writeText(recoveryKey);
}

export function downloadRecoveryKey(recoveryKey,email,{document=globalThis.document,url=globalThis.URL,BlobType=globalThis.Blob}={}){
  const blob=new BlobType([recoveryKeyDocument(recoveryKey,email)],{type:"text/plain;charset=utf-8"});
  const objectUrl=url.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=objectUrl;
  link.download=recoveryKeyFilename;
  link.style.display="none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  url.revokeObjectURL(objectUrl);
}
