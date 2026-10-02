import { defaultProfilesPath, disabledSocialFlags, loadProfiles, collectSocial, publicResults, operateSocial, saveHealth, socialReadiness } from './lib/free-social-reader.ts';

Object.assign(process.env,disabledSocialFlags);
let usedDb = false;
type Mode = 'dry-run'|'check'|'apply'|'register'|'ready';
try {
  const args = process.argv.slice(2); let profilesPath = defaultProfilesPath(); let mode: Mode = 'dry-run';
  let explicitMode = false;
  for (let i=0;i<args.length;i++) {
    const a = args[i];
    if (a==='--profiles' && args[i+1]) { profilesPath=args[++i]; continue; }
    const modes: Record<string,Mode> = {'--dry-run':'dry-run','--check':'check','--apply':'apply','--register':'register','--ready':'ready'};
    const value = modes[a];
    if (!value || explicitMode) throw new Error('invalid-arguments'); mode=value; explicitMode=true;
  }
  const profiles = await loadProfiles(profilesPath);
  if (mode==='ready') {
    const ready = await socialReadiness(profiles); console.log(JSON.stringify({status:ready?'ready':'not-ready'})); if(!ready) process.exitCode=1;
  } else {
    const results = await collectSocial(profiles);
    if (mode==='apply'||mode==='register') { usedDb=results.some(r=>r.status==='ok'); await operateSocial(profiles,results,mode); await saveHealth(results); }
    console.log(JSON.stringify({mode,status:profiles.status,sources:publicResults(results)}));
    if (profiles.status==='invalid-profile' || results.some(r=>['read-failed','needs-auth','needs-dependency'].includes(r.status)||r.operation==='operation-rejected')) process.exitCode=1;
  }
} catch { console.log(JSON.stringify({status:'failed',reason:'social-operation-failed'})); process.exitCode=1; }
finally { if (usedDb) { try { const { stopBoss } = await import('../packages/backend/src/jobs/queue.ts'); await stopBoss(); const { closeDb } = await import('../packages/backend/src/db.ts'); await closeDb(); } catch { /* Safe failure already reported. */ } } }
