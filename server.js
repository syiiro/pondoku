// Pondoku — Express + JSON storage. Run: npm i && npm start  (http://localhost:3001)
const express=require('express'),fs=require('fs'),crypto=require('crypto'),nodemailer=require('nodemailer');
const wa=require('./wa');
const app=express();app.use(express.json());app.use(express.static(__dirname+'/public'));
const F=__dirname+'/data.json';
const db=fs.existsSync(F)?JSON.parse(fs.readFileSync(F)):{users:[],groups:[],polls:[],outbox:[],sessions:{},mode:'demo',n:0};
db.th=db.th||{wait:14,dist:15,invite:7,consent:48};
const D=864e5;
const save=()=>{const now=Date.now();db.users.forEach(u=>{if(u.role!=='parent')return;if(['Available','Pending Consent'].includes(u.status))u.since=u.since||now;else delete u.since});fs.writeFileSync(F,JSON.stringify(db,null,1))};
const id=p=>p+(++db.n);
const hash=(pw,s=crypto.randomBytes(8).toString('hex'))=>s+':'+crypto.scryptSync(pw,s,32).toString('hex');
const ok=(pw,h)=>hash(pw,h.split(':')[0])===h;
if(!db.users.find(u=>u.role==='admin')){db.users.push({id:id('u'),email:'admin@pondoku.my',pw:hash('admin123'),role:'admin',status:'Draft',answers:{},step:1});save();}

const AREAS={'Batu Pahat 83000':[1.85,102.93],'Johor Bahru':[1.49,103.74],'Shah Alam':[3.07,101.52],'Petaling Jaya':[3.11,101.61],'Kuala Lumpur':[3.14,101.69],'Kajang':[2.99,101.79],'Ipoh':[4.6,101.09],'George Town':[5.41,100.33],'Batu Pahat Town centre':[1.855,102.933],'Batu Pahat West side':[1.85,102.89],'Batu Pahat Far north':[2.05,102.93]};
const km=(a,b)=>{const r=x=>x*Math.PI/180,[p,q]=[AREAS[a.area],AREAS[b.area]];if(!p||!q)return 999;const d=r(q[0]-p[0]),e=r(q[1]-p[1]);const h=Math.sin(d/2)**2+Math.cos(r(p[0]))*Math.cos(r(q[0]))*Math.sin(e/2)**2;return 12742*Math.asin(Math.sqrt(h));};
const AG=['c','t','y','a'],SU=['1','2','3','4'],BU=['b1','b2','b3','b4'],HR=['office','half','flex','full'];
const gap=(L,x,y)=>Math.abs(L.indexOf(x)-L.indexOf(y));
// Silent pairwise score 0-100
function score(A,B){let s=0;const d=km(A,B);
 s+=d>10?0:15*(1-d/20);
 s+=[10,5,0,0][gap(AG,A.age,B.age)]??0;
 s+=((A.gpref==='same'||B.gpref==='same')&&A.gender!==B.gender)?0:10;
 s+=[15,8,2,0][gap(SU,A.support,B.support)]??0;
 s+=A.need===B.need?10:(A.need==='multi'||B.need==='multi')?6:0;
 s+=[10,6,2,0][gap(BU,A.budget,B.budget)]??0;
 s+=A.hours===B.hours?10:(A.hours==='flex'||B.hours==='flex')?5:0;
 s+=(A.langs||[]).some(l=>(B.langs||[]).includes(l))?5:0;
 for(const k of['h1','h2','h3','h4','h5'])if(!!A[k]===!!B[k])s+=3;
 return Math.round(s);}
const A=u=>u.answers;
const pair=(a,b)=>score(A(a),A(b))>=55&&km(A(a),A(b))<=10;
const clusterScore=ms=>{let t=0,n=0;for(let i=0;i<ms.length;i++)for(let j=i+1;j<ms.length;j++){t+=score(A(ms[i]),A(ms[j]));n++}return n?Math.round(t/n):0};
const COST=[[640,900],[936,1320],[1100,1500],[1300,1800]];
const cost=a=>COST[Math.max(0,BU.indexOf(a.budget))];
const byId=i=>db.users.find(u=>u.id===i);
const mail=async(u,subject,text)=>{db.outbox.push({to:u.email,subject,text,at:Date.now()});
 try{const t=process.env.SMTP_URL?nodemailer.createTransport(process.env.SMTP_URL):nodemailer.createTransport({jsonTransport:true});
  await t.sendMail({from:'Pondoku <hello@pondoku.my>',to:u.email,subject,text});}catch(e){console.log('mail',e.message)}};
const welcome=g=>{const ms=g.members.map(byId),c=cost(A(ms[0]));
 return `Welcome! I’m Pondoku Helper. You were matched because you live close to each other and have similar needs. Group match: ${clusterScore(ms)}%. General estimate for a shared home: RM${c[0]} to RM${c[1]} per family per month (estimate only). From here, you decide everything together: who leads, house rules and costs. I will stay quietly in this group. You can leave at any time.`};

function makeGroup(ms){const g={id:id('g'),name:'Group '+(db.groups.length+1),members:ms.map(m=>m.id),invites:{},joined:[],welcomed:false,hold:null,created:Date.now()};
 ms.forEach(m=>{m.status='Pending Consent';m.groupId=g.id;m.inviteAt=Date.now();g.invites[m.id]={url:null,sent:false,reminded:false}});
 db.groups.push(g);if(db.mode==='demo')g.members.forEach(m=>join(g,m));if(db.mode==='prod')wa.createAndInvite(g).catch(e=>console.error('WA group failed; use Operator panel:',e.message));return g}
function join(g,uid){if(!g.joined.includes(uid))g.joined.push(uid);const u=byId(uid);u.status='Grouped';
 if(g.joined.length>=3&&!g.welcomed){g.welcomed=true;g.welcomeText=welcome(g.joined.length<g.members.length?{members:g.joined}:g);}if(db.mode==='prod'&&g.waId&&g.welcomed&&!g.posted){g.posted=1;wa.postWelcome(g).catch(console.error)}}

// Matching: Flow B (existing groups) then Flow A (new cluster)
async function match(u){
 const groups=db.groups.filter(g=>!g.hold);
 const fits=groups.map(g=>({g,ms:g.members.map(byId)})).filter(x=>x.ms.every(m=>pair(u,m)))
  .sort((a,b)=>Math.min(...a.ms.map(m=>km(A(u),A(m))))-Math.min(...b.ms.map(m=>km(A(u),A(m)))));
 const open=fits.find(x=>x.g.members.length<5);
 const target=open||fits[0];
 if(open||(fits[0]&&!hasFormableCluster(u))){const {g,ms}=target;const full=g.members.length>=5;
  g.hold=u.id;u.status='Pending Consent';u.groupId=null;
  const range=({c:'7–12',t:'13–17',y:'18–25',a:'26+'})[A(u).age];
  const p={id:id('p'),groupId:g.id,userId:u.id,rule:full?'majority':'unanimous',votes:{},created:Date.now(),reminded:false,done:false,
   info:{age:range,km:Math.round(Math.min(...ms.map(m=>km(A(u),A(m))))),score:Math.round(Math.min(...ms.map(m=>score(A(u),A(m)))))}};
  db.polls.push(p);if(db.mode==='prod')wa.postPoll(p).catch(console.error);await mail(u,'Pondoku: we are checking with the group','We are checking with the group. We will email you as soon as we hear back.');return}
 const pool=db.users.filter(x=>x.status==='Available'&&x.id!==u.id);
 const cl=buildCluster(u,pool);
 if(cl){makeGroup(cl);for(const m of cl)await mail(m,'Pondoku: your group is ready','You have been matched. Your invite link will arrive shortly.')}
 else u.status='Available';}
function hasFormableCluster(u){return !!buildCluster(u,db.users.filter(x=>x.status==='Available'&&x.id!==u.id))}
function buildCluster(u,pool){let c=[u];for(const x of pool.sort((a,b)=>km(A(u),A(a))-km(A(u),A(b)))){if(c.length<5&&c.every(m=>pair(m,x)))c.push(x)}return c.length>=3?c:null}

async function resolvePoll(p,force){if(p.done)return;const g=db.groups.find(x=>x.id===p.groupId),u=byId(p.userId);
 const vs=Object.values(p.votes),n=g.members.length,yes=vs.filter(v=>v).length;
 const approved=p.rule==='majority'?yes>n/2&&(force||vs.length===n):yes===n;
 const declined=p.rule==='majority'?(vs.length===n&&yes<=n/2):vs.some(v=>!v);
 if(approved){p.done=true;p.result='approved';g.members.push(u.id);g.invites[u.id]={url:null,sent:false};g.hold=null;u.groupId=g.id;u.status='Pending Consent';if(db.mode==='prod')wa.dmInvite(g,u).catch(console.error);
  await mail(u,'Pondoku: you were approved','Good news. Your invite link will arrive shortly.')}
 else if(declined||force){p.done=true;p.result='not approved';g.hold=null;u.status='Available';u.groupId=null;
  await mail(u,'Pondoku: update','This group is not available. We will keep looking.');await match(u)}}

// ---- API ----
const auth=(q,r,n)=>{const uid=db.sessions[(q.headers.authorization||'').replace('Bearer ','')];const u=uid&&byId(uid);if(!u)return r.status(401).json({e:'login'});q.u=u;n()};
const adm=(q,r,n)=>q.u.role==='admin'?n():r.status(403).json({e:'admin'});
const pub=u=>({id:u.id,code:u.code,email:u.email,role:u.role,status:u.status,step:u.step,answers:u.answers,groupId:u.groupId,estimate:cost(u.answers),invite:u.groupId&&db.groups.find(g=>g.id===u.groupId)?.invites[u.id]?.url,
 group:u.groupId&&(g=>g&&{size:g.members.length,joined:g.joined.length,welcome:g.welcomeText,score:clusterScore(g.members.map(byId)),poll:null})(db.groups.find(g=>g.id===u.groupId))});
const tok=u=>{const t=crypto.randomBytes(16).toString('hex');db.sessions[t]=u.id;save();return t};
app.post('/api/register',(q,r)=>{const{email,password}=q.body;if(!email||!password||password.length<6)return r.status(400).json({e:'Email and a password of 6+ characters are required'});
 if(db.users.find(u=>u.email===email))return r.status(409).json({e:'Email already registered'});
 const u={id:id('u'),code:'F'+(db.users.filter(x=>x.role==='parent').length+1),email,pw:hash(password),role:'parent',status:'Draft',answers:{},step:1};db.users.push(u);r.json({token:tok(u),user:pub(u)})});
app.post('/api/login',(q,r)=>{const u=db.users.find(x=>x.email===q.body.email);if(!u||!ok(q.body.password||'',u.pw))return r.status(401).json({e:'Wrong email or password'});r.json({token:tok(u),user:pub(u)})});
app.get('/api/me',auth,(q,r)=>{const u=pub(q.u);const p=db.polls.find(x=>x.userId===q.u.id&&!x.done);r.json({...u,waiting:!!p,mode:db.mode})});
app.post('/api/save',auth,(q,r)=>{if(q.u.status!=='Draft')return r.json(pub(q.u));q.u.answers={...q.u.answers,...q.body.answers};q.u.step=q.body.step||q.u.step;if(q.body.answers?.email)q.u.contactEmail=q.body.answers.email;save();r.json(pub(q.u))});
app.post('/api/complete',auth,async(q,r)=>{const a=q.u.answers;if(!a.consent)return r.status(400).json({e:'Consent is required'});
 for(const k of['name','phone','email','area','age','gender','gpref','support','need','budget','hours'])if(!a[k])return r.status(400).json({e:'Missing: '+k});
 if(!/^\+?60\d{8,10}$/.test(String(a.phone).replace(/[\s-]/g,'')))return r.status(400).json({e:'Phone must be a Malaysian number (+60...)'});
 q.u.status='Available';await match(q.u);save();r.json(pub(q.u))});
// Admin / coordinator
app.get('/api/admin/state',auth,adm,(q,r)=>r.json({mode:db.mode,wa:wa.status(),
 users:db.users.filter(u=>u.role==='parent').map(u=>({id:u.id,name:u.answers.name,area:u.answers.area,status:u.status,groupId:u.groupId})),
 groups:db.groups.map(g=>({...g,names:g.members.map(i=>byId(i).answers.name),score:clusterScore(g.members.map(byId)),welcome:welcome(g),estimate:cost(A(byId(g.members[0])))})),
 polls:db.polls.filter(p=>!p.done).map(p=>({...p,tally:{yes:Object.values(p.votes).filter(Boolean).length,no:Object.values(p.votes).filter(v=>!v).length,total:db.groups.find(g=>g.id===p.groupId).members.length}})),
 outbox:db.outbox.slice(-15).reverse()}));
app.post('/api/admin/mode',auth,adm,(q,r)=>{db.mode=q.body.mode;if(db.mode==='prod')wa.start();save();r.json({mode:db.mode})});
app.post('/api/admin/invite',auth,adm,async(q,r)=>{const g=db.groups.find(x=>x.id===q.body.groupId);
 for(const uid of g.members)if(!g.invites[uid].sent){g.invites[uid]={url:q.body.url,sent:true,at:Date.now()};byId(uid).inviteAt=Date.now();await mail(byId(uid),'Pondoku: your private group link',`Join voluntarily here: ${q.body.url}`)}save();r.json({ok:1})});
app.post('/api/admin/joined',auth,adm,(q,r)=>{join(db.groups.find(x=>x.id===q.body.groupId),q.body.userId);save();r.json({ok:1})});
app.post('/api/admin/vote',auth,adm,async(q,r)=>{const p=db.polls.find(x=>x.id===q.body.pollId);p.votes[q.body.memberId]=!!q.body.yes;await resolvePoll(p);save();r.json({ok:1})});

// ---- Family leave / reset ----
app.post('/api/leave',auth,(q,r)=>{const u=q.u,g=db.groups.find(x=>x.id===u.groupId);
 if(g){g.members=g.members.filter(x=>x!==u.id);g.joined=g.joined.filter(x=>x!==u.id);delete g.invites[u.id]}
 u.groupId=null;u.status='Available';delete u.since;save();r.json(pub(u))});
// ---- Admin monitoring (privacy: code, first name, area, days, status/note only) ----
function monitor(){const now=Date.now(),T=db.th,ps=db.users.filter(u=>u.role==='parent'&&u.status!=='Draft');
 const gn=i=>db.groups.find(g=>g.id===i)?.name,isOpen=u=>u.status!=='Grouped';
 const iso=u=>!ps.some(x=>x!==u&&km(A(u),A(x))<=T.dist&&score(A(u),A(x))>=55);
 const poll=u=>db.polls.find(p=>p.userId===u.id&&!p.done);
 const fam=ps.map(u=>{const p=poll(u),i=db.groups.find(g=>g.id===u.groupId)?.invites[u.id];
  return{code:u.code,name:u.answers.name,area:u.answers.area,status:isOpen(u)?'Available':'Grouped',group:u.status==='Grouped'?gn(u.groupId):'—',
   days:isOpen(u)?Math.floor((now-(u.since||now))/D):null,
   note:u.status==='Grouped'?'Joined':p?'Consent request sent to '+gn(p.groupId):i?.sent?'Invite sent':iso(u)?`No compatible family within ${T.dist} km. Alert: follow up`:'Looking for a match'}});
 const grp=db.groups.map(g=>{const ms=g.members.map(byId),p=db.polls.find(x=>x.groupId===g.id&&!x.done),n=ms.length;
  return{name:g.name,area:A(ms[0]).area,members:`${n} of 5`,open:5-n,avg:clusterScore(ms),
   note:p?`Open. Consent request for ${byId(p.userId).code} pending (day ${Math.floor((now-p.created)/D)+1} of 2)`:n>=5?'Full':n<3?'Below 3 families. Needs more members':'Open'}});
 const al=[];
 ps.filter(isOpen).forEach(u=>{const d=(now-(u.since||now))/D,n=u.code+' '+u.answers.name;
  if(d>T.wait)al.push({rule:1,text:`${n} has been Available for ${Math.floor(d)} days`});
  if(u.status==='Available'&&iso(u))al.push({rule:2,text:`${n}: no group or compatible family within ${T.dist} km`})});
 db.groups.forEach(g=>{for(const[uid,i]of Object.entries(g.invites))if(i.sent&&i.at&&!g.joined.includes(uid)&&now-i.at>T.invite*D)al.push({rule:3,text:`${byId(uid).code} has not accepted the ${g.name} invite after ${T.invite}+ days`});
  if(g.members.length<3)al.push({rule:5,text:`${g.name} has fewer than 3 families`})});
 db.polls.filter(p=>!p.done&&now-p.created>T.consent*36e5).forEach(p=>al.push({rule:4,text:`Consent request for ${byId(p.userId).code} unanswered after ${T.consent} hours`}));
 return{th:T,fam,grp,al:al.sort((a,b)=>a.rule-b.rule),kpi:{families:ps.length,available:ps.filter(isOpen).length,grouped:ps.length-ps.filter(isOpen).length,groups:db.groups.length,slots:grp.reduce((t,g)=>t+g.open,0)}}}
app.get('/api/admin/monitor',auth,adm,(q,r)=>r.json(monitor()));
app.post('/api/admin/thresholds',auth,adm,(q,r)=>{for(const k of['wait','dist','invite','consent'])if(+q.body[k]>0)db.th[k]=+q.body[k];save();r.json(db.th)});
app.post('/api/admin/seed',auth,adm,(q,r)=>{seed();r.json({ok:1})});
// Batu Pahat demo dataset F1–F11
function seed(){db.users=db.users.filter(u=>u.role==='admin');db.groups=[];db.polls=[];db.outbox=[];
 const base={lang:'en',age:'t',gender:'m',gpref:'mixed',support:'2',need:'autism',budget:'b2',hours:'office',langs:['bm','en'],h1:false,h2:true,h3:true,h4:true,h5:true,consent:true,phone:'+60123456789'};
 const T='Batu Pahat Town centre',W='Batu Pahat West side';
 const rows=[['Aisyah',T],['Mei Ling',T],['Kumar',T],['Hafiz',T],['Siti',T],['Farah',W],['Wong',W],['Devi',W],['Azlan',W],['Noraini','Batu Pahat Far north'],['Lim',W]];
 const us=rows.map(([name,area],i)=>{const u={id:id('u'),code:'F'+(i+1),email:`f${i+1}@demo.my`,pw:hash('demo123'),role:'parent',status:'Available',step:9,answers:{...base,name,area,email:`f${i+1}@demo.my`,support:String(1+i%3),budget:['b2','b2','b3','b2'][i%4]}};db.users.push(u);return u});
 const mk=ms=>{const g={id:id('g'),name:'Group '+(db.groups.length+1),members:ms.map(m=>m.id),invites:{},joined:ms.map(m=>m.id),welcomed:true,hold:null,created:Date.now()};
  ms.forEach(m=>{m.status='Grouped';m.groupId=g.id;g.invites[m.id]={url:null,sent:true,at:Date.now()}});g.welcomeText=welcome(g);db.groups.push(g);return g};
 mk(us.slice(0,5));const g2=mk(us.slice(5,9));
 us[9].since=Date.now()-21*D;us[10].status='Pending Consent';us[10].since=Date.now();g2.hold=us[10].id;
 db.polls.push({id:id('p'),groupId:g2.id,userId:us[10].id,rule:'unanimous',votes:{},created:Date.now()-2*36e5,reminded:false,done:false,info:{age:'13–17',km:1,score:90}});save()}
if(!db.users.some(u=>u.role==='parent'))seed();
// Timers: 7-day join, 24h reminder, 48h silence = no. Call every minute.
async function tick(){const now=Date.now(),H=36e5;
 for(const p of db.polls.filter(x=>!x.done)){const g=db.groups.find(x=>x.id===p.groupId);
  if(!p.reminded&&now-p.created>24*H){p.reminded=true;if(db.mode==='prod')wa.postText(g,'Friendly reminder: a family is waiting for the group’s answer to the poll above. Silence is never counted as a yes.').catch(console.error);db.outbox.push({to:'group:'+g.id,subject:'Reminder: consent poll',text:'One reminder: please answer the poll.',at:now})}
  if(now-p.created>48*H)await resolvePoll(p,true)}
 for(const g of db.groups)for(const uid of g.members){const i=g.invites[uid],u=byId(uid);if(!i?.sent||g.joined.includes(uid))continue;
  if(!i.reminded&&now-i.at>3.5*24*H){i.reminded=true;await mail(u,'Pondoku: reminder','Your group link is still waiting. Joining is your choice.')}
  if(now-i.at>7*24*H){g.members=g.members.filter(x=>x!==uid);delete g.invites[uid];u.status='Available';u.groupId=null;await match(u)}}
 save()}
setInterval(()=>tick().catch(console.error),6e4);
wa.init({db,byId,join,resolvePoll,welcome,mail,save});if(db.mode==='prod')wa.start();
app.listen(3001,()=>console.log('Pondoku on http://localhost:3001  (admin: admin@pondoku.my / admin123)'));
