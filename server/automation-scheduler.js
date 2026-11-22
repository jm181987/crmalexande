import {dispatchCampaignBatch} from './campaign-worker.js';
import {runRecurringCampaigns} from './recurring-campaigns.js';
import {runFollowupAutomations} from './followup-automation.js';

// Opt-in scheduler for persistent Node servers (Coolify). Do not run on serverless.
export function startAutomationScheduler(){
 if(process.env.CRM_AUTOMATIONS_ENABLED!=='true'||process.env.CRM_AUTOMATIONS_SCHEDULER!=='true')return;
 const minutes=Number(process.env.CRM_AUTOMATIONS_INTERVAL_MINUTES||15);
 if(!Number.isInteger(minutes)||minutes<5||minutes>1440){
  console.error('Automation scheduler: interval must be an integer from 5 to 1440 minutes');
  return;
 }
 let running=false;
 const execute=async()=>{
  if(running)return;
  running=true;
  try{
   const phases=[
    ['followup',()=>runFollowupAutomations({limit:50})],
    ['recurring',()=>runRecurringCampaigns({limit:10})],
    ['delivery',()=>process.env.CAMPAIGN_DELIVERY_ENABLED==='true'&&process.env.CAMPAIGN_WORKER_SECRET?.length>=24
     ?dispatchCampaignBatch({limit:10}):Promise.resolve({disabled:true})]
   ];
   const results={};
   for(const [phase,run] of phases){
    try{results[phase]=await run();}
    catch(err){
     results[phase]={error:true,code:err.code||null};
     console.error('Automation scheduler phase failed',{phase,code:err.code||null,message:err.message,table:err.table||null});
    }
   }
   console.info('Automation scheduler completed',JSON.stringify(results));
  }finally{running=false}
 };
 const timer=setInterval(execute,minutes*60_000);
 timer.unref?.();
 console.info('Automation scheduler enabled; interval:',minutes,'minutes');
 // Run once after startup; other replicas are protected by execution claims.
 void execute();
}
