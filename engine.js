import {randomInt,randomUUID} from 'node:crypto';
export const roles=['Duke','Assassin','Captain','Ambassador','Contessa'];
export const actions={income:{gain:1},aid:{gain:2,blocks:['Duke']},tax:{gain:3,role:'Duke'},exchange:{role:'Ambassador'},steal:{role:'Captain',target:true,blocks:['Captain','Ambassador']},assassinate:{role:'Assassin',cost:3,target:true,blocks:['Contessa']},coup:{cost:7,target:true}};
const require=(v,s)=>{if(!v)throw new Error(s)};
const alive=p=>p.cards.some(c=>!c.revealed);
const active=s=>s.players.filter(alive);
function shuffle(a){for(let i=a.length-1;i>0;i--){let j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function linkThread(s){if(!s.currentThread)return;const i=(s.threads||[]).findIndex(t=>t.id===s.currentThread.id);if(i>=0)s.threads[i]=s.currentThread;}
const log=(s,text)=>{s.log.push(text);s.log=s.log.slice(-100);if(s.currentThread){s.currentThread.events.push(text);}};
function privateNotice(s,id,text){s.privateNotices??=[];s.privateNotices.push({id,text,turn:s.turnNumber||0});s.privateNotices=s.privateNotices.slice(-100);}
function beginThread(s,actor,kind,target){s.threads??=[];const t={id:(s.turnNumber??0)+1,actor,kind,target,events:[],complete:false};s.turnNumber=t.id;s.currentThread=t;s.threads.push(t);s.threads=s.threads.slice(-50);}

export function newRoom(code,p){return {code,players:[{...p,coins:0,cards:[]}],host:p.id,status:'lobby',turn:0,phase:null,deck:[],log:[],round:0}}
export function addPlayer(s,p){require(s.status==='lobby','This game has already started.');require(s.players.length<6,'Room is full.');require(!s.players.some(x=>x.name.toLowerCase()===p.name.toLowerCase()),'That name is already at the table.');s.players.push({...p,coins:0,cards:[]});}
function finish(s){if(s.currentThread){s.currentThread.complete=true;log(s,'Turn resolved.');}for(const p of s.players)if(!alive(p))p.coins=0;if(active(s).length===1){if(s.currentThread)s.currentThread.complete=true;s.status='finished';s.winner=active(s)[0].id;s.phase=null;log(s,`${active(s)[0].name} wins.`);return;} do{s.turn=(s.turn+1)%s.players.length}while(!alive(s.players[s.turn]));s.phase={type:'turn'};s.action=null;}
function lose(s,id,next,reason){const p=s.players.find(p=>p.id===id);if(!alive(p)){continueStep(s,next);return;} s.phase={type:'lose',player:id,next,reason};}
function windowFor(s,type){const a=s.action;let eligible=active(s).filter(p=>p.id!==a.actor).map(p=>p.id);if(type==='block'&&a.kind!=='aid')eligible=eligible.filter(id=>id===a.target);if(type==='blockChallenge')eligible=active(s).filter(p=>p.id!==a.blocker).map(p=>p.id);s.phase={type,eligible,passed:[]};if(!eligible.length)continueStep(s,type==='challenge'?'block':type==='block'?'execute':'blocked');}
function continueStep(s,step){if(step==='end'){finish(s);return;}if(step==='challenge'){windowFor(s,'challenge');return;}if(step==='block'){if(actions[s.action.kind].blocks)windowFor(s,'block');else continueStep(s,'execute');return;}if(step==='blocked'){log(s,'The action was blocked.');finish(s);return;}if(step==='refund'){let a=s.action;s.players.find(p=>p.id===a.actor).coins+=actions[a.kind].cost||0;finish(s);return;}if(step==='execute')execute(s);}
function execute(s){const a=s.action,p=s.players.find(p=>p.id===a.actor),target=s.players.find(p=>p.id===a.target),def=actions[a.kind];if(!alive(p)){finish(s);return;}if(def.gain)p.coins+=def.gain;if(a.kind==='steal'){const n=Math.min(2,target.coins);target.coins-=n;p.coins+=n;log(s,`${p.name} stole ${n} coin${n===1?'':'s'} from ${target.name}.`);}if(a.kind==='exchange'){s.phase={type:'exchange',player:p.id,cards:[...p.cards.filter(c=>!c.revealed),...s.deck.splice(0,2).map(role=>({id:randomUUID(),role,revealed:false}))],keep:p.cards.filter(c=>!c.revealed).length};return;}if(a.kind==='coup'||a.kind==='assassinate'){lose(s,a.target,'end',{kind:a.kind,actor:a.actor});return;}finish(s);}
function applyMove(s,id,m){if(m.type==='remove'){removePlayer(s,id,m.target);return;}const p=s.players.find(p=>p.id===id);require(p&&!p.removed,'You are not in this room.');if(m.type==='start'){require(id===s.host,'Only the host can start.');require(s.status==='lobby'||s.status==='finished','Game is already running.');require(s.players.length>=2,'Invite at least one friend.');s.players=s.players.filter(x=>!x.removed);require(s.players.length>=2,'Invite at least one friend.');const previousWinner=s.winner;s.deck=shuffle(roles.flatMap(r=>[r,r,r]));for(const x of s.players){x.cards=s.deck.splice(0,2).map(role=>({id:randomUUID(),role,revealed:false}));x.coins=2;}s.status='playing';s.turn=previousWinner?s.players.findIndex(p=>p.id===previousWinner):0;if(s.players.length===2)s.players[s.turn].coins=1;s.phase={type:'turn'};s.round++;s.winner=null;s.action=null;s.log=[];s.threads=[];s.currentThread=null;s.turnNumber=0;s.privateNotices=[];log(s,`Round ${s.round} started.`);return;}
 require(s.status==='playing','No game is in progress.');const ph=s.phase;
 if(m.type==='action'){require(ph.type==='turn'&&s.players[s.turn].id===id,'Not your turn.');const d=actions[m.action];require(d,'Unknown action.');require(p.coins<10||m.action==='coup','At 10 coins you must Coup.');require(p.coins>=(d.cost||0),'Not enough coins.');if(d.target)require(s.players.some(x=>x.id===m.target&&x.id!==id&&alive(x)),'Choose a living opponent.');p.coins-=d.cost||0;s.action={actor:id,kind:m.action,target:m.target};beginThread(s,id,m.action,m.target);log(s,`${p.name} chose ${m.action}${d.role?` (claims ${d.role})`:''}${d.target?' against '+s.players.find(p=>p.id===m.target).name:''}.`);continueStep(s,d.role?'challenge':d.blocks?'block':'execute');return;}
 if(m.type==='pass'){require(['challenge','block','blockChallenge'].includes(ph.type)&&ph.eligible.includes(id)&&!ph.passed.includes(id),'No response needed from you.');ph.passed.push(id);if(ph.eligible.every(x=>ph.passed.includes(x)))continueStep(s,ph.type==='challenge'?'block':ph.type==='block'?'execute':'blocked');return;}
 if(m.type==='block'){require(ph.type==='block'&&ph.eligible.includes(id)&&!ph.passed.includes(id),'You cannot block this.');require(actions[s.action.kind].blocks.includes(m.role),'Invalid block role.');s.action.blocker=id;s.action.blockRole=m.role;log(s,`${p.name} blocks, claiming ${m.role}.`);windowFor(s,'blockChallenge');return;}
 if(m.type==='challenge'){require(['challenge','blockChallenge'].includes(ph.type)&&ph.eligible.includes(id)&&!ph.passed.includes(id),'You cannot challenge now.');const block=ph.type==='blockChallenge',claimed=block?s.action.blocker:s.action.actor,role=block?s.action.blockRole:actions[s.action.kind].role;log(s,`${p.name} challenges ${role}.`);s.phase={type:'prove',player:claimed,challenger:id,role,block};return;}
 if(m.type==='prove'||m.type==='concede'){require(ph.type==='prove'&&ph.player===id,'Not your proof to resolve.');if(m.type==='prove'){const card=p.cards.find(c=>c.id===m.card&&!c.revealed&&c.role===ph.role);require(card,'Choose a hidden card of the claimed role.');const oldRole=card.role;s.deck.push(oldRole);shuffle(s.deck);card.role=s.deck.shift();log(s,`${p.name} proved ${oldRole}, then drew a replacement. ${s.players.find(x=>x.id===ph.challenger).name} loses the challenge.`);lose(s,ph.challenger,ph.block?'blocked':'block',{kind:'failedChallenge',actor:id,role:ph.role});}else{log(s,`${p.name} concedes the ${ph.role} challenge. ${s.players.find(x=>x.id===ph.challenger).name} wins the challenge.`);lose(s,id,ph.block?'execute':'refund',{kind:'conceded',actor:ph.challenger,role:ph.role});}return;}
 if(m.type==='lose'){require(ph.type==='lose'&&ph.player===id,'Not your influence to lose.');const card=p.cards.find(c=>c.id===m.card&&!c.revealed);require(card,'Choose a hidden card.');card.revealed=true;log(s,`${p.name} lost ${card.role}.`);continueStep(s,ph.next);return;}
 if(m.type==='exchange'){require(ph.type==='exchange'&&ph.player===id,'Not your exchange.');require(Array.isArray(m.cards)&&m.cards.length===ph.keep&&new Set(m.cards).size===ph.keep&&m.cards.every(id=>ph.cards.some(c=>c.id===id)),'Select exactly your remaining influence count.');p.cards=[...p.cards.filter(c=>c.revealed),...ph.cards.filter(c=>m.cards.includes(c.id))];s.deck.push(...ph.cards.filter(c=>!m.cards.includes(c.id)).map(c=>c.role));shuffle(s.deck);log(s,`${p.name} exchanged with the court.`);finish(s);return;}
 throw new Error('Invalid move.');}
export function view(s,id){const v=structuredClone(s);const ownName=v.players.find(p=>p.id===id)?.name;const oldTimeout=x=>x.includes('timed out')||x.includes('Original influence kept');v.privateNotices=(v.privateNotices||[]).filter(x=>x.id===id);for(const text of v.log.filter(oldTimeout)){if(ownName&&text.startsWith(ownName+"'s"))v.privateNotices.push({id,text,turn:0});}v.log=v.log.filter(x=>!oldTimeout(x));for(const t of [...(v.threads||[]),v.currentThread].filter(Boolean))t.events=t.events.filter(x=>!oldTimeout(x));if(v.phase?.type==='lose'&&!v.phase.reason){const ph=v.phase;ph.reason={kind:ph.next==='end'?v.action?.kind:['blocked','block'].includes(ph.next)?'failedChallenge':'conceded',actor:ph.next==='end'?v.action?.actor:undefined};}v.deckCount=v.deck.length;delete v.deck;for(const p of v.players){delete p.tokenHash;delete p.token;p.cards=p.cards.map((c,i)=>c.revealed||p.id===id?c:{id:`hidden-${p.id}-${i}`,revealed:false});}if(v.phase?.type==='exchange'&&v.phase.player!==id)delete v.phase.cards;if(v.phase?.next)delete v.phase.next;return v;}

export function armTimer(s,now=Date.now()){
 if(s.status!=="playing"||!s.phase)return;
 s.phase.deadline=now+(s.phase.type==="turn"?60000:30000);
}
export function move(s,id,m,now=Date.now()){
 linkThread(s);const previous=s.phase;applyMove(s,id,m);
 if(s.phase!==previous||!s.phase?.deadline)armTimer(s,now);
}
export function expireTimer(s,now=Date.now()){
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

export function removePlayer(s,id,target){
 linkThread(s);
 require(id===s.host,'Only the host can remove players.');require(target!==id,'You cannot remove yourself.');
 const p=s.players.find(p=>p.id===target);require(p&&!p.removed,'Choose a player at this table.');
 if(s.status==='lobby'||s.status==='finished'){s.players=s.players.filter(x=>x.id!==target);if(s.winner===target)s.winner=null;log(s,`${p.name} was removed by the host.`);return;}
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
