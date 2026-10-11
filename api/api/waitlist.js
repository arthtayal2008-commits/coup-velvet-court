import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { profileFor } from './auth.js';
// Tournament waitlist. Stores a display name and an email so players can be told when a tournament opens.
const hash=t=>createHash('sha256').update(t).digest('hex');
let ready=false;
async function schema(db){if(ready)return;await db`CREATE TABLE IF NOT EXISTS coup_waitlist (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, profile_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await db`CREATE TABLE IF NOT EXISTS coup_rate_limits (key TEXT PRIMARY KEY,started TIMESTAMPTZ NOT NULL DEFAULT NOW(),attempts INTEGER NOT NULL DEFAULT 1)`;ready=true;}
async function limit(db,key,max,seconds){const rows=await db`INSERT INTO coup_rate_limits (key) VALUES (${hash(key)}) ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN coup_rate_limits.started<NOW()-${seconds}*INTERVAL '1 second' THEN 1 ELSE coup_rate_limits.attempts+1 END,started=CASE WHEN coup_rate_limits.started<NOW()-${seconds}*INTERVAL '1 second' THEN NOW() ELSE coup_rate_limits.started END RETURNING attempts`;return rows[0].attempts<=max;}
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');try{
 const db=neon(process.env.DATABASE_URL||process.env.POSTGRES_URL);await schema(db);
 if(req.method==='GET'){const c=await db`SELECT COUNT(*)::int AS n FROM coup_waitlist`;return res.status(200).json({count:c[0].n});}
 if(req.method!=='POST')return res.status(405).json({error:'Method not supported.'});
 const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return res.status(403).json({error:'Use this site to join.'});
 let b=req.body||{};if((typeof b==='string'?b.length:JSON.stringify(b).length)>2048)return res.status(413).json({error:'Request too large.'});if(typeof b==='string')b=JSON.parse(b||'{}');
 if(!await limit(db,'waitlist:'+String(req.headers['x-forwarded-for']||'').split(',')[0],10,600))return res.status(429).json({error:'Too many sign-ups from here. Try again later.'});
 const name=typeof b.name==='string'?b.name.trim():'',email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!name||name.length>40)return res.status(400).json({error:'Enter a name up to 40 characters.'});
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});
 const profile=await profileFor(db,req).catch(()=>null);
 const rows=await db`INSERT INTO coup_waitlist (email,name,profile_id) VALUES (${email},${name},${profile?.id||null}) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING (xmax = 0) AS inserted`;
 const c=await db`SELECT COUNT(*)::int AS n FROM coup_waitlist`;
 return res.status(200).json({ok:true,already:!rows[0].inserted,count:c[0].n});
}catch{console.error('Waitlist failure');return res.status(503).json({error:'The waitlist is temporarily unavailable.'});}}
