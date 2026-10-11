import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
// Private table messages. Stored per room for 24 hours; only the sender and recipient can read them.
const hash=t=>createHash('sha256').update(t).digest('hex');
const json=(res,n,v)=>res.status(n).json(v);
let schemaReady=false;
async function schema(db){if(schemaReady)return;await db`CREATE TABLE IF NOT EXISTS coup_messages (id BIGSERIAL PRIMARY KEY, code TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await db`CREATE INDEX IF NOT EXISTS coup_messages_code_id ON coup_messages (code, id)`;schemaReady=true;}
async function limit(db,key,max,seconds){await db`CREATE TABLE IF NOT EXISTS coup_rate_limits (key TEXT PRIMARY KEY,started TIMESTAMPTZ NOT NULL DEFAULT NOW(),attempts INTEGER NOT NULL DEFAULT 1)`;const rows=await db`INSERT INTO coup_rate_limits (key) VALUES (${hash(key)}) ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN coup_rate_limits.started<NOW()-${seconds}*INTERVAL '1 second' THEN 1 ELSE coup_rate_limits.attempts+1 END,started=CASE WHEN coup_rate_limits.started<NOW()-${seconds}*INTERVAL '1 second' THEN NOW() ELSE coup_rate_limits.started END RETURNING attempts`;return rows[0].attempts<=max;}
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');try{
 let b=req.body||{};if((typeof b==='string'?b.length:JSON.stringify(b).length)>4096)return json(res,413,{error:'Message too large.'});if(typeof b==='string')b=JSON.parse(b||'{}');
 const code=String(req.query.code||b.code||'').toUpperCase();if(!/^[A-F0-9]{6}$/.test(code))return json(res,400,{error:'Enter a valid room code.'});
 const token=req.headers.authorization?.replace(/^Bearer /,'');if(typeof token!=='string'||!token||token.length>128)return json(res,401,{error:'Join this room first.'});
 const db=neon(process.env.DATABASE_URL||process.env.POSTGRES_URL);
 if(!await limit(db,'dm-ip:'+req.headers['x-forwarded-for']?.split(',')[0],300,60))return json(res,429,{error:'Too many requests. Slow down.'});
 const rows=await db`SELECT state FROM coup_rooms WHERE code=${code} AND updated_at > NOW()-INTERVAL '24 hours'`;if(!rows.length)return json(res,404,{error:'Room expired.'});
 const s=rows[0].state,me=s.players.find(p=>!p.removed&&p.tokenHash===hash(token));if(!me)return json(res,401,{error:'Join this room first.'});
 await schema(db);
 if(req.method==='GET'){const since=Math.max(0,parseInt(req.query.since,10)||0);const m=await db`SELECT id,sender,recipient,body,created_at FROM coup_messages WHERE code=${code} AND id>${since} AND (sender=${me.id} OR recipient=${me.id}) AND created_at > NOW()-INTERVAL '24 hours' ORDER BY id ASC LIMIT 200`;return json(res,200,{messages:m.map(x=>({id:Number(x.id),from:x.sender,to:x.recipient,text:x.body,at:x.created_at}))});}
 if(req.method!=='POST')return json(res,405,{error:'Method not supported.'});
 if(!await limit(db,'dm:'+code+':'+me.id,40,60))return json(res,429,{error:'Too many messages. Slow down.'});
 const to=s.players.find(p=>p.id===b.recipient&&!p.removed);if(!to||to.id===me.id)return json(res,400,{error:'Choose another person in this room.'});
 const text=typeof b.text==='string'?b.text.trim():'';if(!text||text.length>1000)return json(res,400,{error:'Message must be 1-1000 characters.'});
 const r=await db`INSERT INTO coup_messages (code,sender,recipient,body) VALUES (${code},${me.id},${to.id},${text}) RETURNING id,created_at`;
 return json(res,200,{message:{id:Number(r[0].id),from:me.id,to:to.id,text,at:r[0].created_at}});
}catch{console.error('DM service failure');return json(res,503,{error:'Messages are temporarily unavailable.'});}}
