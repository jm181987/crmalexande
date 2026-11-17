export function isValidUserEmail(value){
 if(typeof value!=='string')return false;
 const email=value.trim();
 if(!email||email.length>254||/\s/.test(email))return false;
 const parts=email.split('@');
 if(parts.length!==2||!parts[0]||parts[0].length>64)return false;
 const domain=parts[1];
 if(!/^[^@\s]+$/.test(parts[0])||!domain||domain.length>253)return false;
 const labels=domain.split('.');
 return labels.length>=2&&labels.every(label=>label.length>0&&label.length<=63&&/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label));
}
