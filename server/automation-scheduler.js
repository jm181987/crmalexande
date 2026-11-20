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
   const result=await runFollowupAutomations({limit:50});
   const recurring=await runRecurringCampaigns({limit:10});
   const delivery=process.env.CAMPAIGN_DELIVERY_ENABLED==='true'&&process.env.CAMPAIGN_WORKER_SECRET?.length>=24
    ?await dispatchCampaignBatch({limit:10}):{disabled:true};
   console.info('Automation scheduler completed',JSON.stringify({followups:result,recurring,delivery}));
  }catch(err){
   console.error('Automation scheduler failed',err.code||err.message);
  }finally{running=false}
 };
 const timer=setInterval(execute,minutes*60_000);
 timer.unref?.();
 console.info('Automation scheduler enabled; interval:',minutes,'minutes');
 // Run once after startup; other replicas are protected by execution claims.
 void execute();
}
