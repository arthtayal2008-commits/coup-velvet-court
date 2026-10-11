import { RoomServiceClient } from 'livekit-server-sdk';
import { neon } from '@neondatabase/serverless';
import { profileFor, tables as accountTables } from './auth.js';
import { randomBytes, createHash, randomUUID, randomInt } from 'node:crypto';
const roles=['Duke','Assassin','Captain','Ambassador','Contessa'];
const actions={income:{gain:1},aid:{gain:2,blocks:['Duke']},tax:{gain:3,role:'Duke'},exchange:{role:'Ambassador'},steal:{role:'Captain',target:true,blocks:['Captain','Ambassador']},assassinate:{role:'Assassin',cost:3,target:true,blocks:['Contessa']},coup:{cost:7,target:true}};
const require=(v,s)=>{if(!v)throw new Error(s)};
const alive=p=>p.cards.some(c=>!c.revealed);
const active=s=>s.players.filter(alive);
function shuffle(a){for(let i=a.length-1;i>0;i--){let j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function linkThread(s){if(!s.currentThread)return;const i=(s.threads||[]).findIndex(t=>t.id===s.currentThread.id);if(i>=0)s.threads[i]=s.currentThread;}
const log=(s,text)=>{s.log.push(text);s.log=s.log.slice(-100);if(s.currentThread){s.currentThread.events.push(text);}};
function privateNotice(s,id,text){s.privateNotices??=[];s.privateNotices.push({id,text,turn:s.turnNumber||0});s.privateNotices=s.privateNotices.slice(-100);}
function beginThread(s,actor,kind,target){s.threads??=[];const t={id:(s.turnNumber??0)+1,actor,kind,target,events:[],complete:false};s.turnNumber=t.id;s.currentThread=t;s.threads.push(t);s.threads=s.threads.slice(-50);}

function newRoom(code,p){return {code,players:[{...p,coins:0,cards:[]}],host:p.id,status:'lobby',turn:0,phase:null,deck:[],log:[],round:0}}
function addPlayer(s,p){require(s.players.filter(x=>!x.removed).length<30,'Room spectator queue is full.');require(!s.players.some(x=>!x.removed&&x.name.toLowerCase()===p.name.toLowerCase()),'That name is already at the table.');const spectator=s.status!=='lobby'||s.players.filter(x=>!x.removed&&!x.spectator).length>=6;s.players.push({...p,coins:0,cards:[],spectator,lastSeen:Date.now()});}
function finish(s){if(s.currentThread){s.currentThread.complete=true;log(s,'Turn resolved.');}for(const p of s.players)if(!alive(p))p.coins=0;if(active(s).length===1){if(s.currentThread)s.currentThread.complete=true;s.status='finished';s.winner=active(s)[0].id;s.phase=null;log(s,`${active(s)[0].name} wins.`);return;} do{s.turn=(s.turn+1)%s.players.length}while(!alive(s.players[s.turn]));s.phase={type:'turn'};s.action=null;}
function lose(s,id,next,reason){const p=s.players.find(p=>p.id===id);if(!alive(p)){continueStep(s,next);return;} s.phase={type:'lose',player:id,next,reason};}
function windowFor(s,type){const a=s.action;let eligible=active(s).filter(p=>p.id!==a.actor).map(p=>p.id);if(type==='block'&&a.kind!=='aid')eligible=eligible.filter(id=>id===a.target);if(type==='blockChallenge')eligible=active(s).filter(p=>p.id!==a.blocker).map(p=>p.id);s.phase={type,eligible,passed:[]};if(!eligible.length)continueStep(s,type==='challenge'?'block':type==='block'?'execute':'blocked');}
function continueStep(s,step){if(step==='end'){finish(s);return;}if(step==='challenge'){windowFor(s,'challenge');return;}if(step==='block'){if(actions[s.action.kind].blocks)windowFor(s,'block');else continueStep(s,'execute');return;}if(step==='blocked'){log(s,'The action was blocked.');finish(s);return;}if(step==='refund'){let a=s.action;s.players.find(p=>p.id===a.actor).coins+=actions[a.kind].cost||0;finish(s);return;}if(step==='execute')execute(s);}
function execute(s){const a=s.action,p=s.players.find(p=>p.id===a.actor),target=s.players.find(p=>p.id===a.target),def=actions[a.kind];if(!alive(p)){finish(s);return;}if(def.gain)p.coins+=def.gain;if(a.kind==='steal'){const n=Math.min(2,target.coins);target.coins-=n;p.coins+=n;log(s,`${p.name} stole ${n} coin${n===1?'':'s'} from ${target.name}.`);}if(a.kind==='exchange'){s.phase={type:'exchange',player:p.id,cards:[...p.cards.filter(c=>!c.revealed),...s.deck.splice(0,2).map(role=>({id:randomUUID(),role,revealed:false}))],keep:p.cards.filter(c=>!c.revealed).length};return;}if(a.kind==='coup'||a.kind==='assassinate'){lose(s,a.target,'end',{kind:a.kind,actor:a.actor});return;}finish(s);}
function applyMove(s,id,m){require(m&&typeof m==='object'&&!Array.isArray(m)&&typeof m.type==='string'&&m.type.length<24,'Invalid move.');if(m.type==='remove'){removePlayer(s,id,m.target);return;}const p=s.players.find(p=>p.id===id);require(p&&!p.removed,'You are not in this room.');if(m.type==='ready'){require(s.readyCheck&&s.status!=='playing','No ready check is open.');p.ready=true;return;}
 if(m.type==='queue'||m.type==='promote'){require(id===s.host,'Only the host can change seats.');require(s.readyCheck&&s.status!=='playing','No ready check is open.');const target=s.players.find(x=>x.id===m.target&&!x.removed);require(target&&target.id!==id,'Choose another player.');if(m.type==='queue'){target.spectator=true;target.cards=[];target.coins=0;target.lastSeen=Date.now();s.players=s.players.filter(x=>x.id!==target.id);s.players.push(target);}else{require(target.spectator&&target.ready,'Choose a ready spectator.');require(s.players.filter(x=>!x.removed&&!x.spectator).length<6,'Room seats are full. Move someone to the queue first.');target.spectator=false;}return;}
 if(m.type==='start'||m.type==='deal'){require(id===s.host,'Only the host can start.');require(s.status==='lobby'||s.status==='finished','Game is already running.');if(m.type==='start'&&s.round>0){require(!s.readyCheck,'Game ready check is already open.');s.readyCheck={id:randomUUID()};for(const x of s.players)x.ready=x.id===id;return;}if(m.type==='deal')require(s.readyCheck,'No ready check is open.');require(s.status==='lobby'||s.status==='finished','Game is already running.');s.players=s.players.filter(x=>!x.removed);const seated=s.players.filter(x=>!x.spectator),queued=s.players.filter(x=>x.spectator);const ordered=[...seated,...queued];const next=(s.readyCheck?ordered.filter(x=>x.ready):ordered).slice(0,6);require(next.length>=2,s.readyCheck?'Invite at least one friend to click Ready.':'Invite at least one friend.');s.players=ordered.filter(x=>next.includes(x)).concat(ordered.filter(x=>!next.includes(x)));s.readyCheck=null;const previousWinner=s.winner;s.deck=shuffle(roles.flatMap(r=>[r,r,r]));for(const x of s.players){x.spectator=!next.includes(x);x.cards=x.spectator?[]:s.deck.splice(0,2).map(role=>({id:randomUUID(),role,revealed:false}));x.coins=x.spectator?0:2;if(x.spectator)x.lastSeen=Date.now();x.ready=false;}s.status='playing';s.turn=Math.max(0,previousWinner?s.players.findIndex(p=>p.id===previousWinner&&!p.spectator):s.players.findIndex(p=>!p.spectator));if(next.length===2)s.players[s.turn].coins=1;s.phase={type:'turn'};s.round++;s.winner=null;s.action=null;s.log=[];s.threads=[];s.currentThread=null;s.turnNumber=0;s.privateNotices=[];log(s,`Round ${s.round} started.`);return;}
 require(s.status==='playing','No game is in progress.');require(!p.spectator,'You are spectating until the next round.');const ph=s.phase;
 if(m.type==='action'){require(ph.type==='turn'&&s.players[s.turn].id===id,'Not your turn.');const d=Object.hasOwn(actions,m.action)?actions[m.action]:null;require(d,'Unknown action.');require(p.coins<10||m.action==='coup','At 10 coins you must Coup.');require(p.coins>=(d.cost||0),'Not enough coins.');if(d.target)require(s.players.some(x=>x.id===m.target&&x.id!==id&&alive(x)),'Choose a living opponent.');p.coins-=d.cost||0;s.action={actor:id,kind:m.action,target:d.target?m.target:undefined};beginThread(s,id,m.action,d.target?m.target:undefined);log(s,`${p.name} chose ${m.action}${d.role?` (claims ${d.role})`:''}${d.target?' against '+s.players.find(p=>p.id===m.target).name:''}.`);continueStep(s,d.role?'challenge':d.blocks?'block':'execute');return;}
 if(m.type==='pass'){require(['challenge','block','blockChallenge'].includes(ph.type)&&ph.eligible.includes(id)&&!ph.passed.includes(id),'No response needed from you.');ph.passed.push(id);if(ph.eligible.every(x=>ph.passed.includes(x)))continueStep(s,ph.type==='challenge'?'block':ph.type==='block'?'execute':'blocked');return;}
 if(m.type==='block'){require(ph.type==='block'&&ph.eligible.includes(id)&&!ph.passed.includes(id),'You cannot block this.');require(actions[s.action.kind].blocks.includes(m.role),'Invalid block role.');s.action.blocker=id;s.action.blockRole=m.role;log(s,`${p.name} blocks, claiming ${m.role}.`);windowFor(s,'blockChallenge');return;}
 if(m.type==='challenge'){require(['challenge','blockChallenge'].includes(ph.type)&&ph.eligible.includes(id)&&!ph.passed.includes(id),'You cannot challenge now.');const block=ph.type==='blockChallenge',claimed=block?s.action.blocker:s.action.actor,role=block?s.action.blockRole:actions[s.action.kind].role;log(s,`${p.name} challenges ${role}.`);s.phase={type:'prove',player:claimed,challenger:id,role,block};return;}
 if(m.type==='prove'||m.type==='concede'){require(ph.type==='prove'&&ph.player===id,'Not your proof to resolve.');if(m.type==='prove'){const card=p.cards.find(c=>c.id===m.card&&!c.revealed&&c.role===ph.role);require(card,'Choose a hidden card of the claimed role.');const oldRole=card.role;s.deck.push(oldRole);shuffle(s.deck);card.role=s.deck.shift();log(s,`${p.name} proved ${oldRole}, then drew a replacement. ${s.players.find(x=>x.id===ph.challenger).name} loses the challenge.`);lose(s,ph.challenger,ph.block?'blocked':'block',{kind:'failedChallenge',actor:id,role:ph.role});}else{log(s,`${p.name} concedes the ${ph.role} challenge. ${s.players.find(x=>x.id===ph.challenger).name} wins the challenge.`);lose(s,id,ph.block?'execute':'refund',{kind:'conceded',actor:ph.challenger,role:ph.role});}return;}
 if(m.type==='lose'){require(ph.type==='lose'&&ph.player===id,'Not your influence to lose.');const card=p.cards.find(c=>c.id===m.card&&!c.revealed);require(card,'Choose a hidden card.');card.revealed=true;log(s,`${p.name} lost ${card.role}.`);continueStep(s,ph.next);return;}
 if(m.type==='exchange'){require(ph.type==='exchange'&&ph.player===id,'Not your exchange.');require(Array.isArray(m.cards)&&m.cards.length===ph.keep&&new Set(m.cards).size===ph.keep&&m.cards.every(id=>ph.cards.some(c=>c.id===id)),'Select exactly your remaining influence count.');p.cards=[...p.cards.filter(c=>c.revealed),...ph.cards.filter(c=>m.cards.includes(c.id))];s.deck.push(...ph.cards.filter(c=>!m.cards.includes(c.id)).map(c=>c.role));shuffle(s.deck);log(s,`${p.name} exchanged with the court.`);finish(s);return;}
 throw new Error('Invalid move.');}
function view(s,id){const v=structuredClone(s);const ownName=v.players.find(p=>p.id===id)?.name;const oldTimeout=x=>x.includes('timed out')||x.includes('Original influence kept');v.privateNotices=(v.privateNotices||[]).filter(x=>x.id===id);for(const text of v.log.filter(oldTimeout)){if(ownName&&text.startsWith(ownName+"'s"))v.privateNotices.push({id,text,turn:0});}v.log=v.log.filter(x=>!oldTimeout(x));for(const t of [...(v.threads||[]),v.currentThread].filter(Boolean))t.events=t.events.filter(x=>!oldTimeout(x));if(v.phase?.type==='lose'&&!v.phase.reason){const ph=v.phase;ph.reason={kind:ph.next==='end'?v.action?.kind:['blocked','block'].includes(ph.next)?'failedChallenge':'conceded',actor:ph.next==='end'?v.action?.actor:undefined};}v.deckCount=v.deck.length;delete v.deck;for(const p of v.players){delete p.tokenHash;delete p.token;p.ranked=!!p.profileId;delete p.profileId;p.cards=p.cards.map((c,i)=>c.revealed||p.id===id?c:{id:`hidden-${p.id}-${i}`,revealed:false});}if(v.phase?.type==='exchange'&&v.phase.player!==id)delete v.phase.cards;if(v.phase?.next)delete v.phase.next;const turnId=v.players[v.turn]?.id;v.spectators=v.players.filter(p=>p.spectator);v.players=v.players.filter(p=>!p.spectator);v.turn=Math.max(0,v.players.findIndex(p=>p.id===turnId));return v;}

function armTimer(s,now=Date.now()){
 if(s.status!=="playing"||!s.phase)return;
 s.phase.deadline=now+(s.phase.type==="turn"?45000:s.phase.type==="exchange"?30000:20000);
}
function move(s,id,m,now=Date.now()){
 linkThread(s);const previous=s.phase;applyMove(s,id,m);
 if(s.phase!==previous||!s.phase?.deadline)armTimer(s,now);
}
function expireTimer(s,now=Date.now()){
 linkThread(s);if(s.status!=="playing"||!s.phase)return false;
 if(!s.phase.deadline){armTimer(s,now);return true;}
 if(now<s.phase.deadline)return false;
 const ph=s.phase;
 if(ph.type==="turn"){
  const p=s.players[s.turn];let m={type:"action",action:"income"};
  if(p.coins>=10){const targets=active(s).filter(x=>x.id!==p.id);m={type:"action",action:"coup",target:targets[randomInt(targets.length)].id};}
  move(s,p.id,m,now);privateNotice(s,p.id,`${p.name}'s turn timed out. Automatic ${m.action}.`);
 }else if(["challenge","block","blockChallenge"].includes(ph.type)){
  for(const id of ph.eligible.filter(id=>!ph.passed.includes(id)))privateNotice(s,id,`${s.players.find(x=>x.id===id).name}'s response timed out. Automatically passed.`);
  for(const id of ph.eligible.filter(id=>!ph.passed.includes(id))){if(s.phase!==ph)break;move(s,id,{type:"pass"},now);}
 }else if(ph.type==="prove"){
  const p=s.players.find(x=>x.id===ph.player),c=p.cards.find(c=>!c.revealed&&c.role===ph.role);
  privateNotice(s,p.id,`${p.name}'s proof choice timed out.`);move(s,p.id,c?{type:"prove",card:c.id}:{type:"concede"},now);
 }else if(ph.type==="lose"){
  const p=s.players.find(x=>x.id===ph.player),cards=p.cards.filter(c=>!c.revealed);
  privateNotice(s,p.id,`${p.name}'s reveal choice timed out. Random influence revealed.`);move(s,p.id,{type:"lose",card:cards[randomInt(cards.length)].id},now);
 }else if(ph.type==="exchange"){
  privateNotice(s,ph.player,`${s.players.find(x=>x.id===ph.player).name}'s exchange timed out. Original influence kept.`);move(s,ph.player,{type:"exchange",cards:ph.cards.slice(0,ph.keep).map(c=>c.id)},now);
 }else return false;
 return true;
}

function removePlayer(s,id,target){
 linkThread(s);
 require(id===s.host,'Only the host can remove players.');require(target!==id,'You cannot remove yourself.');
 const p=s.players.find(p=>p.id===target);require(p&&!p.removed,'Choose a player at this table.');
 if(p.spectator||s.status==='lobby'||s.status==='finished'){const turnId=s.players[s.turn]?.id;s.players=s.players.filter(x=>x.id!==target);if(s.status==='playing')s.turn=s.players.findIndex(x=>x.id===turnId);if(s.winner===target)s.winner=null;log(s,`${p.name} was removed by the host.`);return;}
 const ph=s.phase,a=s.action;
 const involved=s.players[s.turn].id===target||ph.player===target||ph.challenger===target||a?.target===target||a?.blocker===target;
 // Return temporary exchange draws before elimination or cancellation.
 if(involved&&ph.type==='exchange')s.deck.push(...ph.cards.slice(ph.keep).map(c=>c.role));
 for(const c of p.cards)c.revealed=true;p.coins=0;p.removed=true;log(s,`${p.name} was removed by the host and eliminated.`);
 if(active(s).length===1){if(s.currentThread)s.currentThread.complete=true;s.status='finished';s.winner=active(s)[0].id;s.phase=null;s.action=null;log(s,`${active(s)[0].name} wins.`);return;}
 if(involved){if(a){const actor=s.players.find(x=>x.id===a.actor);if(alive(actor))actor.coins+=actions[a.kind].cost||0;log(s,'Interrupted action cancelled. Paid action cost returned.');}finish(s);return;}
 if(['challenge','block','blockChallenge'].includes(ph.type)){
  ph.eligible=ph.eligible.filter(x=>x!==target);ph.passed=ph.passed.filter(x=>x!==target);
  if(ph.eligible.every(x=>ph.passed.includes(x)))continueStep(s,ph.type==='challenge'?'block':ph.type==='block'?'execute':'blocked');
 }
}

const hash=t=>createHash('sha256').update(t).digest('hex');
const sql=()=>neon(process.env.DATABASE_URL||process.env.POSTGRES_URL);
const json=(res,n,v)=>res.status(n).json({...v,serverNow:Date.now()});
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');try{
 const db=sql();await db`CREATE TABLE IF NOT EXISTS coup_rooms (code TEXT PRIMARY KEY, state JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
 if(!await limit(db,'read:'+req.headers['x-forwarded-for']?.split(',')[0],600,60))return json(res,429,{error:'Too many requests. Slow down.'});const token=req.headers.authorization?.replace(/^Bearer /,'');let body=req.body||{};if((typeof body==='string'?body.length:JSON.stringify(body).length)>8192)return json(res,413,{error:'Request too large.'});if(typeof body==='string')body=JSON.parse(body);const code=String(req.query.code||body.code||'').toUpperCase();
 if(req.method==='POST'&&['create','join'].includes(body.type)&&!await limit(db,'entry:'+body.type+':'+req.headers['x-forwarded-for']?.split(',')[0],body.type==='create'?15:40,600))return json(res,429,{error:'Too many room requests. Wait a few minutes.'});if(req.method==='POST'&&body.type==='create'){const name=cleanName(body.name);const token=randomBytes(24).toString('hex'),id=randomUUID(),code=randomBytes(5).toString('hex').slice(0,6).toUpperCase(),p={id,name,tokenHash:hash(token)};const prof=await profileFor(db,req).catch(()=>null);if(prof)p.profileId=prof.id;const s=newRoom(code,p);await db`INSERT INTO coup_rooms (code,state) VALUES (${code},${JSON.stringify(s)}::jsonb)`;return json(res,200,{token,id,code,state:view(s,id),version:0});}
 if(!/^[A-F0-9]{6}$/.test(code))return json(res,400,{error:'Enter a valid six-character room code.'});
 const rows=await db`SELECT state,version FROM coup_rooms WHERE code=${code} AND updated_at > NOW()-INTERVAL '24 hours'`;if(!rows.length)return json(res,404,{error:'Room not found or expired.'});let {state:s,version}=rows[0];
 if(req.method==='POST'&&body.type==='join'){const name=cleanName(body.name),newToken=randomBytes(24).toString('hex'),id=randomUUID();const prof=await profileFor(db,req).catch(()=>null);addPlayer(s,{id,name,tokenHash:hash(newToken),...(prof&&!s.players.some(x=>!x.removed&&x.profileId===prof.id)?{profileId:prof.id}:{})});const saved=await db`UPDATE coup_rooms SET state=${JSON.stringify(s)}::jsonb,version=version+1,updated_at=NOW() WHERE code=${code} AND version=${version} RETURNING version`;if(!saved.length)return json(res,409,{error:'Someone joined at the same time. Please try again.'});return json(res,200,{token:newToken,id,code,state:view(s,id),version:saved[0].version});}
 const p=typeof token==='string'&&token.length<=128&&s.players.find(p=>!p.removed&&p.tokenHash===hash(token));if(!p)return json(res,401,{error:'Join this room first.'});
 let before=snap(s),linkChanged=false;if(!p.profileId&&/(^|;\s*)coup_account=/.test(req.headers.cookie||'')){const prof=await profileFor(db,req).catch(()=>null);if(prof&&!s.players.some(x=>!x.removed&&x.profileId===prof.id)){p.profileId=prof.id;linkChanged=true;}}
 let queueChanged=false;const now=Date.now();for(const q of s.players.filter(x=>x.spectator&&!x.removed)){if(q.lastSeen&&now-q.lastSeen>120000){q.removed=true;queueChanged=true;}else if(q.id===p.id){if(!q.lastSeen||now-q.lastSeen>30000){q.lastSeen=now;queueChanged=true;}}else if(!q.lastSeen){q.lastSeen=now;queueChanged=true;}}
 if(expireTimer(s)||queueChanged||linkChanged){track(before,s);
 const saved=await db`UPDATE coup_rooms SET state=${JSON.stringify(s)}::jsonb,version=version+1,updated_at=NOW() WHERE code=${code} AND version=${version} RETURNING version`;
 if(!saved.length)return json(res,409,{error:'The table changed. Refreshing.'});
 version=saved[0].version;
 await award(db,before,s);before=snap(s);
 }
 if(req.method==='GET')return json(res,200,{state:view(s,p.id),version});
 if(req.method!=='POST')return json(res,405,{error:'Method not supported.'});
 if(!body.move||typeof body.move!=='object'||Array.isArray(body.move))return json(res,400,{error:'Invalid move.'});if(!await limit(db,'move:'+code+':'+p.id,120,60))return json(res,429,{error:'Too many actions. Slow down.'});if(body.version!==version)return json(res,409,{error:'The table changed. Your view has been refreshed.'});move(s,p.id,body.move);track(before,s);const saved=await db`UPDATE coup_rooms SET state=${JSON.stringify(s)}::jsonb,version=version+1,updated_at=NOW() WHERE code=${code} AND version=${version} RETURNING version`;if(!saved.length)return json(res,409,{error:'Another move arrived first. Refreshing the table.'});await award(db,before,s);if(body.move?.type==='remove'&&process.env.LIVEKIT_URL&&process.env.LIVEKIT_API_KEY&&process.env.LIVEKIT_API_SECRET){try{const svc=new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^wss:/,'https:'),process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);await svc.removeParticipant('coup-'+code,body.move.target,{revokeTokenTs:BigInt(Math.floor(Date.now()/1000)+1)});}catch{console.error('Voice removal failed');return json(res,200,{state:view(s,p.id),version:saved[0].version,voiceWarning:'Player removed. Voice disconnect could not be confirmed.'});}}return json(res,200,{state:view(s,p.id),version:saved[0].version});
 }catch(e){const expected=['Unknown','Choose','Not ','Invalid','Only ','At 10','No ','That ','Room ','This ','Invite','Game ','You ','Select'];const safe=expected.some(x=>e.message.startsWith(x));console.error(safe?e.message:'Game service failure');return json(res,safe?400:503,{error:safe?e.message:'The table is temporarily unavailable. Try again shortly.'});}}
// ── Results: elimination order, final standings, points (outside the rules engine) ──
function snap(s){return {round:s.round,status:s.status,alive:s.players.filter(p=>!p.spectator&&alive(p)).map(p=>p.id)};}
function track(before,s){
 if(s.status==='playing'&&(before.round!==s.round||before.status!=='playing')){s.outOrder=[];s.roundSeats=s.players.filter(p=>!p.spectator).map(p=>p.id);s.roundStarted=Date.now();return;}
 if(before.status!=='playing')return;
 s.outOrder??=[];for(const id of before.alive){const p=s.players.find(x=>x.id===id);if((!p||!alive(p))&&!s.outOrder.includes(id))s.outOrder.push(id);}
 if(s.status==='finished')s.lastResult=standings(s);}
function standings(s){const seats=s.roundSeats||s.players.filter(p=>!p.spectator).map(p=>p.id),n=seats.length;
 const order=[...new Set([s.winner,...(s.outOrder||[]).slice().reverse(),...seats])].filter(id=>id&&seats.includes(id));
 return {round:s.round,players:n,standings:order.map((id,i)=>{const p=s.players.find(x=>x.id===id),place=i+1;return {id,name:p?.name||'Player',place,points:(n-place)*10+(place===1?20:0),ranked:!!p?.profileId,removed:!!p?.removed};})};}
async function award(db,before,s){if(before.status!=='playing'||s.status!=='finished'||!s.lastResult)return;try{
 await accountTables(db);const roundId=s.code+':'+s.round+':'+(s.roundStarted||0);
 const first=await db`INSERT INTO coup_results (round_id,results,scoring) VALUES (${roundId},${JSON.stringify(s.lastResult)}::jsonb,${true}) ON CONFLICT (round_id) DO NOTHING RETURNING round_id`;if(!first.length)return;
 for(const r of s.lastResult.standings){const pid=s.players.find(x=>x.id===r.id)?.profileId;if(!pid)continue;await db`UPDATE coup_profiles SET points=points+${r.points},wins=wins+${r.place===1?1:0},games=games+1 WHERE id=${pid}`;}
}catch{console.error('Scoring failure');}}
function cleanName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>20)throw new Error('Choose a name between 1 and 20 characters.');return name.trim();}

async function limit(db,key,max,seconds){await db`CREATE TABLE IF NOT EXISTS coup_rate_limits (key TEXT PRIMARY KEY,started TIMESTAMPTZ NOT NULL DEFAULT NOW(),attempts INTEGER NOT NULL DEFAULT 1)`;const rows=await db`INSERT INTO coup_rate_limits (key) VALUES (${hash(key)}) ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN coup_rate_limits.started<NOW()-${seconds}*INTERVAL '1 second' THEN 1 ELSE coup_rate_limits.attempts+1 END,started=CASE WHEN coup_rate_limits.started<NOW()-${seconds}*INTERVAL '1 second' THEN NOW() ELSE coup_rate_limits.started END RETURNING attempts`;return rows[0].attempts<=max;}
